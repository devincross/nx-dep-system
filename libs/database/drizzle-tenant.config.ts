import { defineConfig } from 'drizzle-kit';

// Tenant database configuration for migrations
// Use this to generate migrations for tenant databases
export default defineConfig({
  schema: './src/tenant/schema.ts',
  out: './drizzle/tenant',
  dialect: 'mysql',
  dbCredentials: {
    host: process.env['TENANT_DB_HOST'] || 'localhost',
    port: parseInt(process.env['TENANT_DB_PORT'] || '3306', 10),
    database: process.env['TENANT_DB_NAME'] || 'tenant_template_db',
    user: process.env['TENANT_DB_USER'] || 'root',
    password: process.env['TENANT_DB_PASSWORD'] || '',
  },
});

