import { Injectable, Logger } from '@nestjs/common';
import { getLandlordDb, tenants, domains, Tenant, Domain } from '@org/database';
import mysql from 'mysql2/promise';

export interface DepTransactionBreakdown {
  OR: number; // enroll
  RE: number; // return
  VD: number; // void
  OV: number; // override
  SC: number; // status check
}

export interface DepStatusBreakdown {
  complete: number;
  error: number;
  in_progress: number;
  pending: number;
  posted_with_errors: number;
}

export interface TenantUsageReport {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  domain: string;
  orderCount: number;
  orderItemCount: number;
  avgItemsPerOrder: number;
  /** Distinct devices that reached depStatus='complete' inside the billing period */
  devicesEnrolled: number;
  /** Distinct devices returned inside the billing period (RE transactions, status=complete) */
  devicesReturned: number;
  /** Net billable for the period */
  netBillableDevices: number;
  depTransactionsByType: DepTransactionBreakdown;
  depTransactionsByStatus: DepStatusBreakdown;
}

export interface UsageReportResponse {
  generatedAt: string;
  startDate: string;
  endDate: string;
  tenants: TenantUsageReport[];
  totals: {
    totalOrders: number;
    totalOrderItems: number;
    avgItemsPerOrder: number;
    totalDevicesEnrolled: number;
    totalDevicesReturned: number;
    totalNetBillableDevices: number;
  };
}

export interface DailyBucket {
  date: string; // YYYY-MM-DD
  devicesEnrolled: number;
  devicesReturned: number;
  orderCount: number;
}

export interface TenantTimeSeries {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  buckets: DailyBucket[];
}

