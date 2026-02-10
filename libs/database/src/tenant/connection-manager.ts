import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema.js';

export interface TenantDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export type TenantDb = ReturnType<typeof drizzle<typeof schema>>;

interface ConnectionPoolEntry {
  pool: mysql.Pool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  lastUsed: number;
}

// Connection pool cache - keyed by domain
const connectionPools = new Map<string, ConnectionPoolEntry>();

// Connection pool settings
const MAX_POOL_SIZE = 100;
const POOL_CLEANUP_INTERVAL = 60000; // 1 minute
const CONNECTION_IDLE_TIMEOUT = 300000; // 5 minutes

// Start cleanup interval
let cleanupInterval: NodeJS.Timeout | null = null;

function startCleanupInterval(): void {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    const now = Date.now();
    const toRemove: string[] = [];

    connectionPools.forEach((entry, domain) => {
      if (now - entry.lastUsed > CONNECTION_IDLE_TIMEOUT) {
        toRemove.push(domain);
      }
    });

    toRemove.forEach(async (domain) => {
      const entry = connectionPools.get(domain);
      if (entry) {
        await entry.pool.end();
        connectionPools.delete(domain);
      }
    });
  }, POOL_CLEANUP_INTERVAL);
}

export async function getTenantConnection(
  domain: string,
  config: TenantDbConfig
): Promise<TenantDb> {
  // Check if we already have a connection for this domain
  const existing = connectionPools.get(domain);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.db;
  }

  // Enforce max pool size
  if (connectionPools.size >= MAX_POOL_SIZE) {
    // Remove oldest connection
    let oldestDomain: string | null = null;
    let oldestTime = Date.now();

    connectionPools.forEach((entry, d) => {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestDomain = d;
      }
    });

    if (oldestDomain) {
      const entry = connectionPools.get(oldestDomain);
      if (entry) {
        await entry.pool.end();
        connectionPools.delete(oldestDomain);
      }
    }
  }

  // Create new connection pool
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  const db = drizzle(pool, { schema, mode: 'default' });

  connectionPools.set(domain, {
    pool,
    db,
    lastUsed: Date.now(),
  });

  // Start cleanup if not already running
  startCleanupInterval();

  return db as unknown as TenantDb;
}

export async function closeTenantConnection(domain: string): Promise<void> {
  const entry = connectionPools.get(domain);
  if (entry) {
    await entry.pool.end();
    connectionPools.delete(domain);
  }
}

export async function closeAllTenantConnections(): Promise<void> {
  const closePromises: Promise<void>[] = [];

  connectionPools.forEach((entry) => {
    closePromises.push(entry.pool.end());
  });

  await Promise.all(closePromises);
  connectionPools.clear();

  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

export function getActiveConnectionCount(): number {
  return connectionPools.size;
}

