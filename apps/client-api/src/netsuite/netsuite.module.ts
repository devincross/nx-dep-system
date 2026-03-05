import { Module } from '@nestjs/common';
import { NetsuiteController } from './netsuite.controller.js';
import { NetsuiteService } from './netsuite.service.js';
import { NetsuiteOAuthService } from './netsuite-oauth.service.js';
import { CredentialsModule } from '../credentials/credentials.module.js';

@Module({
  imports: [CredentialsModule],
  controllers: [NetsuiteController],
  providers: [NetsuiteService, NetsuiteOAuthService],
  exports: [NetsuiteService, NetsuiteOAuthService],
})
export class NetsuiteModule {}

