<script setup lang="ts">
import { ref, onMounted } from 'vue';
import api from '../services/api';
import type { TenantInfo, HealthStatus } from '../types';
import { useAuthStore } from '../stores/auth';

const authStore = useAuthStore();
const tenantInfo = ref<TenantInfo | null>(null);
const healthStatus = ref<HealthStatus | null>(null);
const loading = ref(true);
const error = ref('');

async function fetchDashboardData() {
  loading.value = true;
  error.value = '';
  try {
    const [tenantRes, healthRes] = await Promise.all([
      api.get<TenantInfo>('/tenant-info'),
      api.get<HealthStatus>('/health'),
    ]);
    tenantInfo.value = tenantRes.data;
    healthStatus.value = healthRes.data;
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

      <!-- Health Status Card -->
      <v-col cols="12" md="4">
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
    </v-row>

    <!-- Quick Links -->
    <v-row class="mt-4">
      <v-col cols="12">
        <v-card>
          <v-card-title>Quick Links</v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="12" sm="4">
                <v-btn block color="primary" variant="outlined" to="/orders" prepend-icon="mdi-package-variant-closed">
                  Manage Orders
                </v-btn>
              </v-col>
              <v-col cols="12" sm="4">
                <v-btn block color="primary" variant="outlined" to="/credentials" prepend-icon="mdi-key-variant">
                  Manage Credentials
                </v-btn>
              </v-col>
              <v-col cols="12" sm="4">
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

