import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { NetsuiteModule } from '../netsuite/netsuite.module.js';
import { ZohoModule } from '../zoho/zoho.module.js';

@Module({
  imports: [NetsuiteModule, ZohoModule],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
