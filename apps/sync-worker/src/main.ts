/**
 * Sync Worker Service
 * Runs scheduled jobs to sync accounts and orders from external sources
 */

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module.js';
import { createLandlordConnection } from '@org/database';

async function bootstrap() {
  const logger = new Logger('SyncWorker');

  // Initialize the landlord connection for the ORM
  await createLandlordConnection({
    host: process.env['DB_HOST'] || 'localhost',
    port: parseInt(process.env['DB_PORT'] || '3306'),
    user: process.env['DB_USER'] || 'root',
    password: process.env['DB_PASSWORD'] || '',
    database: process.env['DB_NAME'] || 'landlord',
  });

  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  );

  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  const port = process.env['PORT'] || 3002;
  await app.listen(port);

  logger.log(`Sync Worker is running on: http://localhost:${port}/${globalPrefix}`);
  logger.log('Scheduled sync will run every 10 minutes');
}

bootstrap();
