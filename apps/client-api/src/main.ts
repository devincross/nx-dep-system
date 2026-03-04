/**
 * Client API - Multi-tenant application
 * Resolves tenant databases based on request domain
 */

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module.js';
import { createLandlordConnection } from '@org/database';

async function bootstrap() {
  // Initialize landlord database connection first
  await createLandlordConnection();

  const app = await NestFactory.create(AppModule);

  // Enable CORS for frontend
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  );

  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  const port = process.env['CLIENT_API_PORT'] || 3001;
  await app.listen(port);
  Logger.log(
    `🚀 Client API is running on: http://localhost:${port}/${globalPrefix}`
  );
}

bootstrap();

