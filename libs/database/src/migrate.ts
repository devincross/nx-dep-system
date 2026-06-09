import mysql from 'mysql2/promise';
import path from 'path';
import fs from 'fs';

/**
 * Resolve the migrations folder path.
 */
function resolveMigrationsFolder(type: 'landlord' | 'tenant'): string {
  const candidates = [
    path.join('/app', 'drizzle', type),
    path.join(process.cwd(), 'libs', 'database', 'drizzle', type),
    path.join(__dirname, '..', 'drizzle', type),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Migration folder not found for "${type}". Checked: ${candidates.join(', ')}`
  );
}

/**
 * Read migration SQL files and split into individual statements.
 */
function readMigrationStatements(folder: string): string[] {
  const sqlFiles = fs
    .readdirSync(folder)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const statements: string[] = [];

  for (const file of sqlFiles) {
    const sql = fs.readFileSync(path.join(folder, file), 'utf-8');
    const parts = sql.split('--> statement-breakpoint');
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
    }
  }

  return statements;
}

/**
 * Get existing tables in the database.
 */
async function getExistingTables(
  connection: mysql.Connection,
): Promise<Set<string>> {
  const [rows] = (await connection.query('SHOW TABLES')) as [
    mysql.RowDataPacket[],
    any,
  ];
  const tables = new Set<string>();
  for (const row of rows) {
    tables.add(Object.values(row)[0] as string);
  }
  return tables;
}

/**
 * Get existing columns for a table.
 */
async function getExistingColumns(
  connection: mysql.Connection,
  tableName: string,
): Promise<Set<string>> {
  const [rows] = (await connection.query(`SHOW COLUMNS FROM \`${tableName}\``)) as [
    mysql.RowDataPacket[],
    any,
  ];
  const columns = new Set<string>();
  for (const row of rows) {
    columns.add(row['Field'] as string);
  }
  return columns;
}

/**
 * Extract table name from a CREATE TABLE statement.
 */
function extractCreateTableName(statement: string): string | null {
  const match = statement.match(/CREATE\s+TABLE\s+`?(\w+)`?/i);
  return match ? match[1] : null;
}

/**
 * Parse column definitions from a CREATE TABLE statement.
 * Returns an array of { name, definition } for each column.
 */
function parseColumnsFromCreateTable(
  statement: string,
): { name: string; definition: string }[] {
  // Extract the body between ( and the last )
  const bodyMatch = statement.match(/\((.+)\)/s);
  if (!bodyMatch) return [];

  const body = bodyMatch[1];
  const columns: { name: string; definition: string }[] = [];

  // Split by lines/commas, find column definitions (start with backtick)
  const lines = body.split('\n').map((l) => l.trim().replace(/,$/, ''));

  for (const line of lines) {
    // Column definitions start with `column_name`
    const colMatch = line.match(/^`(\w+)`\s+(.+)/);
    if (colMatch) {
      const name = colMatch[1];
      const def = colMatch[2];
      // Skip CONSTRAINT and PRIMARY KEY lines that happen to start with backtick
      if (
        !line.toUpperCase().startsWith('CONSTRAINT') &&
        !line.toUpperCase().startsWith('PRIMARY')
      ) {
        columns.push({ name, definition: def });
      }
    }
  }

  return columns;
}

/**
 * Run migration statements with column-level diffing.
 *
 * For each CREATE TABLE:
 * - If table doesn't exist: run the CREATE TABLE as-is
 * - If table exists: compare columns, ADD any missing ones
 *
 * For ALTER TABLE / CREATE INDEX / other statements:
 * - Run and skip on duplicate errors
 */
async function runStatements(
  connection: mysql.Connection,
  statements: string[],
): Promise<{ applied: number; skipped: number }> {
  const existingTables = await getExistingTables(connection);
  let applied = 0;
  let skipped = 0;

  for (const statement of statements) {
    const tableName = extractCreateTableName(statement);

    if (tableName && existingTables.has(tableName)) {
      // Table exists — check for missing columns and add them
      const existingColumns = await getExistingColumns(connection, tableName);
      const desiredColumns = parseColumnsFromCreateTable(statement);

      for (const col of desiredColumns) {
        if (!existingColumns.has(col.name)) {
          try {
            await connection.query(
              `ALTER TABLE \`${tableName}\` ADD COLUMN \`${col.name}\` ${col.definition}`,
            );
            console.log(
              `[migrate] Added column ${tableName}.${col.name}`,
            );
            applied++;
          } catch (err: any) {
            const msg = String(err?.message || '').toLowerCase();
            if (msg.includes('duplicate') || msg.includes('already exists')) {
              skipped++;
            } else {
              throw err;
            }
          }
        } else {
          skipped++;
        }
      }
      continue;
    }

    // Not a CREATE TABLE for an existing table — run it
    try {
      await connection.query(statement);
      applied++;
    } catch (err: any) {
      const msg = String(err?.message || '').toLowerCase();

      if (
        msg.includes('already exists') ||
        msg.includes('duplicate') ||
        msg.includes('dup_keyname') ||
        msg.includes('dup_constraint')
      ) {
        skipped++;
        continue;
      }

      throw err;
    }
  }

  return { applied, skipped };
}

export interface MigrateDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/**
 * Run landlord database migrations.
 * Safe to call on every startup — adds missing tables and columns.
 */
export async function migrateLandlordDb(
  config?: MigrateDbConfig,
): Promise<void> {
  const dbConfig = config ?? {
    host: process.env['LANDLORD_DB_HOST'] || 'localhost',
    port: parseInt(process.env['LANDLORD_DB_PORT'] || '3306', 10),
    database: process.env['LANDLORD_DB_NAME'] || 'landlord_db',
    user: process.env['LANDLORD_DB_USER'] || 'root',
    password: process.env['LANDLORD_DB_PASSWORD'] || '',
  };

  const folder = resolveMigrationsFolder('landlord');
  const statements = readMigrationStatements(folder);
  if (statements.length === 0) return;

  const connection = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
  });

  try {
    const { applied, skipped } = await runStatements(connection, statements);
    if (applied > 0 || skipped > 0) {
      console.log(
        `[migrate] landlord: ${applied} applied, ${skipped} skipped`,
      );
    }
  } finally {
    await connection.end();
  }
}

/**
 * Run tenant database migrations.
 * Safe to call any time — adds missing tables and columns.
 */
export async function migrateTenantDb(config: MigrateDbConfig): Promise<void> {
  const folder = resolveMigrationsFolder('tenant');
  const statements = readMigrationStatements(folder);
  if (statements.length === 0) return;

  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
  });

  try {
    const { applied, skipped } = await runStatements(connection, statements);
    if (applied > 0 || skipped > 0) {
      console.log(
        `[migrate] ${config.database}: ${applied} applied, ${skipped} skipped`,
      );
    }
  } finally {
    await connection.end();
  }
}
