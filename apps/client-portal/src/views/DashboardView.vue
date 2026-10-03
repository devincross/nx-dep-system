<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import api from '../services/api';
import type { TenantInfo, HealthStatus, ConnectionStatus, SyncSummary, SyncStatusResult, DepStatus, AttentionIssue, AttentionType } from '../types';
import { useAuthStore } from '../stores/auth';

const authStore = useAuthStore();
const tenantInfo = ref<TenantInfo | null>(null);
const healthStatus = ref<HealthStatus | null>(null);
const connectionStatus = ref<ConnectionStatus | null>(null);
const depStatus = ref<DepStatus | null>(null);
const syncSummary = ref<SyncSummary | null>(null);
const syncFetchFailed = ref(false);
const attention = ref<AttentionIssue[] | null>(null);
const attentionError = ref(false);
const ATTENTION_SHOWN = 10;
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

// Collapse a sync run into what the user should see: stale runs outrank the stored status
function syncHealth(r: SyncStatusResult | null | undefined): { label: string; color: string; rank: number } {
  if (!r) return { label: 'Not run yet', color: 'grey', rank: 0 };
  if (r.stale === 'stuck_running') return { label: 'Stuck', color: 'error', rank: 3 };
  if (r.status === 'error') return { label: 'Failed', color: 'error', rank: 3 };
  if (r.stale === 'overdue') return { label: 'Not running', color: 'warning', rank: 2 };
  if (r.status === 'running') return { label: 'Running', color: 'info', rank: 1 };
  if (r.status === 'pending') return { label: 'Pending', color: 'warning', rank: 1 };
  if (r.recordsErrored > 0) return { label: 'Partial errors', color: 'warning', rank: 2 };
  return { label: 'Healthy', color: 'success', rank: 0 };
}

const syncCards = computed(() => {
  const summary = syncSummary.value;
  if (!summary) return [];
  return [
    { key: 'accounts', title: 'Accounts Sync', icon: 'mdi-domain', noun: 'accounts', result: summary.accounts },
    { key: 'orders', title: 'Orders Sync', icon: 'mdi-package-variant-closed', noun: 'orders', result: summary.orders },
  ].map((c) => ({ ...c, health: syncHealth(c.result) }));
});

// Overall chip shows the worst of the two, so one failing sync can't hide behind the other
const overallSync = computed(() => {
  const cards = syncCards.value.filter((c) => c.result);
  if (cards.length === 0) return { label: 'No sync yet', color: 'grey' };
  return cards.reduce((worst, c) => (c.health.rank > worst.rank ? c.health : worst), cards[0].health);
});

const staleMessage: Record<string, string> = {
  stuck_running: 'This sync has been running for over 30 minutes and is probably stuck. Contact support if it does not clear.',
  overdue: 'No sync has run in over an hour. Syncing may be paused, or the connection may need attention.',
};

const attentionLabels: Record<AttentionType, { label: string; color: string }> = {
  order_error: { label: 'Apple error', color: 'error' },
  missing_dep_account: { label: 'Missing Apple org ID', color: 'error' },
  unsynced_changes: { label: 'Not sent to Apple', color: 'warning' },
  stuck_transaction: { label: 'No result from Apple', color: 'warning' },
};

async function fetchAttention() {
  attentionError.value = false;
  try {
    attention.value = (await api.get<AttentionIssue[]>('/orders/needs-attention')).data;
  } catch {
    attention.value = null;
    attentionError.value = true;
  }
}

const formatNumber = (num: number) => new Intl.NumberFormat().format(num);
const formatDate = (dateStr?: string) => dateStr ? new Date(dateStr).toLocaleString() : 'Never';

