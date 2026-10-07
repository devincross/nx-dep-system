import { Module } from '@nestjs/common';
import { ZohoController } from './zoho.controller.js';
import { ZohoOAuthService } from './zoho-oauth.service.js';
import { ZohoService } from './zoho.service.js';
import { CredentialsModule } from '../credentials/credentials.module.js';

@Module({
  imports: [CredentialsModule],
  controllers: [ZohoController],
  providers: [ZohoOAuthService, ZohoService],
  exports: [ZohoOAuthService, ZohoService],
})
export class ZohoModule {}
