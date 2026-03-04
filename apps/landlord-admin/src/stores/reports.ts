import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../services/api';

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

export const useReportsStore = defineStore('reports', () => {
  const usageReport = ref<UsageReportResponse | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchUsageReport(days: number = 30): Promise<UsageReportResponse> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<UsageReportResponse>(`/reports/usage?days=${days}`);
      usageReport.value = response.data;
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to fetch usage report';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  function exportToCsv(): void {
    if (!usageReport.value) return;

    const headers = ['Tenant Name', 'Slug', 'Domain', 'Orders', 'Order Items', 'Avg Items/Order'];
    const rows = usageReport.value.tenants.map(t => [
      t.tenantName,
      t.tenantSlug,
      t.domain,
      t.orderCount.toString(),
      t.orderItemCount.toString(),
      t.avgItemsPerOrder.toString(),
    ]);

    // Add totals row
    rows.push([
      'TOTAL',
      '',
      '',
      usageReport.value.totals.totalOrders.toString(),
      usageReport.value.totals.totalOrderItems.toString(),
      usageReport.value.totals.avgItemsPerOrder.toString(),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `usage-report-${usageReport.value.periodDays}days-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return {
    usageReport,
    loading,
    error,
    fetchUsageReport,
    exportToCsv,
  };
});

