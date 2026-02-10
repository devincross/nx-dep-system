import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema.js';

export interface LandlordDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let landlordDb: any = null;
let landlordPool: mysql.Pool | null = null;

export function getLandlordDbConfig(): LandlordDbConfig {
  return {
    host: process.env['LANDLORD_DB_HOST'] || 'localhost',
    port: parseInt(process.env['LANDLORD_DB_PORT'] || '3306', 10),
    database: process.env['LANDLORD_DB_NAME'] || 'landlord_db',
    user: process.env['LANDLORD_DB_USER'] || 'root',
    password: process.env['LANDLORD_DB_PASSWORD'] || '',
  };
}

export type LandlordDb = ReturnType<typeof drizzle<typeof schema>>;

export async function createLandlordConnection(
  config?: LandlordDbConfig
): Promise<LandlordDb> {
  const dbConfig = config || getLandlordDbConfig();

  if (landlordDb) {
    return landlordDb as LandlordDb;
  }

  landlordPool = mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  landlordDb = drizzle(landlordPool, { schema, mode: 'default' });

  return landlordDb as LandlordDb;
}

export async function closeLandlordConnection(): Promise<void> {
  if (landlordPool) {
    await landlordPool.end();
    landlordPool = null;
    landlordDb = null;
  }
}

export function getLandlordDb(): LandlordDb {
  if (!landlordDb) {
    throw new Error(
      'Landlord database not initialized. Call createLandlordConnection first.'
    );
  }
  return landlordDb as LandlordDb;
}

