<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useZohoStore } from '../stores/zoho';
import type { ZohoStatus, ZohoResponse } from '../types';

const zohoStore = useZohoStore();
const status = ref<ZohoStatus | null>(null);
const testResult = ref<{ success: boolean; message: string } | null>(null);
const loading = ref(false);
const error = ref('');

// Tab state
const activeTab = ref('status');

// Orders and Accounts data
const ordersResponse = ref<ZohoResponse | null>(null);
const accountsResponse = ref<ZohoResponse | null>(null);
const ordersSince = ref('');
const accountsSince = ref('');

async function loadStatus() {
  loading.value = true;
  error.value = '';
  try {
    status.value = await zohoStore.fetchStatus();
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Unable to load your Zoho connection status. Please try again.';
  } finally {
    loading.value = false;
  }
}

async function testConnection() {
  loading.value = true;
  error.value = '';
  testResult.value = null;
  try {
    testResult.value = await zohoStore.testConnection();
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Connection test failed. Please check your Zoho credentials and try again.';
  } finally {
    loading.value = false;
  }
}

async function fetchOrders() {
  loading.value = true;
  error.value = '';
  try {
    const query = ordersSince.value ? { since: ordersSince.value } : undefined;
    ordersResponse.value = await zohoStore.getOrders(query);
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Unable to retrieve orders from Zoho. Please check your connection and try again.';
  } finally {
    loading.value = false;
  }
}

async function fetchAccounts() {
  loading.value = true;
  error.value = '';
  try {
    const query = accountsSince.value ? { since: accountsSince.value } : undefined;
    accountsResponse.value = await zohoStore.getAccounts(query);
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Unable to retrieve accounts from Zoho. Please check your connection and try again.';
  } finally {
    loading.value = false;
  }
}

onMounted(() => { loadStatus(); });
</script>

<template>
  <div>
    <h1 class="text-h4 mb-6">Zoho Integration</h1>
    <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = ''">{{ error }}</v-alert>
    <v-tabs v-model="activeTab" color="primary">
      <v-tab value="status">Connection Status</v-tab>
      <v-tab value="orders">Orders</v-tab>
      <v-tab value="accounts">Accounts</v-tab>
    </v-tabs>
    <v-tabs-window v-model="activeTab">
      <!-- Status Tab -->
      <v-tabs-window-item value="status">
        <v-card class="mt-4">
          <v-card-title>Zoho Connection Details</v-card-title>
          <v-card-text>
            <v-progress-linear v-if="loading && !status" indeterminate color="primary"></v-progress-linear>
            <v-list v-if="status" dense>
              <v-list-item><v-list-item-title>ID</v-list-item-title><v-list-item-subtitle>{{ status.id }}</v-list-item-subtitle></v-list-item>
              <v-list-item><v-list-item-title>Status</v-list-item-title><v-list-item-subtitle><v-chip :color="status.status === 'current' ? 'success' : 'warning'" size="small">{{ status.status }}</v-chip></v-list-item-subtitle></v-list-item>
              <v-list-item><v-list-item-title>Created</v-list-item-title><v-list-item-subtitle>{{ new Date(status.createdAt).toLocaleString() }}</v-list-item-subtitle></v-list-item>
              <v-list-item><v-list-item-title>Updated</v-list-item-title><v-list-item-subtitle>{{ new Date(status.updatedAt).toLocaleString() }}</v-list-item-subtitle></v-list-item>
            </v-list>
          </v-card-text>
          <v-card-actions>
            <v-btn color="primary" :loading="loading" @click="loadStatus" prepend-icon="mdi-refresh">Refresh</v-btn>
            <v-btn color="secondary" :loading="loading" @click="testConnection" prepend-icon="mdi-connection">Test Connection</v-btn>
          </v-card-actions>
          <v-card-text v-if="testResult">
            <v-alert :type="testResult.success ? 'success' : 'error'">{{ testResult.message }}</v-alert>
          </v-card-text>
        </v-card>
      </v-tabs-window-item>
      <!-- Orders Tab -->
      <v-tabs-window-item value="orders">
        <v-card class="mt-4">
          <v-card-title>Zoho Orders</v-card-title>
          <v-card-text>
            <v-text-field
              v-model="ordersSince"
              type="date"
              label="Modified Since"
              hint="Leave blank to fetch the most recent orders"
              persistent-hint
              clearable
            ></v-text-field>
          </v-card-text>
          <v-card-actions>
            <v-btn color="primary" :loading="loading" @click="fetchOrders" prepend-icon="mdi-download">Fetch Orders</v-btn>
          </v-card-actions>
          <v-card-text v-if="ordersResponse">
            <v-alert :type="ordersResponse.success ? 'success' : 'error'" class="mb-4">{{ ordersResponse.success ? 'Success' : ordersResponse.error }}</v-alert>
            <pre v-if="ordersResponse.data" class="bg-grey-lighten-4 pa-4 rounded">{{ JSON.stringify(ordersResponse.data, null, 2) }}</pre>
          </v-card-text>
        </v-card>
      </v-tabs-window-item>
      <!-- Accounts Tab -->
      <v-tabs-window-item value="accounts">
        <v-card class="mt-4">
          <v-card-title>Zoho Accounts</v-card-title>
          <v-card-text>
            <v-text-field
              v-model="accountsSince"
              type="date"
              label="Modified Since"
              hint="Leave blank to fetch the most recent accounts"
              persistent-hint
              clearable
            ></v-text-field>
          </v-card-text>
          <v-card-actions>
            <v-btn color="primary" :loading="loading" @click="fetchAccounts" prepend-icon="mdi-download">Fetch Accounts</v-btn>
          </v-card-actions>
          <v-card-text v-if="accountsResponse">
            <v-alert :type="accountsResponse.success ? 'success' : 'error'" class="mb-4">{{ accountsResponse.success ? 'Success' : accountsResponse.error }}</v-alert>
            <pre v-if="accountsResponse.data" class="bg-grey-lighten-4 pa-4 rounded">{{ JSON.stringify(accountsResponse.data, null, 2) }}</pre>
          </v-card-text>
        </v-card>
      </v-tabs-window-item>
    </v-tabs-window>
  </div>
</template>
