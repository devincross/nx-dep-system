<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import api from '../services/api';
import type { TenantInfo, HealthStatus, ConnectionStatus, SyncSummary, DepStatus } from '../types';
import { useAuthStore } from '../stores/auth';

const authStore = useAuthStore();
const tenantInfo = ref<TenantInfo | null>(null);
const healthStatus = ref<HealthStatus | null>(null);
const connectionStatus = ref<ConnectionStatus | null>(null);
const depStatus = ref<DepStatus | null>(null);
const syncSummary = ref<SyncSummary | null>(null);
const loading = ref(true);
const error = ref('');

const connectionTypeLabel = computed(() => {
  if (!tenantInfo.value) return '';
  return tenantInfo.value.tenant.connectionType === 'netsuite' ? 'NetSuite' : 'Zoho';
});

const connectionStatusColor = computed(() => {
  if (!connectionStatus.value) return 'grey';
  switch (connectionStatus.value.status) {
    case 'current': return 'success';
    case 'disabled': return 'warning';
    case 'not_configured': return 'error';
    case 'error': return 'error';
    default: return 'grey';
  }
});

const connectionStatusLabel = computed(() => {
  if (!connectionStatus.value) return 'Unknown';
  switch (connectionStatus.value.status) {
    case 'current': return 'Connected';
    case 'disabled': return 'Disabled';
    case 'not_configured': return 'Not Set Up';
    case 'error': return 'Error';
    default: return connectionStatus.value.status;
  }
});

const depStatusColor = computed(() => {
  if (!depStatus.value?.configured) return 'grey';
  if (depStatus.value.pendingCertUpload) return 'orange';
  if (depStatus.value.daysUntilExpiry !== undefined && depStatus.value.daysUntilExpiry < 0) return 'error';
  if (depStatus.value.daysUntilExpiry !== undefined && depStatus.value.daysUntilExpiry <= 30) return 'warning';
  if (depStatus.value.hasCertificate) return 'success';
  return 'grey';
});

const depStatusLabel = computed(() => {
  if (!depStatus.value?.configured) return 'Not Set Up';
  if (depStatus.value.pendingCertUpload) return 'Waiting for Apple';
  if (depStatus.value.daysUntilExpiry !== undefined && depStatus.value.daysUntilExpiry < 0) return 'Expired';
  if (depStatus.value.hasCertificate) return 'Active';
  return depStatus.value.status;
});

const syncStatusColor = computed(() => {
  const status = syncSummary.value?.orders?.status || syncSummary.value?.accounts?.status;
  if (!status) return 'grey';
  switch (status) {
    case 'success': return 'success';
    case 'running': return 'info';
    case 'pending': return 'warning';
    case 'error': return 'error';
    default: return 'grey';
  }
});

const formatNumber = (num: number) => new Intl.NumberFormat().format(num);
const formatDate = (dateStr?: string) => dateStr ? new Date(dateStr).toLocaleString() : 'Never';

async function fetchDashboardData() {
  loading.value = true;
  error.value = '';
  try {
    const [tenantRes, healthRes, connectionRes, depRes, syncRes] = await Promise.all([
      api.get<TenantInfo>('/tenant-info'),
      api.get<HealthStatus>('/health'),
      api.get<ConnectionStatus>('/connection-status'),
      api.get<DepStatus>('/dep-status').catch(() => ({ data: null })),
      api.get<SyncSummary>('/sync-status/summary').catch(() => ({ data: null })),
    ]);
    tenantInfo.value = tenantRes.data;
    healthStatus.value = healthRes.data;
    connectionStatus.value = connectionRes.data;
    depStatus.value = depRes.data;
    syncSummary.value = syncRes.data;
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Unable to load your dashboard. Please check your internet connection and try again.';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  fetchDashboardData();
});
</script>

