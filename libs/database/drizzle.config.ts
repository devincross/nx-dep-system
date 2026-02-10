import { defineConfig } from 'drizzle-kit';

// Landlord database configuration for migrations
export default defineConfig({
  schema: './src/landlord/schema.ts',
  out: './drizzle/landlord',
  dialect: 'mysql',
  dbCredentials: {
    host: process.env.LANDLORD_DB_HOST ?? 'localhost',
    port: parseInt(process.env.LANDLORD_DB_PORT ?? '3307', 10),
    database: process.env.LANDLORD_DB_NAME ?? 'landlord_db',
    user: process.env.LANDLORD_DB_USER ?? 'dep_user',
    password: process.env.LANDLORD_DB_PASSWORD ?? 'dep_password',
  },
});

