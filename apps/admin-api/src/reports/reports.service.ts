import { Injectable, Logger } from '@nestjs/common';
import { getLandlordDb, tenants, domains } from '@org/database';
import mysql from 'mysql2/promise';

export interface TenantUsageReport {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  domain: string;
  orderCount: number;
  orderItemCount: number;
  avgItemsPerOrder: number;
  periodDays: number;
}

export interface UsageReportResponse {
  generatedAt: string;
  periodDays: number;
  tenants: TenantUsageReport[];
  totals: {
    totalOrders: number;
    totalOrderItems: number;
    avgItemsPerOrder: number;
  };
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  async getUsageReport(days: number = 30): Promise<UsageReportResponse> {
    const db = getLandlordDb();

    // Get all tenants with their primary domain
    const allTenants = await db.select().from(tenants);
    const allDomains = await db.select().from(domains);

    const tenantReports: TenantUsageReport[] = [];

    for (const tenant of allTenants) {
      // Find primary domain for this tenant
      const tenantDomains = allDomains.filter(d => d.tenantId === tenant.id);
      const primaryDomain = tenantDomains.find(d => d.isPrimary) || tenantDomains[0];

      if (!primaryDomain) {
        this.logger.warn(`No domain found for tenant ${tenant.name}`);
        tenantReports.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
          domain: 'N/A',
          orderCount: 0,
          orderItemCount: 0,
          avgItemsPerOrder: 0,
          periodDays: days,
        });
        continue;
      }

      try {
        // Connect to tenant database
        const connection = await mysql.createConnection({
          host: primaryDomain.dbHost,
          port: primaryDomain.dbPort,
          database: primaryDomain.dbName,
          user: primaryDomain.dbUser,
          password: primaryDomain.dbPassword,
          connectTimeout: 5000,
        });

        // Query orders from last N days
        const [orderRows] = await connection.query<mysql.RowDataPacket[]>(`
          SELECT COUNT(*) as orderCount
          FROM orders
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [days]);

        // Query order items from last N days
        const [itemRows] = await connection.query<mysql.RowDataPacket[]>(`
          SELECT COUNT(*) as itemCount
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [days]);

        await connection.end();

        const orderCount = Number(orderRows[0]?.orderCount || 0);
        const orderItemCount = Number(itemRows[0]?.itemCount || 0);
        const avgItemsPerOrder = orderCount > 0 ? orderItemCount / orderCount : 0;

        tenantReports.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
          domain: primaryDomain.domain,
          orderCount,
          orderItemCount,
          avgItemsPerOrder: Math.round(avgItemsPerOrder * 100) / 100,
          periodDays: days,
        });
      } catch (error) {
        this.logger.error(`Failed to get usage for tenant ${tenant.name}: ${error}`);
        tenantReports.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
          domain: primaryDomain.domain,
          orderCount: 0,
          orderItemCount: 0,
          avgItemsPerOrder: 0,
          periodDays: days,
        });
      }
    }

    // Calculate totals
    const totalOrders = tenantReports.reduce((sum, t) => sum + t.orderCount, 0);
    const totalOrderItems = tenantReports.reduce((sum, t) => sum + t.orderItemCount, 0);
    const avgItemsPerOrder = totalOrders > 0 ? totalOrderItems / totalOrders : 0;

    return {
      generatedAt: new Date().toISOString(),
      periodDays: days,
      tenants: tenantReports,
      totals: {
        totalOrders,
        totalOrderItems,
        avgItemsPerOrder: Math.round(avgItemsPerOrder * 100) / 100,
      },
    };
  }
}