<template>
  <div>
    <h1 class="text-h4 mb-6">Dashboard</h1>

    <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = ''">{{ error }}</v-alert>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4"></v-progress-linear>

    <v-row v-if="!loading">
      <!-- User Info Card -->
      <v-col cols="12" md="4">
        <v-card>
          <v-card-title><v-icon left>mdi-account</v-icon> User Profile</v-card-title>
          <v-card-text>
            <v-list>
              <v-list-item>
                <v-list-item-title>Name</v-list-item-title>
                <v-list-item-subtitle>{{ [authStore.user?.firstName, authStore.user?.lastName].filter(Boolean).join(' ') }}</v-list-item-subtitle>
              </v-list-item>
              <v-list-item>
                <v-list-item-title>Email</v-list-item-title>
                <v-list-item-subtitle>{{ authStore.user?.email }}</v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- ERP Connection Status Card -->
      <v-col cols="12" md="4">
        <v-card>
          <v-card-title><v-icon left>mdi-cloud-sync</v-icon> {{ connectionTypeLabel }} Connection</v-card-title>
          <v-card-text>
            <v-alert v-if="connectionStatus?.expirationWarning" :type="connectionStatus.expirationWarning.includes('expired') ? 'error' : 'warning'" density="compact" class="mb-3">
              {{ connectionStatus.expirationWarning }}
            </v-alert>
            <v-list v-if="connectionStatus" density="compact">
              <v-list-item>
                <v-list-item-title>Status</v-list-item-title>
                <template v-slot:append><v-chip :color="connectionStatusColor" size="small">{{ connectionStatusLabel }}</v-chip></template>
              </v-list-item>
              <v-list-item v-if="connectionStatus.certificateExpiresAt">
                <v-list-item-title>Certificate Expires</v-list-item-title>
                <template v-slot:append>{{ new Date(connectionStatus.certificateExpiresAt).toLocaleDateString() }}</template>
              </v-list-item>
            </v-list>
          </v-card-text>
          <v-card-actions>
            <v-btn color="primary" variant="text" :to="tenantInfo?.tenant.connectionType === 'netsuite' ? '/netsuite' : '/credentials'">
              <v-icon left>mdi-cog</v-icon> Configure
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>

      <!-- Apple DEP Connection Status Card -->
      <v-col cols="12" md="4">
        <v-card>
          <v-card-title><v-icon left>mdi-apple</v-icon> Apple Device Enrollment</v-card-title>
          <v-card-text>
            <!-- Expiration warning banner -->
            <v-alert
              v-if="depStatus?.expirationWarning"
              :type="depStatus.daysUntilExpiry !== undefined && depStatus.daysUntilExpiry < 0 ? 'error' : 'warning'"
              density="compact"
              class="mb-3"
            >
              <div class="d-flex align-center">
                <v-icon start size="small">mdi-certificate</v-icon>
                <span>{{ depStatus.expirationWarning }}</span>
              </div>
            </v-alert>

            <!-- Pending cert upload -->
            <v-alert v-if="depStatus?.pendingCertUpload" type="info" density="compact" class="mb-3">
              Your certificate request has been generated and is waiting for Apple to return the signed certificate. This typically takes 1-2 business days.
            </v-alert>

            <v-list v-if="depStatus" density="compact">
              <v-list-item>
                <v-list-item-title>Status</v-list-item-title>
                <template v-slot:append>
                  <v-chip :color="depStatusColor" size="small">{{ depStatusLabel }}</v-chip>
                </template>
              </v-list-item>
              <v-list-item v-if="depStatus.depResellerId">
                <v-list-item-title>Reseller ID</v-list-item-title>
                <template v-slot:append><span class="text-body-2">{{ depStatus.depResellerId }}</span></template>
              </v-list-item>
              <v-list-item v-if="depStatus.shipTo">
                <v-list-item-title>ShipTo</v-list-item-title>
                <template v-slot:append><span class="text-body-2">{{ depStatus.shipTo }}</span></template>
              </v-list-item>
              <v-list-item v-if="depStatus.soldTo">
                <v-list-item-title>SoldTo</v-list-item-title>
                <template v-slot:append><span class="text-body-2">{{ depStatus.soldTo }}</span></template>
              </v-list-item>
              <v-list-item v-if="depStatus.certificateExpiresAt">
                <v-list-item-title>Certificate Expires</v-list-item-title>
                <template v-slot:append>
                  <v-chip
                    :color="depStatus.daysUntilExpiry !== undefined && depStatus.daysUntilExpiry < 0 ? 'error' : depStatus.daysUntilExpiry !== undefined && depStatus.daysUntilExpiry <= 30 ? 'warning' : 'success'"
                    size="small"
                  >
                    {{ new Date(depStatus.certificateExpiresAt).toLocaleDateString() }}
                    <span v-if="depStatus.daysUntilExpiry !== undefined" class="ml-1">
                      ({{ depStatus.daysUntilExpiry < 0 ? 'expired — renewal required' : depStatus.daysUntilExpiry + ' days remaining' }})
                    </span>
                  </v-chip>
                </template>
              </v-list-item>
              <v-list-item v-if="depStatus.certificateSubject">
                <v-list-item-title>Subject</v-list-item-title>
                <v-list-item-subtitle class="text-caption">{{ depStatus.certificateSubject }}</v-list-item-subtitle>
              </v-list-item>
              <v-list-item v-if="depStatus.apiUrl">
                <v-list-item-title>API URL</v-list-item-title>
                <v-list-item-subtitle class="text-caption">{{ depStatus.apiUrl }}</v-list-item-subtitle>
              </v-list-item>
            </v-list>

            <div v-if="!depStatus?.configured" class="text-center text-grey pa-4">
              <v-icon size="36" color="grey">mdi-apple</v-icon>
              <div class="mt-2">Apple Device Enrollment is not set up yet.</div>
              <div class="text-caption mt-1">Go to Credentials to get started.</div>
            </div>
          </v-card-text>
          <v-card-actions>
            <v-btn color="primary" variant="text" to="/credentials">
              <v-icon left>mdi-cog</v-icon>
              {{ depStatus?.configured ? 'Manage' : 'Configure' }}
            </v-btn>
            <v-btn
              v-if="depStatus?.expirationWarning"
              color="warning"
              variant="text"
              to="/credentials/create"
            >
              <v-icon left>mdi-certificate</v-icon>
              Renew Certificate
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <!-- Sync Status Row -->
    <v-row class="mt-4">
      <v-col cols="12">
        <v-card>
          <v-card-title>
            <v-icon left>mdi-sync</v-icon>
            Sync Status
            <v-chip v-if="syncSummary" :color="syncStatusColor" size="small" class="ml-2">
              {{ syncSummary.orders?.status || syncSummary.accounts?.status || 'No sync yet' }}
            </v-chip>
          </v-card-title>
          <v-card-text>
            <v-row v-if="syncSummary">
              <v-col cols="12" md="4">
                <v-card variant="outlined">
                  <v-card-title class="text-subtitle-1">Data Totals</v-card-title>
                  <v-card-text>
                    <v-list density="compact">
                      <v-list-item>
                        <template v-slot:prepend><v-icon color="primary">mdi-domain</v-icon></template>
                        <v-list-item-title>Accounts</v-list-item-title>
                        <template v-slot:append><strong>{{ formatNumber(syncSummary.totals.totalAccounts) }}</strong></template>
                      </v-list-item>
                      <v-list-item>
                        <template v-slot:prepend><v-icon color="primary">mdi-package-variant-closed</v-icon></template>
                        <v-list-item-title>Orders</v-list-item-title>
                        <template v-slot:append><strong>{{ formatNumber(syncSummary.totals.totalOrders) }}</strong></template>
                      </v-list-item>
                      <v-list-item>
                        <template v-slot:prepend><v-icon color="primary">mdi-barcode</v-icon></template>
                        <v-list-item-title>Order Items</v-list-item-title>
                        <template v-slot:append><strong>{{ formatNumber(syncSummary.totals.totalOrderItems) }}</strong></template>
                      </v-list-item>
                    </v-list>
                  </v-card-text>
                </v-card>
              </v-col>
              <v-col cols="12" md="4">
                <v-card variant="outlined">
                  <v-card-title class="text-subtitle-1"><v-icon left size="small">mdi-domain</v-icon> Accounts Sync</v-card-title>
                  <v-card-text v-if="syncSummary.accounts">
                    <v-list density="compact">
                      <v-list-item><v-list-item-title>Last Sync</v-list-item-title><v-list-item-subtitle>{{ formatDate(syncSummary.accounts.lastSyncAt) }}</v-list-item-subtitle></v-list-item>
                      <v-list-item><v-list-item-title>Processed</v-list-item-title><v-list-item-subtitle>{{ formatNumber(syncSummary.accounts.recordsProcessed) }}</v-list-item-subtitle></v-list-item>
                      <v-list-item>
                        <v-list-item-title>Created / Updated</v-list-item-title>
                        <v-list-item-subtitle>
                          <v-chip color="success" size="x-small" class="mr-1">+{{ syncSummary.accounts.recordsCreated }}</v-chip>
                          <v-chip color="info" size="x-small">~{{ syncSummary.accounts.recordsUpdated }}</v-chip>
                        </v-list-item-subtitle>
                      </v-list-item>
                    </v-list>
                  </v-card-text>
                  <v-card-text v-else class="text-center text-grey">No accounts have been synced yet. Data will appear here after your first sync runs.</v-card-text>
                </v-card>
              </v-col>
              <v-col cols="12" md="4">
                <v-card variant="outlined">
                  <v-card-title class="text-subtitle-1"><v-icon left size="small">mdi-package-variant-closed</v-icon> Orders Sync</v-card-title>
                  <v-card-text v-if="syncSummary.orders">
                    <v-list density="compact">
                      <v-list-item><v-list-item-title>Last Sync</v-list-item-title><v-list-item-subtitle>{{ formatDate(syncSummary.orders.lastSyncAt) }}</v-list-item-subtitle></v-list-item>
                      <v-list-item><v-list-item-title>Processed</v-list-item-title><v-list-item-subtitle>{{ formatNumber(syncSummary.orders.recordsProcessed) }}</v-list-item-subtitle></v-list-item>
                      <v-list-item>
                        <v-list-item-title>Created / Updated</v-list-item-title>
                        <v-list-item-subtitle>
                          <v-chip color="success" size="x-small" class="mr-1">+{{ syncSummary.orders.recordsCreated }}</v-chip>
                          <v-chip color="info" size="x-small">~{{ syncSummary.orders.recordsUpdated }}</v-chip>
                        </v-list-item-subtitle>
                      </v-list-item>
                    </v-list>
                  </v-card-text>
                  <v-card-text v-else class="text-center text-grey">No orders have been synced yet. Data will appear here after your first sync runs.</v-card-text>
                </v-card>
              </v-col>
            </v-row>
            <div v-else class="text-center text-grey pa-4">
              <v-icon size="48" color="grey">mdi-sync-off</v-icon>
              <div class="mt-2">No sync data available yet.</div>
              <div class="text-caption mt-1">Once your connection is configured, data will sync automatically on a regular schedule.</div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Quick Links Row -->
    <v-row class="mt-4">
      <v-col cols="12" md="6">
        <v-card>
          <v-card-title><v-icon left>mdi-heart-pulse</v-icon> System Health</v-card-title>
          <v-card-text>
            <v-list v-if="healthStatus">
              <v-list-item>
                <v-list-item-title>Status</v-list-item-title>
                <template v-slot:append><v-chip :color="healthStatus.status === 'ok' ? 'success' : 'error'" size="small">{{ healthStatus.status }}</v-chip></template>
              </v-list-item>
              <v-list-item>
                <v-list-item-title>Last Updated</v-list-item-title>
                <v-list-item-subtitle>{{ new Date(healthStatus.timestamp).toLocaleString() }}</v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-card-text>
          <v-card-actions>
            <v-btn color="primary" variant="text" @click="fetchDashboardData" :loading="loading">
              <v-icon left>mdi-refresh</v-icon> Refresh
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
      <v-col cols="12" md="6">
        <v-card>
          <v-card-title>Quick Links</v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="12" sm="6">
                <v-btn block color="primary" variant="outlined" to="/orders" prepend-icon="mdi-package-variant-closed">Manage Orders</v-btn>
              </v-col>
              <v-col cols="12" sm="6">
                <v-btn block color="primary" variant="outlined" to="/credentials" prepend-icon="mdi-key-variant">Manage Credentials</v-btn>
              </v-col>
              <v-col cols="12" sm="6">
                <v-btn block color="primary" variant="outlined" to="/orders/historical-import" prepend-icon="mdi-database-import">Historical Import</v-btn>
              </v-col>
              <v-col cols="12" sm="6" v-if="tenantInfo?.tenant.connectionType === 'netsuite'">
                <v-btn block color="primary" variant="outlined" to="/netsuite" prepend-icon="mdi-cloud-sync">NetSuite Integration</v-btn>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>
