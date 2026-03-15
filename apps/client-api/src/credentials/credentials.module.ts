import { Module } from '@nestjs/common';
import { CredentialsController } from './credentials.controller.js';
import { CredentialsService } from './credentials.service.js';
import { CertificateParserService } from './certificate-parser.service.js';
import { CertificateGeneratorService } from './certificate-generator.service.js';

@Module({
  controllers: [CredentialsController],
  providers: [CredentialsService, CertificateParserService, CertificateGeneratorService],
  exports: [CredentialsService, CertificateParserService, CertificateGeneratorService],
})
export class CredentialsModule {}
