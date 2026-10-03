import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../services/api';

export interface DepTransactionBreakdown {
  OR: number;
  RE: number;
  VD: number;
  OV: number;
  SC: number;
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
  devicesEnrolled: number;
  devicesReturned: number;
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
  date: string;
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

export const useReportsStore = defineStore('reports', () => {
  const usageReport = ref<UsageReportResponse | null>(null);
  const timeSeries = ref<TimeSeriesResponse | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchUsageReport(startDate: string, endDate: string): Promise<UsageReportResponse> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<UsageReportResponse>('/reports/usage', {
        params: { startDate, endDate },
      });
      usageReport.value = response.data;
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to fetch usage report';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function fetchTimeSeries(startDate: string, endDate: string): Promise<TimeSeriesResponse> {
    try {
      const response = await api.get<TimeSeriesResponse>('/reports/usage/timeseries', {
        params: { startDate, endDate },
      });
      timeSeries.value = response.data;
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to fetch time series';
      throw err;
    }
  }

  function exportToCsv(): void {
    if (!usageReport.value) return;

    const r = usageReport.value;
    const headers = [
      'Tenant Name',
      'Slug',
      'Domain',
      'Devices Enrolled (billable)',
      'Devices Returned',
      'Net Billable',
      'Orders',
      'Order Items',
      'Avg Items/Order',
      'DEP OR',
      'DEP RE',
      'DEP VD',
      'DEP OV',
      'DEP Errors',
    ];
    const rows = r.tenants.map((t) => [
      t.tenantName,
      t.tenantSlug,
      t.domain,
      t.devicesEnrolled.toString(),
      t.devicesReturned.toString(),
      t.netBillableDevices.toString(),
      t.orderCount.toString(),
      t.orderItemCount.toString(),
      t.avgItemsPerOrder.toString(),
      t.depTransactionsByType.OR.toString(),
      t.depTransactionsByType.RE.toString(),
      t.depTransactionsByType.VD.toString(),
      t.depTransactionsByType.OV.toString(),
      t.depTransactionsByStatus.error.toString(),
    ]);
    rows.push([
      'TOTAL',
      '',
      '',
      r.totals.totalDevicesEnrolled.toString(),
      r.totals.totalDevicesReturned.toString(),
      r.totals.totalNetBillableDevices.toString(),
      r.totals.totalOrders.toString(),
      r.totals.totalOrderItems.toString(),
      r.totals.avgItemsPerOrder.toString(),
      '',
      '',
      '',
      '',
      '',
    ]);

    const csv = [
      `# Billing period: ${r.startDate.split('T')[0]} to ${r.endDate.split('T')[0]}`,
      `# Generated: ${r.generatedAt}`,
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `billing-${r.startDate.split('T')[0]}-to-${r.endDate.split('T')[0]}.csv`,
    );
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return {
    usageReport,
    timeSeries,
    loading,
    error,
    fetchUsageReport,
    fetchTimeSeries,
    exportToCsv,
  };
});
