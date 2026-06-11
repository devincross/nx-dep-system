<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useReportsStore } from '../../stores/reports';

const reportsStore = useReportsStore();

// Default to current calendar month
const now = new Date();
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
const startDate = ref(toIsoDate(monthStart));
const endDate = ref(toIsoDate(monthEnd));
const expanded = ref<string[]>([]);

function toIsoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

const headers = [
  { title: 'Tenant', key: 'tenantName' },
  { title: 'Domain', key: 'domain' },
  { title: 'Devices Enrolled', key: 'devicesEnrolled', align: 'end' as const },
  { title: 'Returned', key: 'devicesReturned', align: 'end' as const },
  { title: 'Net Billable', key: 'netBillableDevices', align: 'end' as const },
  { title: 'Orders', key: 'orderCount', align: 'end' as const },
  { title: 'Errors', key: 'depErrors', align: 'end' as const },
];

const monthPresets = computed(() => {
  const out: { title: string; start: string; end: string }[] = [];
  const ref = new Date();
  for (let i = 0; i < 6; i++) {
    const s = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
    const e = new Date(ref.getFullYear(), ref.getMonth() - i + 1, 0);
    out.push({
      title: s.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      start: toIsoDate(s),
      end: toIsoDate(e),
    });
  }
  return out;
});

const aggregatedTimeSeries = computed(() => {
  const ts = reportsStore.timeSeries;
  if (!ts || ts.tenants.length === 0) return { dates: [], enrolled: [], returned: [] };
  const dateToEnrolled = new Map<string, number>();
  const dateToReturned = new Map<string, number>();
  for (const t of ts.tenants) {
    for (const b of t.buckets) {
      dateToEnrolled.set(b.date, (dateToEnrolled.get(b.date) ?? 0) + b.devicesEnrolled);
      dateToReturned.set(b.date, (dateToReturned.get(b.date) ?? 0) + b.devicesReturned);
    }
  }
  const dates = Array.from(dateToEnrolled.keys()).sort();
  return {
    dates,
    enrolled: dates.map((d) => dateToEnrolled.get(d) ?? 0),
    returned: dates.map((d) => dateToReturned.get(d) ?? 0),
  };
});

async function refresh() {
  await Promise.all([
    reportsStore.fetchUsageReport(startDate.value, endDate.value),
    reportsStore.fetchTimeSeries(startDate.value, endDate.value),
  ]);
}

function applyPreset(preset: { start: string; end: string }) {
  startDate.value = preset.start;
  endDate.value = preset.end;
  refresh();
}

function exportCsv() {
  reportsStore.exportToCsv();
}

function tenantSeries(tenantId: string) {
  return reportsStore.timeSeries?.tenants.find((t) => t.tenantId === tenantId);
}

onMounted(refresh);
</script>

