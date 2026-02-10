import { Module } from '@nestjs/common';
import { NetsuiteController } from './netsuite.controller.js';
import { NetsuiteService } from './netsuite.service.js';
import { CredentialsModule } from '../credentials/credentials.module.js';

@Module({
  imports: [CredentialsModule],
  controllers: [NetsuiteController],
  providers: [NetsuiteService],
  exports: [NetsuiteService],
})
export class NetsuiteModule {}

