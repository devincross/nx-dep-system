import mysql from 'mysql2/promise';
import path from 'path';
import fs from 'fs';

/**
 * Resolve the migrations folder path.
 * In production Docker containers: /app/drizzle/{type}
 * In development: libs/database/drizzle/{type} (relative to repo root)
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
 * MySQL error codes that indicate an object already exists.
 * We skip these during migration so it's safe to run against
 * databases that were provisioned before Drizzle migrations existed.
 */
const ALREADY_EXISTS_ERRORS = new Set([
  1050, // ER_TABLE_EXISTS_ERROR - Table already exists
  1061, // ER_DUP_KEYNAME - Duplicate key name
  1826, // ER_DUP_CONSTRAINT_NAME - Duplicate constraint name (MariaDB)
]);

/**
 * Read migration SQL files from a folder, sorted by filename.
 * Returns an array of individual SQL statements.
 */
function readMigrationStatements(folder: string): string[] {
  const sqlFiles = fs
    .readdirSync(folder)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const statements: string[] = [];

  for (const file of sqlFiles) {
    const sql = fs.readFileSync(path.join(folder, file), 'utf-8');

    // Drizzle migration files use "--> statement-breakpoint" as separator
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
 * Run migration statements against a database connection.
 * Skips statements that fail with "already exists" errors,
 * making this safe to run against databases in any state.
 */
async function runStatements(
  connection: mysql.Connection,
  statements: string[],
): Promise<{ applied: number; skipped: number }> {
  let applied = 0;
  let skipped = 0;

  for (const statement of statements) {
    try {
      await connection.query(statement);
      applied++;
    } catch (err: any) {
      const errno = err?.errno ?? err?.code;

      if (typeof errno === 'number' && ALREADY_EXISTS_ERRORS.has(errno)) {
        skipped++;
        continue;
      }

      // For string error codes like 'ER_TABLE_EXISTS_ERROR'
      if (
        typeof err?.code === 'string' &&
        (err.code === 'ER_TABLE_EXISTS_ERROR' ||
          err.code === 'ER_DUP_KEYNAME' ||
          err.code === 'ER_DUP_CONSTRAINT_NAME')
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
 * Safe to call on every startup — skips already-applied statements.
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
        `[migrate] landlord: ${applied} applied, ${skipped} skipped (already exist)`,
      );
    }
  } finally {
    await connection.end();
  }
}

/**
 * Run tenant database migrations.
 * Safe to call on every sync cycle — skips already-applied statements.
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
        `[migrate] ${config.database}: ${applied} applied, ${skipped} skipped (already exist)`,
      );
    }
  } finally {
    await connection.end();
  }
}