<template>
  <div>
    <div class="d-flex justify-space-between align-center mb-4 flex-wrap ga-2">
      <h1 class="text-h4">Billing / Usage Report</h1>
      <div class="d-flex ga-2 flex-wrap align-center">
        <v-text-field
          v-model="startDate"
          type="date"
          label="Start"
          density="compact"
          hide-details
          style="width: 160px"
        ></v-text-field>
        <v-text-field
          v-model="endDate"
          type="date"
          label="End"
          density="compact"
          hide-details
          style="width: 160px"
        ></v-text-field>
        <v-menu>
          <template v-slot:activator="{ props }">
            <v-btn variant="outlined" v-bind="props" prepend-icon="mdi-calendar-month">Month</v-btn>
          </template>
          <v-list density="compact">
            <v-list-item
              v-for="preset in monthPresets"
              :key="preset.start"
              @click="applyPreset(preset)"
            >
              <v-list-item-title>{{ preset.title }}</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
        <v-btn color="primary" prepend-icon="mdi-refresh" @click="refresh" :loading="reportsStore.loading">
          Refresh
        </v-btn>
        <v-btn color="success" prepend-icon="mdi-download" @click="exportCsv" :disabled="!reportsStore.usageReport">
          Export CSV
        </v-btn>
      </div>
    </div>

    <v-alert v-if="reportsStore.error" type="error" class="mb-4" closable>
      {{ reportsStore.error }}
    </v-alert>

    <!-- Headline totals -->
    <v-row v-if="reportsStore.usageReport" class="mb-2">
      <v-col cols="12" sm="4">
        <v-card>
          <v-card-text>
            <div class="text-caption text-grey">Devices Enrolled</div>
            <div class="text-h4">{{ reportsStore.usageReport.totals.totalDevicesEnrolled }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" sm="4">
        <v-card>
          <v-card-text>
            <div class="text-caption text-grey">Devices Returned</div>
            <div class="text-h4">{{ reportsStore.usageReport.totals.totalDevicesReturned }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" sm="4">
        <v-card color="primary" variant="tonal">
          <v-card-text>
            <div class="text-caption">Net Billable Devices</div>
            <div class="text-h4">{{ reportsStore.usageReport.totals.totalNetBillableDevices }}</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Aggregate trend sparkline -->
    <v-card v-if="aggregatedTimeSeries.dates.length > 0" class="mb-4">
      <v-card-title>Daily Enrollments — All Tenants</v-card-title>
      <v-card-text>
        <v-sparkline
          :model-value="aggregatedTimeSeries.enrolled"
          :labels="aggregatedTimeSeries.dates"
          line-width="2"
          smooth
          auto-draw
          color="primary"
          show-labels
          padding="16"
        ></v-sparkline>
      </v-card-text>
    </v-card>

    <v-card>
      <v-card-text v-if="reportsStore.usageReport" class="text-caption text-grey">
        {{ new Date(reportsStore.usageReport.startDate).toLocaleDateString() }}
        →
        {{ new Date(reportsStore.usageReport.endDate).toLocaleDateString() }}
        | Generated: {{ new Date(reportsStore.usageReport.generatedAt).toLocaleString() }}
      </v-card-text>
      <v-data-table
        v-model:expanded="expanded"
        :items="reportsStore.usageReport?.tenants || []"
        :headers="headers"
        :loading="reportsStore.loading"
        item-value="tenantId"
        show-expand
        class="elevation-0"
      >
        <template v-slot:item.netBillableDevices="{ item }">
          <strong>{{ item.netBillableDevices }}</strong>
        </template>
        <template v-slot:item.depErrors="{ item }">
          <span :class="item.depTransactionsByStatus.error > 0 ? 'text-error' : ''">
            {{ item.depTransactionsByStatus.error }}
          </span>
        </template>
        <template v-slot:expanded-row="{ columns, item }">
          <tr>
            <td :colspan="columns.length" class="pa-4" style="background: #fafafa;">
              <div class="d-flex flex-wrap ga-6">
                <div>
                  <div class="text-caption text-grey">DEP transactions</div>
                  <div>
                    <v-chip size="small" class="mr-1">OR: {{ item.depTransactionsByType.OR }}</v-chip>
                    <v-chip size="small" class="mr-1">RE: {{ item.depTransactionsByType.RE }}</v-chip>
                    <v-chip size="small" class="mr-1">VD: {{ item.depTransactionsByType.VD }}</v-chip>
                    <v-chip size="small" class="mr-1">OV: {{ item.depTransactionsByType.OV }}</v-chip>
                    <v-chip size="small">SC: {{ item.depTransactionsByType.SC }}</v-chip>
                  </div>
                </div>
                <div>
                  <div class="text-caption text-grey">By status</div>
                  <div>
                    <v-chip size="small" color="success" class="mr-1">complete: {{ item.depTransactionsByStatus.complete }}</v-chip>
                    <v-chip size="small" color="info" class="mr-1">in_progress: {{ item.depTransactionsByStatus.in_progress }}</v-chip>
                    <v-chip size="small" color="warning" class="mr-1">pending: {{ item.depTransactionsByStatus.pending }}</v-chip>
                    <v-chip size="small" color="error" class="mr-1">error: {{ item.depTransactionsByStatus.error }}</v-chip>
                    <v-chip size="small" color="error" v-if="item.depTransactionsByStatus.posted_with_errors > 0">posted_with_errors: {{ item.depTransactionsByStatus.posted_with_errors }}</v-chip>
                  </div>
                </div>
              </div>
              <div v-if="tenantSeries(item.tenantId)" class="mt-4">
                <div class="text-caption text-grey mb-1">Daily enrollments</div>
                <v-sparkline
                  :model-value="tenantSeries(item.tenantId)!.buckets.map((b) => b.devicesEnrolled)"
                  :labels="tenantSeries(item.tenantId)!.buckets.map((b) => b.date)"
                  line-width="2"
                  smooth
                  color="primary"
                  height="40"
                ></v-sparkline>
              </div>
            </td>
          </tr>
        </template>
        <template v-slot:bottom>
          <tr v-if="reportsStore.usageReport" class="font-weight-bold bg-grey-lighten-3">
            <td></td>
            <td>TOTALS</td>
            <td></td>
            <td class="text-right">{{ reportsStore.usageReport.totals.totalDevicesEnrolled }}</td>
            <td class="text-right">{{ reportsStore.usageReport.totals.totalDevicesReturned }}</td>
            <td class="text-right">{{ reportsStore.usageReport.totals.totalNetBillableDevices }}</td>
            <td class="text-right">{{ reportsStore.usageReport.totals.totalOrders }}</td>
            <td></td>
          </tr>
        </template>
      </v-data-table>
    </v-card>
  </div>
</template>
