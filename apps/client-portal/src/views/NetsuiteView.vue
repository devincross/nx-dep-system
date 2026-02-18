<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useNetsuiteStore } from '../stores/netsuite';
import type { NetsuiteStatus, NetsuiteResponse } from '../types';

const netsuiteStore = useNetsuiteStore();
const status = ref<NetsuiteStatus | null>(null);
const testResult = ref<{ success: boolean; message: string } | null>(null);
const loading = ref(false);
const error = ref('');

// Tab state
const activeTab = ref('status');

// Orders and Accounts data
const ordersResponse = ref<NetsuiteResponse | null>(null);
const accountsResponse = ref<NetsuiteResponse | null>(null);

// Generic RESTlet call
const restletScriptId = ref('');
const restletMethod = ref<'GET' | 'POST' | 'PUT' | 'DELETE'>('GET');
const restletData = ref('{}');
const restletResponse = ref<NetsuiteResponse | null>(null);

async function loadStatus() {
  loading.value = true;
  error.value = '';
  try {
    status.value = await netsuiteStore.fetchStatus();
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to load NetSuite status';
  } finally {
    loading.value = false;
  }
}

async function testConnection() {
  loading.value = true;
  error.value = '';
  testResult.value = null;
  try {
    testResult.value = await netsuiteStore.testConnection();
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to test connection';
  } finally {
    loading.value = false;
  }
}

async function fetchOrders() {
  loading.value = true;
  error.value = '';
  try {
    ordersResponse.value = await netsuiteStore.getOrders();
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to fetch orders';
  } finally {
    loading.value = false;
  }
}

async function fetchAccounts() {
  loading.value = true;
  error.value = '';
  try {
    accountsResponse.value = await netsuiteStore.getAccounts();
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to fetch accounts';
  } finally {
    loading.value = false;
  }
}

async function callRestlet() {
  loading.value = true;
  error.value = '';
  restletResponse.value = null;
  try {
    let data: Record<string, unknown> | undefined;
    if (restletData.value && restletMethod.value !== 'GET') {
      data = JSON.parse(restletData.value);
    }
    restletResponse.value = await netsuiteStore.callRestlet(restletScriptId.value, restletMethod.value, data);
  } catch (err: any) {
    if (err instanceof SyntaxError) {
      error.value = 'Invalid JSON in request data';
    } else {
      error.value = err.response?.data?.message || 'Failed to call RESTlet';
    }
  } finally {
    loading.value = false;
  }
}

onMounted(() => { loadStatus(); });
</script>

<template>
  <div>
    <h1 class="text-h4 mb-6">NetSuite Integration</h1>
    <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = ''">{{ error }}</v-alert>
    <v-tabs v-model="activeTab" color="primary">
      <v-tab value="status">Status</v-tab>
      <v-tab value="orders">Orders</v-tab>
      <v-tab value="accounts">Accounts</v-tab>
      <v-tab value="restlet">Generic RESTlet</v-tab>
    </v-tabs>
    <v-tabs-window v-model="activeTab">
      <!-- Status Tab -->
      <v-tabs-window-item value="status">
        <v-card class="mt-4">
          <v-card-title>NetSuite Credential Status</v-card-title>
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
        <v-card class="mt-4"><v-card-title>NetSuite Orders</v-card-title><v-card-actions><v-btn color="primary" :loading="loading" @click="fetchOrders" prepend-icon="mdi-download">Fetch Orders</v-btn></v-card-actions><v-card-text v-if="ordersResponse"><v-alert :type="ordersResponse.success ? 'success' : 'error'" class="mb-4">{{ ordersResponse.success ? 'Success' : ordersResponse.error }}</v-alert><pre v-if="ordersResponse.data" class="bg-grey-lighten-4 pa-4 rounded">{{ JSON.stringify(ordersResponse.data, null, 2) }}</pre></v-card-text></v-card>
      </v-tabs-window-item>
      <!-- Accounts Tab -->
      <v-tabs-window-item value="accounts">
        <v-card class="mt-4"><v-card-title>NetSuite Accounts</v-card-title><v-card-actions><v-btn color="primary" :loading="loading" @click="fetchAccounts" prepend-icon="mdi-download">Fetch Accounts</v-btn></v-card-actions><v-card-text v-if="accountsResponse"><v-alert :type="accountsResponse.success ? 'success' : 'error'" class="mb-4">{{ accountsResponse.success ? 'Success' : accountsResponse.error }}</v-alert><pre v-if="accountsResponse.data" class="bg-grey-lighten-4 pa-4 rounded">{{ JSON.stringify(accountsResponse.data, null, 2) }}</pre></v-card-text></v-card>
      </v-tabs-window-item>
      <!-- Generic RESTlet Tab -->
      <v-tabs-window-item value="restlet">
        <v-card class="mt-4"><v-card-title>Generic RESTlet Call</v-card-title><v-card-text><v-row><v-col cols="12" md="4"><v-text-field v-model="restletScriptId" label="Script ID" required></v-text-field></v-col><v-col cols="12" md="4"><v-select v-model="restletMethod" :items="['GET', 'POST', 'PUT', 'DELETE']" label="Method"></v-select></v-col></v-row><v-textarea v-model="restletData" label="Request Data (JSON)" rows="5" hint="Enter valid JSON for POST/PUT requests"></v-textarea></v-card-text><v-card-actions><v-btn color="primary" :loading="loading" @click="callRestlet" :disabled="!restletScriptId" prepend-icon="mdi-send">Call RESTlet</v-btn></v-card-actions><v-card-text v-if="restletResponse"><v-alert :type="restletResponse.success ? 'success' : 'error'" class="mb-4">{{ restletResponse.success ? 'Success' : restletResponse.error }}</v-alert><pre v-if="restletResponse.data" class="bg-grey-lighten-4 pa-4 rounded">{{ JSON.stringify(restletResponse.data, null, 2) }}</pre></v-card-text></v-card>
      </v-tabs-window-item>
    </v-tabs-window>
  </div>
</template>

