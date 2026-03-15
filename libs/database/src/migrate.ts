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
 * Check which tables already exist in the database.
 */
async function getExistingTables(connection: mysql.Connection): Promise<Set<string>> {
  const [rows] = await connection.query('SHOW TABLES') as [mysql.RowDataPacket[], any];
  const tables = new Set<string>();
  for (const row of rows) {
    // SHOW TABLES returns a single column whose name varies by database
    const tableName = Object.values(row)[0] as string;
    tables.add(tableName);
  }
  return tables;
}

/**
 * Extract the table name from a CREATE TABLE statement.
 * Returns null if the statement isn't a CREATE TABLE.
 */
function extractCreateTableName(statement: string): string | null {
  const match = statement.match(/CREATE\s+TABLE\s+`?(\w+)`?/i);
  return match ? match[1] : null;
}

/**
 * Run migration statements against a database connection.
 *
 * - Skips CREATE TABLE for tables that already exist
 * - For ALTER TABLE / CREATE INDEX, catches duplicate errors and continues
 */
async function runStatements(
  connection: mysql.Connection,
  statements: string[],
): Promise<{ applied: number; skipped: number }> {
  const existingTables = await getExistingTables(connection);
  let applied = 0;
  let skipped = 0;

  for (const statement of statements) {
    // Skip CREATE TABLE if table already exists
    const tableName = extractCreateTableName(statement);
    if (tableName && existingTables.has(tableName)) {
      skipped++;
      continue;
    }

    try {
      await connection.query(statement);
      applied++;
    } catch (err: any) {
      const msg = String(err?.message || err || '').toLowerCase();

      // Skip any "already exists" / "duplicate" errors
      if (
        msg.includes('already exists') ||
        msg.includes('duplicate') ||
        msg.includes('dup_keyname') ||
        msg.includes('dup_constraint')
      ) {
        skipped++;
        continue;
      }

      // Rethrow anything else
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
 * Safe to call on every startup — skips objects that already exist.
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
 * Safe to call on every sync cycle — skips objects that already exist.
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
