<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import api from '../services/api';
import type { TenantInfo, HealthStatus, ConnectionStatus } from '../types';
import { useAuthStore } from '../stores/auth';

const authStore = useAuthStore();
const tenantInfo = ref<TenantInfo | null>(null);
const healthStatus = ref<HealthStatus | null>(null);
const connectionStatus = ref<ConnectionStatus | null>(null);
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
    case 'not_configured': return 'Not Configured';
    case 'error': return 'Error';
    default: return connectionStatus.value.status;
  }
});

async function fetchDashboardData() {
  loading.value = true;
  error.value = '';
  try {
    const [tenantRes, healthRes, connectionRes] = await Promise.all([
      api.get<TenantInfo>('/tenant-info'),
      api.get<HealthStatus>('/health'),
      api.get<ConnectionStatus>('/connection-status'),
    ]);
    tenantInfo.value = tenantRes.data;
    healthStatus.value = healthRes.data;
    connectionStatus.value = connectionRes.data;
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to load dashboard data';
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

    <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = ''">
      {{ error }}
    </v-alert>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4"></v-progress-linear>

    <v-row v-if="!loading">
      <!-- User Info Card -->
      <v-col cols="12" md="4">
        <v-card>
          <v-card-title>
            <v-icon left>mdi-account</v-icon>
            User Profile
          </v-card-title>
          <v-card-text>
            <v-list>
              <v-list-item>
                <v-list-item-title>Name</v-list-item-title>
                <v-list-item-subtitle>{{ authStore.user?.name }}</v-list-item-subtitle>
              </v-list-item>
              <v-list-item>
                <v-list-item-title>Email</v-list-item-title>
                <v-list-item-subtitle>{{ authStore.user?.email }}</v-list-item-subtitle>
              </v-list-item>
              <v-list-item>
                <v-list-item-title>Status</v-list-item-title>
                <v-list-item-subtitle>
                  <v-chip :color="authStore.user?.status === 'active' ? 'success' : 'warning'" size="small">
                    {{ authStore.user?.status }}
                  </v-chip>
                </v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Tenant Info Card -->
      <v-col cols="12" md="4">
        <v-card>
          <v-card-title>
            <v-icon left>mdi-domain</v-icon>
            Tenant Information
          </v-card-title>
          <v-card-text>
            <v-list v-if="tenantInfo">
              <v-list-item>
                <v-list-item-title>Tenant Name</v-list-item-title>
                <v-list-item-subtitle>{{ tenantInfo.tenant.name }}</v-list-item-subtitle>
              </v-list-item>
              <v-list-item>
                <v-list-item-title>Slug</v-list-item-title>
                <v-list-item-subtitle>{{ tenantInfo.tenant.slug }}</v-list-item-subtitle>
              </v-list-item>
              <v-list-item>
                <v-list-item-title>Domain</v-list-item-title>
                <v-list-item-subtitle>{{ tenantInfo.domain.domain }}</v-list-item-subtitle>
              </v-list-item>
              <v-list-item>
                <v-list-item-title>Primary Domain</v-list-item-title>
                <v-list-item-subtitle>
                  <v-chip :color="tenantInfo.domain.isPrimary ? 'success' : 'default'" size="small">
                    {{ tenantInfo.domain.isPrimary ? 'Yes' : 'No' }}
                  </v-chip>
                </v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Connection Status Card -->
      <v-col cols="12" md="4">
        <v-card>
          <v-card-title>
            <v-icon left>mdi-cloud-sync</v-icon>
            {{ connectionTypeLabel }} Connection
          </v-card-title>
          <v-card-text>
            <v-alert
              v-if="connectionStatus?.expirationWarning"
              :type="connectionStatus.expirationWarning.includes('expired') ? 'error' : 'warning'"
              density="compact"
              class="mb-3"
            >
              <v-icon left>mdi-certificate</v-icon>
              {{ connectionStatus.expirationWarning }}
            </v-alert>
            <v-list v-if="connectionStatus">
              <v-list-item>
                <v-list-item-title>Connection Type</v-list-item-title>
                <v-list-item-subtitle>
                  <v-chip color="primary" size="small">
                    {{ connectionTypeLabel }}
                  </v-chip>
                </v-list-item-subtitle>
              </v-list-item>
              <v-list-item>
                <v-list-item-title>Status</v-list-item-title>
                <v-list-item-subtitle>
                  <v-chip :color="connectionStatusColor" size="small">
                    {{ connectionStatusLabel }}
                  </v-chip>
                </v-list-item-subtitle>
              </v-list-item>
              <v-list-item v-if="connectionStatus.certificateExpiresAt">
                <v-list-item-title>Certificate Expires</v-list-item-title>
                <v-list-item-subtitle>
                  <v-chip
                    :color="connectionStatus.expirationWarning ? (connectionStatus.expirationWarning.includes('expired') ? 'error' : 'warning') : 'success'"
                    size="small"
                  >
                    {{ new Date(connectionStatus.certificateExpiresAt).toLocaleDateString() }}
                  </v-chip>
                </v-list-item-subtitle>
              </v-list-item>
              <v-list-item v-if="connectionStatus.configured && connectionStatus.updatedAt">
                <v-list-item-title>Last Updated</v-list-item-title>
                <v-list-item-subtitle>{{ new Date(connectionStatus.updatedAt).toLocaleString() }}</v-list-item-subtitle>
              </v-list-item>
              <v-list-item v-if="connectionStatus.message">
                <v-list-item-title>Message</v-list-item-title>
                <v-list-item-subtitle>{{ connectionStatus.message }}</v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-card-text>
          <v-card-actions>
            <v-btn
              color="primary"
              variant="text"
              :to="tenantInfo?.tenant.connectionType === 'netsuite' ? '/netsuite' : '/credentials'"
            >
              <v-icon left>mdi-cog</v-icon>
              Configure
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <!-- System Health Row -->
    <v-row class="mt-4">
      <v-col cols="12" md="6">
        <v-card>
          <v-card-title>
            <v-icon left>mdi-heart-pulse</v-icon>
            System Health
          </v-card-title>
          <v-card-text>
            <v-list v-if="healthStatus">
              <v-list-item>
                <v-list-item-title>Status</v-list-item-title>
                <v-list-item-subtitle>
                  <v-chip :color="healthStatus.status === 'ok' ? 'success' : 'error'" size="small">
                    {{ healthStatus.status }}
                  </v-chip>
                </v-list-item-subtitle>
              </v-list-item>
              <v-list-item>
                <v-list-item-title>Last Updated</v-list-item-title>
                <v-list-item-subtitle>{{ new Date(healthStatus.timestamp).toLocaleString() }}</v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-card-text>
          <v-card-actions>
            <v-btn color="primary" variant="text" @click="fetchDashboardData" :loading="loading">
              <v-icon left>mdi-refresh</v-icon>
              Refresh
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>

      <!-- Quick Links -->
      <v-col cols="12" md="6">
        <v-card>
          <v-card-title>Quick Links</v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="12" sm="6">
                <v-btn block color="primary" variant="outlined" to="/orders" prepend-icon="mdi-package-variant-closed">
                  Manage Orders
                </v-btn>
              </v-col>
              <v-col cols="12" sm="6">
                <v-btn block color="primary" variant="outlined" to="/credentials" prepend-icon="mdi-key-variant">
                  Manage Credentials
                </v-btn>
              </v-col>
              <v-col cols="12" sm="6" v-if="tenantInfo?.tenant.connectionType === 'netsuite'">
                <v-btn block color="primary" variant="outlined" to="/netsuite" prepend-icon="mdi-cloud-sync">
                  NetSuite Integration
                </v-btn>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

