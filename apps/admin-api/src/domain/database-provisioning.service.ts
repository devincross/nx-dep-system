import { Injectable, Logger } from '@nestjs/common';
import mysql from 'mysql2/promise';
import { migrateTenantDb } from '@org/database';

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

@Injectable()
export class DatabaseProvisioningService {
  private readonly logger = new Logger(DatabaseProvisioningService.name);

  /**
   * Creates a new database and runs the tenant schema migrations
   */
  async provisionDatabase(config: DatabaseConfig): Promise<void> {
    this.logger.log(`Provisioning database: ${config.database}`);

    // Connect without specifying a database to create it
    const connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
    });

    try {
      // Create the database
      await connection.query(
        `CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
      this.logger.log(`Database ${config.database} created`);
    } finally {
      await connection.end();
    }

    // Run Drizzle migrations against the new database
    this.logger.log(`Running migrations for ${config.database}...`);
    await migrateTenantDb({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
    });
    this.logger.log(`Migrations completed for ${config.database}`);
  }

  /**
   * Tests if a database connection is valid
   */
  async testConnection(config: DatabaseConfig): Promise<{ success: boolean; message: string }> {
    try {
      const connection = await mysql.createConnection({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        connectTimeout: 5000,
      });

      await connection.ping();
      await connection.end();

      return { success: true, message: 'Connection successful' };
    } catch (error) {
      return {
        success: false,
        message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Drops a database (use with caution!)
   */
  async dropDatabase(config: Omit<DatabaseConfig, 'database'> & { database: string }): Promise<void> {
    this.logger.warn(`Dropping database: ${config.database}`);

    const connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
    });

    try {
      await connection.query(`DROP DATABASE IF EXISTS \`${config.database}\``);
      this.logger.log(`Database ${config.database} dropped`);
    } finally {
      await connection.end();
    }
  }
}