async function fetchDashboardData() {
  loading.value = true;
  error.value = '';
  syncFetchFailed.value = false;
  try {
    const [tenantRes, healthRes, connectionRes, depRes, syncRes] = await Promise.all([
      api.get<TenantInfo>('/tenant-info'),
      api.get<HealthStatus>('/health'),
      api.get<ConnectionStatus>('/connection-status'),
      api.get<DepStatus>('/dep-status').catch(() => ({ data: null })),
      api.get<SyncSummary>('/sync-status/summary').catch(() => { syncFetchFailed.value = true; return { data: null }; }),
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
  fetchAttention();
});
</script>

<template>
  <div>
    <h1 class="text-h4 mb-6">Dashboard</h1>

    <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = ''">{{ error }}</v-alert>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4"></v-progress-linear>

    <!-- Needs Attention -->
    <v-card class="mb-4" variant="outlined">
      <v-card-title class="d-flex justify-space-between align-center">
        <span><v-icon left :color="attention?.length ? 'warning' : 'success'">{{ attention?.length ? 'mdi-alert-circle' : 'mdi-check-circle' }}</v-icon> Needs Attention<span v-if="attention?.length"> ({{ attention.length }})</span></span>
        <v-btn size="small" variant="text" icon="mdi-refresh" @click="fetchAttention" title="Refresh"></v-btn>
      </v-card-title>
      <v-card-text>
        <v-alert v-if="attentionError" type="warning" variant="tonal" density="compact">
          Unable to check for problems right now. Please refresh to try again.
        </v-alert>
        <div v-else-if="attention === null" class="text-grey">Checking…</div>
        <div v-else-if="attention.length === 0" class="text-success">Everything is flowing — no orders need attention.</div>
        <template v-else>
          <v-list density="compact" lines="two">
            <v-list-item v-for="(issue, i) in attention.slice(0, ATTENTION_SHOWN)" :key="`${issue.orderId}-${issue.type}-${i}`" :to="`/orders/${issue.orderId}`">
              <template v-slot:prepend>
                <v-chip :color="attentionLabels[issue.type].color" size="small" class="mr-3">{{ attentionLabels[issue.type].label }}</v-chip>
              </template>
              <v-list-item-title>Order #{{ issue.orderId }}<span v-if="issue.externalOrderId" class="text-grey"> · {{ issue.externalOrderId }}</span></v-list-item-title>
              <v-list-item-subtitle>{{ issue.message }}<span v-if="issue.since"> Since {{ formatDate(issue.since) }}.</span></v-list-item-subtitle>
            </v-list-item>
          </v-list>
          <div v-if="attention.length > ATTENTION_SHOWN" class="text-caption text-grey mt-2">
            +{{ attention.length - ATTENTION_SHOWN }} more — resolve the above and refresh.
          </div>
        </template>
      </v-card-text>
    </v-card>

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
            <v-chip v-if="syncSummary" :color="overallSync.color" size="small" class="ml-2">{{ overallSync.label }}</v-chip>
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
              <v-col v-for="card in syncCards" :key="card.key" cols="12" md="4">
                <v-card variant="outlined">
                  <v-card-title class="text-subtitle-1 d-flex align-center">
                    <v-icon left size="small" class="mr-1">{{ card.icon }}</v-icon> {{ card.title }}
                    <v-chip :color="card.health.color" size="x-small" class="ml-2">{{ card.health.label }}</v-chip>
                  </v-card-title>
                  <v-card-text v-if="card.result">
                    <v-alert v-if="card.result.stale" type="warning" variant="tonal" density="compact" class="mb-2">{{ staleMessage[card.result.stale] }}</v-alert>
                    <v-alert v-if="card.result.status === 'error' || card.result.recordsErrored > 0" type="error" variant="tonal" density="compact" class="mb-2">
                      <template v-if="card.result.errorMessage">{{ card.result.errorMessage }}</template>
                      <template v-else>{{ card.result.recordsErrored }} {{ card.noun }} could not be processed in the last run.</template>
                    </v-alert>
                    <v-list density="compact">
                      <v-list-item><v-list-item-title>Last Attempt</v-list-item-title><v-list-item-subtitle>{{ formatDate(card.result.lastSyncAt) }}</v-list-item-subtitle></v-list-item>
                      <v-list-item><v-list-item-title>Last Success</v-list-item-title><v-list-item-subtitle>{{ formatDate(card.result.lastSuccessAt) }}</v-list-item-subtitle></v-list-item>
                      <v-list-item>
                        <v-list-item-title>New / Processed</v-list-item-title>
                        <v-list-item-subtitle>
                          <strong :class="card.result.recordsCreated + card.result.recordsUpdated > 0 ? 'text-success' : ''">{{ formatNumber(card.result.recordsCreated + card.result.recordsUpdated) }}</strong>
                          / {{ formatNumber(card.result.recordsProcessed) }}
                          <span v-if="card.result.recordsErrored > 0" class="text-error"> ({{ card.result.recordsErrored }} errors)</span>
                          <div v-if="card.result.status === 'success' && card.result.recordsCreated + card.result.recordsUpdated === 0" class="text-caption text-grey">Nothing new to sync in the last run.</div>
                        </v-list-item-subtitle>
                      </v-list-item>
                      <v-list-item>
                        <v-list-item-title>Created / Updated</v-list-item-title>
                        <v-list-item-subtitle>
                          <v-chip color="success" size="x-small" class="mr-1">+{{ card.result.recordsCreated }}</v-chip>
                          <v-chip color="info" size="x-small">~{{ card.result.recordsUpdated }}</v-chip>
                        </v-list-item-subtitle>
                      </v-list-item>
                    </v-list>
                  </v-card-text>
                  <v-card-text v-else class="text-center text-grey">No {{ card.noun }} have been synced yet. Data will appear here after your first sync runs.</v-card-text>
                </v-card>
              </v-col>
            </v-row>
            <v-alert v-else-if="syncFetchFailed" type="warning" variant="tonal" density="compact">
              Unable to load sync status right now. Please refresh to try again.
            </v-alert>
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
