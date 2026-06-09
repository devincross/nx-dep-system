import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service.js';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('usage')
  getUsageReport(@Query('days') days?: string) {
    const numDays = days ? parseInt(days, 10) : 30;
    return this.reportsService.getUsageReport(numDays);
  }
}

