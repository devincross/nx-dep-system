<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useReportsStore } from '../../stores/reports';

const reportsStore = useReportsStore();
const selectedDays = ref(30);
const dayOptions = [
  { title: 'Last 7 days', value: 7 },
  { title: 'Last 30 days', value: 30 },
  { title: 'Last 60 days', value: 60 },
  { title: 'Last 90 days', value: 90 },
];

const headers = [
  { title: 'Tenant', key: 'tenantName' },
  { title: 'Slug', key: 'tenantSlug' },
  { title: 'Domain', key: 'domain' },
  { title: 'Orders', key: 'orderCount', align: 'end' as const },
  { title: 'Order Items', key: 'orderItemCount', align: 'end' as const },
  { title: 'Avg Items/Order', key: 'avgItemsPerOrder', align: 'end' as const },
];

onMounted(() => {
  reportsStore.fetchUsageReport(selectedDays.value);
});

async function refreshReport() {
  await reportsStore.fetchUsageReport(selectedDays.value);
}

function exportCsv() {
  reportsStore.exportToCsv();
}
</script>

<template>
  <div>
    <div class="d-flex justify-space-between align-center mb-6">
      <h1 class="text-h4">Usage Report</h1>
      <div class="d-flex ga-2">
        <v-select
          v-model="selectedDays"
          :items="dayOptions"
          density="compact"
          hide-details
          style="width: 180px"
          @update:model-value="refreshReport"
        ></v-select>
        <v-btn color="primary" prepend-icon="mdi-refresh" @click="refreshReport" :loading="reportsStore.loading">
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

    <v-card>
      <v-card-text v-if="reportsStore.usageReport" class="text-caption text-grey">
        Generated: {{ new Date(reportsStore.usageReport.generatedAt).toLocaleString() }}
        | Period: Last {{ reportsStore.usageReport.periodDays }} days
      </v-card-text>
      <v-data-table
        :items="reportsStore.usageReport?.tenants || []"
        :headers="headers"
        :loading="reportsStore.loading"
        class="elevation-0"
      >
        <template v-slot:item.avgItemsPerOrder="{ item }">
          {{ item.avgItemsPerOrder.toFixed(2) }}
        </template>
        <template v-slot:bottom>
          <tr v-if="reportsStore.usageReport" class="font-weight-bold bg-grey-lighten-3">
            <td colspan="3" class="text-right">TOTALS:</td>
            <td class="text-right">{{ reportsStore.usageReport.totals.totalOrders }}</td>
            <td class="text-right">{{ reportsStore.usageReport.totals.totalOrderItems }}</td>
            <td class="text-right">{{ reportsStore.usageReport.totals.avgItemsPerOrder.toFixed(2) }}</td>
          </tr>
        </template>
      </v-data-table>
    </v-card>
  </div>
</template>