export interface TimeSeriesResponse {
  generatedAt: string;
  startDate: string;
  endDate: string;
  tenants: TenantTimeSeries[];
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  /**
   * Per-tenant billing report between [startDate, endDate]. Both inclusive on the
   * day boundary — endDate is treated as "end of that day".
   *
   * Billing metric: distinct devices that reached depStatus='complete' inside
   * the window. Re-enrolls don't double-count because we count distinct
   * order_items.id rows.
   */
  async getUsageReport(
    startDate: Date,
    endDate: Date,
  ): Promise<UsageReportResponse> {
    const start = this.startOfDay(startDate);
    const end = this.endOfDay(endDate);

    const allTenants: Tenant[] = await getLandlordDb().select().from(tenants);
    const allDomains: Domain[] = await getLandlordDb().select().from(domains);

    const tenantReports: TenantUsageReport[] = [];

    for (const tenant of allTenants) {
      const primaryDomain = this.pickPrimaryDomain(allDomains, tenant.id);
      const baseRow = this.zeroRow(tenant, primaryDomain?.domain ?? 'N/A');

      if (!primaryDomain) {
        this.logger.warn(`No domain found for tenant ${tenant.name}`);
        tenantReports.push(baseRow);
        continue;
      }

      try {
        const conn = await this.connect(primaryDomain);
        try {
          const [orderRows] = await conn.query<mysql.RowDataPacket[]>(
            `SELECT COUNT(*) AS c FROM orders WHERE created_at BETWEEN ? AND ?`,
            [start, end],
          );
          const [itemRows] = await conn.query<mysql.RowDataPacket[]>(
            `SELECT COUNT(*) AS c
               FROM order_items oi JOIN orders o ON oi.order_id = o.id
              WHERE o.created_at BETWEEN ? AND ?`,
            [start, end],
          );

          // Distinct devices enrolled (depStatus='complete') whose status
          // was last set to complete inside the window.
          const [enrolledRows] = await conn.query<mysql.RowDataPacket[]>(
            `SELECT COUNT(DISTINCT oi.id) AS c
               FROM order_items oi
              WHERE oi.dep_status = 'complete'
                AND oi.updated_at BETWEEN ? AND ?`,
            [start, end],
          );

          // Distinct devices returned inside the window — derived from RE
          // transactions that completed in the period.
          const [returnedRows] = await conn.query<mysql.RowDataPacket[]>(
            `SELECT COUNT(DISTINCT oi.id) AS c
               FROM dep_transactions dt
               JOIN order_items oi ON oi.order_id = dt.order_id
              WHERE dt.order_type = 'RE'
                AND dt.status = 'complete'
                AND dt.completed_at BETWEEN ? AND ?`,
            [start, end],
          );

          const [txnByTypeRows] = await conn.query<mysql.RowDataPacket[]>(
            `SELECT order_type AS t, COUNT(*) AS c
               FROM dep_transactions
              WHERE created_at BETWEEN ? AND ?
              GROUP BY order_type`,
            [start, end],
          );

          const [txnByStatusRows] = await conn.query<mysql.RowDataPacket[]>(
            `SELECT status AS s, COUNT(*) AS c
               FROM dep_transactions
              WHERE created_at BETWEEN ? AND ?
              GROUP BY status`,
            [start, end],
          );

          const orderCount = Number(orderRows[0]?.['c'] ?? 0);
          const orderItemCount = Number(itemRows[0]?.['c'] ?? 0);
          const devicesEnrolled = Number(enrolledRows[0]?.['c'] ?? 0);
          const devicesReturned = Number(returnedRows[0]?.['c'] ?? 0);

          tenantReports.push({
            ...baseRow,
            orderCount,
            orderItemCount,
            avgItemsPerOrder: orderCount > 0 ? this.round2(orderItemCount / orderCount) : 0,
            devicesEnrolled,
            devicesReturned,
            netBillableDevices: devicesEnrolled - devicesReturned,
            depTransactionsByType: this.bucketByType(txnByTypeRows),
            depTransactionsByStatus: this.bucketByStatus(txnByStatusRows),
          });
        } finally {
          await conn.end();
        }
      } catch (error) {
        this.logger.error(`Failed to get usage for tenant ${tenant.name}: ${error}`);
        tenantReports.push(baseRow);
      }
    }

    const totalOrders = tenantReports.reduce((s, t) => s + t.orderCount, 0);
    const totalOrderItems = tenantReports.reduce((s, t) => s + t.orderItemCount, 0);
    const totalDevicesEnrolled = tenantReports.reduce((s, t) => s + t.devicesEnrolled, 0);
    const totalDevicesReturned = tenantReports.reduce((s, t) => s + t.devicesReturned, 0);

    return {
      generatedAt: new Date().toISOString(),
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      tenants: tenantReports,
      totals: {
        totalOrders,
        totalOrderItems,
        avgItemsPerOrder: totalOrders > 0 ? this.round2(totalOrderItems / totalOrders) : 0,
        totalDevicesEnrolled,
        totalDevicesReturned,
        totalNetBillableDevices: totalDevicesEnrolled - totalDevicesReturned,
      },
    };
  }

  /**
   * Daily time series of devicesEnrolled / devicesReturned / orderCount per
   * tenant, between [startDate, endDate].
   */
  async getTimeSeries(
    startDate: Date,
    endDate: Date,
  ): Promise<TimeSeriesResponse> {
    const start = this.startOfDay(startDate);
    const end = this.endOfDay(endDate);

    const allTenants: Tenant[] = await getLandlordDb().select().from(tenants);
    const allDomains: Domain[] = await getLandlordDb().select().from(domains);

    const out: TenantTimeSeries[] = [];

    for (const tenant of allTenants) {
      const primaryDomain = this.pickPrimaryDomain(allDomains, tenant.id);
      if (!primaryDomain) {
        out.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
          buckets: this.emptyBuckets(start, end),
        });
        continue;
      }

