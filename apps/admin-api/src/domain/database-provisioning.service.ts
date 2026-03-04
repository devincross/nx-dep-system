import { Injectable, Logger } from '@nestjs/common';
import mysql from 'mysql2/promise';

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

      // Switch to the new database
      await connection.query(`USE \`${config.database}\``);

      // Run migrations (create tables)
      await this.runMigrations(connection);
      this.logger.log(`Migrations completed for ${config.database}`);
    } finally {
      await connection.end();
    }
  }

  /**
   * Runs the tenant schema migrations
   */
  private async runMigrations(connection: mysql.Connection): Promise<void> {
    // Users table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`users\` (
        \`id\` varchar(36) NOT NULL,
        \`email\` varchar(255) NOT NULL,
        \`first_name\` varchar(255),
        \`last_name\` varchar(255),
        \`password_hash\` varchar(255),
        \`is_active\` boolean NOT NULL DEFAULT true,
        \`last_login_at\` timestamp NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`users_email_unique\` (\`email\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Roles table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`roles\` (
        \`id\` varchar(36) NOT NULL,
        \`name\` varchar(255) NOT NULL,
        \`description\` text,
        \`permissions\` text,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`roles_name_unique\` (\`name\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // User roles junction table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`user_roles\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user_id\` varchar(36) NOT NULL,
        \`role_id\` varchar(36) NOT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`user_roles_user_id_foreign\` (\`user_id\`),
        KEY \`user_roles_role_id_foreign\` (\`role_id\`),
        CONSTRAINT \`user_roles_user_id_foreign\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`user_roles_role_id_foreign\` FOREIGN KEY (\`role_id\`) REFERENCES \`roles\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Credentials table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`credentials\` (
        \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
        \`type\` enum('dep','zoho','netsuite','database','ssl') NOT NULL,
        \`status\` enum('current','disabled') NOT NULL DEFAULT 'current',
        \`connection_data\` text NOT NULL,
        \`created_at\` timestamp NULL,
        \`updated_at\` timestamp NULL,
        \`deleted_at\` timestamp NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Accounts table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`accounts\` (
        \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
        \`external_account_id\` varchar(255),
        \`name\` varchar(255),
        \`created_at\` timestamp NULL,
        \`updated_at\` timestamp NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Orders table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`orders\` (
        \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
        \`order_id\` char(36) NOT NULL,
        \`account_id\` bigint unsigned NOT NULL,
        \`external_order_id\` varchar(255),
        \`external_account_id\` varchar(255),
        \`external_order_status\` varchar(255),
        \`status\` enum('waiting','pending','submitted','complete','error','changes') NOT NULL,
        \`po\` varchar(255),
        \`changes\` text,
        \`dep_order_id\` char(36),
        \`dep_ordered_at\` timestamp NULL,
        \`dep_shipped_at\` timestamp NULL,
        \`created_at\` timestamp NULL,
        \`updated_at\` timestamp NULL,
        \`source\` varchar(255),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`orders_external_order_id_unique\` (\`external_order_id\`),
        KEY \`orders_account_id_foreign\` (\`account_id\`),
        CONSTRAINT \`orders_account_id_foreign\` FOREIGN KEY (\`account_id\`) REFERENCES \`accounts\` (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Order items table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`order_items\` (
        \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
        \`order_id\` bigint unsigned NOT NULL,
        \`is_dep\` boolean NOT NULL DEFAULT false,
        \`serial_number\` varchar(255) NOT NULL,
        \`dep_status\` enum('pending','submitted','complete','error','changes') NOT NULL,
        \`created_at\` timestamp NULL,
        \`updated_at\` timestamp NULL,
        \`deleted_at\` timestamp NULL,
        PRIMARY KEY (\`id\`),
        KEY \`order_items_order_id_foreign\` (\`order_id\`),
        KEY \`order_items_serial_number_index\` (\`serial_number\`),
        CONSTRAINT \`order_items_order_id_foreign\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
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

