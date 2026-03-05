/**
 * Sync Worker Service
 * Runs scheduled jobs to sync accounts and orders from external sources
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module.js';
import { initializeLandlordDb } from '@org/database';

async function bootstrap() {
  const logger = new Logger('SyncWorker');

  // Initialize landlord database connection
  logger.log('Initializing landlord database connection...');
  initializeLandlordDb({
    host: process.env['DB_HOST'] || 'localhost',
    port: parseInt(process.env['DB_PORT'] || '3306'),
    user: process.env['DB_USER'] || 'root',
    password: process.env['DB_PASSWORD'] || '',
    database: process.env['DB_NAME'] || 'landlord',
  });

  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  const port = process.env['PORT'] || 3002;
  await app.listen(port);

  logger.log(`🔄 Sync Worker is running on: http://localhost:${port}/${globalPrefix}`);
  logger.log('Scheduled sync will run every 10 minutes');
}

bootstrap();