      try {
        const conn = await this.connect(primaryDomain);
        try {
          const [enrolled] = await conn.query<mysql.RowDataPacket[]>(
            `SELECT DATE(oi.updated_at) AS d, COUNT(DISTINCT oi.id) AS c
               FROM order_items oi
              WHERE oi.dep_status = 'complete'
                AND oi.updated_at BETWEEN ? AND ?
              GROUP BY DATE(oi.updated_at)`,
            [start, end],
          );
          const [returned] = await conn.query<mysql.RowDataPacket[]>(
            `SELECT DATE(dt.completed_at) AS d, COUNT(DISTINCT oi.id) AS c
               FROM dep_transactions dt
               JOIN order_items oi ON oi.order_id = dt.order_id
              WHERE dt.order_type = 'RE'
                AND dt.status = 'complete'
                AND dt.completed_at BETWEEN ? AND ?
              GROUP BY DATE(dt.completed_at)`,
            [start, end],
          );
          const [orders] = await conn.query<mysql.RowDataPacket[]>(
            `SELECT DATE(created_at) AS d, COUNT(*) AS c
               FROM orders
              WHERE created_at BETWEEN ? AND ?
              GROUP BY DATE(created_at)`,
            [start, end],
          );

          const buckets = this.emptyBuckets(start, end);
          this.fill(buckets, enrolled, 'devicesEnrolled');
          this.fill(buckets, returned, 'devicesReturned');
          this.fill(buckets, orders, 'orderCount');

          out.push({
            tenantId: tenant.id,
            tenantName: tenant.name,
            tenantSlug: tenant.slug,
            buckets,
          });
        } finally {
          await conn.end();
        }
      } catch (error) {
        this.logger.error(`Failed to get time series for tenant ${tenant.name}: ${error}`);
        out.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
          buckets: this.emptyBuckets(start, end),
        });
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      tenants: out,
    };
  }

  // ---------- helpers ----------

  private startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  private endOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  }
  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }
  private pickPrimaryDomain(all: Domain[], tenantId: string): Domain | undefined {
    const owned = all.filter((d) => d.tenantId === tenantId);
    return owned.find((d) => d.isPrimary) ?? owned[0];
  }
  private async connect(d: Domain) {
    return mysql.createConnection({
      host: d.dbHost,
      port: d.dbPort,
      database: d.dbName,
      user: d.dbUser,
      password: d.dbPassword,
      connectTimeout: 5000,
    });
  }
  private zeroRow(tenant: Tenant, domain: string): TenantUsageReport {
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      domain,
      orderCount: 0,
      orderItemCount: 0,
      avgItemsPerOrder: 0,
      devicesEnrolled: 0,
      devicesReturned: 0,
      netBillableDevices: 0,
      depTransactionsByType: { OR: 0, RE: 0, VD: 0, OV: 0, SC: 0 },
      depTransactionsByStatus: {
        complete: 0,
        error: 0,
        in_progress: 0,
        pending: 0,
        posted_with_errors: 0,
      },
    };
  }
  private bucketByType(rows: mysql.RowDataPacket[]): DepTransactionBreakdown {
    const out: DepTransactionBreakdown = { OR: 0, RE: 0, VD: 0, OV: 0, SC: 0 };
    for (const r of rows) {
      const k = String(r['t']) as keyof DepTransactionBreakdown;
      if (k in out) out[k] = Number(r['c']);
    }
    return out;
  }
  private bucketByStatus(rows: mysql.RowDataPacket[]): DepStatusBreakdown {
    const out: DepStatusBreakdown = {
      complete: 0,
      error: 0,
      in_progress: 0,
      pending: 0,
      posted_with_errors: 0,
    };
    for (const r of rows) {
      const k = String(r['s']) as keyof DepStatusBreakdown;
      if (k in out) out[k] = Number(r['c']);
    }
    return out;
  }
  private emptyBuckets(start: Date, end: Date): DailyBucket[] {
    const out: DailyBucket[] = [];
    const cur = new Date(start);
    cur.setHours(0, 0, 0, 0);
    const last = new Date(end);
    last.setHours(0, 0, 0, 0);
    while (cur <= last) {
      out.push({
        date: cur.toISOString().split('T')[0],
        devicesEnrolled: 0,
        devicesReturned: 0,
        orderCount: 0,
      });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }
  private fill(
    buckets: DailyBucket[],
    rows: mysql.RowDataPacket[],
    field: 'devicesEnrolled' | 'devicesReturned' | 'orderCount',
  ): void {
    const map = new Map(buckets.map((b) => [b.date, b]));
    for (const r of rows) {
      const dRaw = r['d'];
      const dateStr = dRaw instanceof Date ? dRaw.toISOString().split('T')[0] : String(dRaw);
      const b = map.get(dateStr);
      if (b) b[field] = Number(r['c']);
    }
  }
}

