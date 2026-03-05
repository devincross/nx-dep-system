import { Module } from '@nestjs/common';
import { CredentialsController } from './credentials.controller.js';
import { CredentialsService } from './credentials.service.js';
import { CertificateParserService } from './certificate-parser.service.js';

@Module({
  controllers: [CredentialsController],
  providers: [CredentialsService, CertificateParserService],
  exports: [CredentialsService, CertificateParserService],
})
export class CredentialsModule {}

