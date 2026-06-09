import { Module } from '@nestjs/common';
import { ZohoController } from './zoho.controller.js';
import { ZohoOAuthService } from './zoho-oauth.service.js';

@Module({
  controllers: [ZohoController],
  providers: [ZohoOAuthService],
  exports: [ZohoOAuthService],
})
export class ZohoModule {}
