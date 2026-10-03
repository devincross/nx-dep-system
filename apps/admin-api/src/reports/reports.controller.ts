import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service.js';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * Usage report between [startDate, endDate]. Inclusive on the day boundary.
   *
   * Accepts either:
   *   - ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
   *   - ?days=N  (back-compat: last N days through today)
   *
   * Default when nothing is passed: current calendar month.
   */
  @Get('usage')
  async getUsageReport(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('days') days?: string,
  ) {
    const { start, end } = this.resolveRange(startDate, endDate, days);
    return this.reportsService.getUsageReport(start, end);
  }

  @Get('usage/timeseries')
  async getTimeSeries(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('days') days?: string,
  ) {
    const { start, end } = this.resolveRange(startDate, endDate, days);
    return this.reportsService.getTimeSeries(start, end);
  }

  private resolveRange(
    startDate?: string,
    endDate?: string,
    days?: string,
  ): { start: Date; end: Date } {
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new BadRequestException('startDate and endDate must be valid ISO dates');
      }
      if (start > end) {
        throw new BadRequestException('startDate must be on or before endDate');
      }
      return { start, end };
    }

    if (days) {
      const n = parseInt(days, 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new BadRequestException('days must be a positive integer');
      }
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - n + 1);
      return { start, end };
    }

    // Default: current calendar month
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start, end };
  }
}
