import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import path from 'path';
import fs from 'fs';

/**
 * Resolve the migrations folder path.
 * In production Docker containers: /app/drizzle/{type}
 * In development: libs/database/drizzle/{type} (relative to repo root)
 */
function resolveMigrationsFolder(type: 'landlord' | 'tenant'): string {
  // Check Docker production path first
  const dockerPath = path.join('/app', 'drizzle', type);
  if (fs.existsSync(dockerPath)) {
    return dockerPath;
  }

  // Development: try relative to CWD (repo root)
  const devPath = path.join(process.cwd(), 'libs', 'database', 'drizzle', type);
  if (fs.existsSync(devPath)) {
    return devPath;
  }

  // Development: try relative to this file's location
  const localPath = path.join(__dirname, '..', 'drizzle', type);
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  throw new Error(
    `Migration folder not found for "${type}". Checked: ${dockerPath}, ${devPath}, ${localPath}`
  );
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
 * Safe to call on every startup — only applies pending migrations.
 */
export async function migrateLandlordDb(config?: MigrateDbConfig): Promise<void> {
  const dbConfig = config ?? {
    host: process.env['LANDLORD_DB_HOST'] || 'localhost',
    port: parseInt(process.env['LANDLORD_DB_PORT'] || '3306', 10),
    database: process.env['LANDLORD_DB_NAME'] || 'landlord_db',
    user: process.env['LANDLORD_DB_USER'] || 'root',
    password: process.env['LANDLORD_DB_PASSWORD'] || '',
  };

  const migrationsFolder = resolveMigrationsFolder('landlord');

  const connection = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
  });

  try {
    const db = drizzle(connection);
    await migrate(db, { migrationsFolder });
  } finally {
    await connection.end();
  }
}

/**
 * Run tenant database migrations.
 * Safe to call on every sync cycle — only applies pending migrations.
 */
export async function migrateTenantDb(config: MigrateDbConfig): Promise<void> {
  const migrationsFolder = resolveMigrationsFolder('tenant');

  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
  });

  try {
    const db = drizzle(connection);
    await migrate(db, { migrationsFolder });
  } finally {
    await connection.end();
  }
}
