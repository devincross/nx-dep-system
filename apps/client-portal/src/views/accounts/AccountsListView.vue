<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useAccountsStore } from '../../stores/accounts';
import type { SyncAllAccountsResult } from '../../types';

const accountsStore = useAccountsStore();
const search = ref('');
const error = ref('');
const syncResult = ref<SyncAllAccountsResult | null>(null);

const headers = [
  { title: 'ID', key: 'id', sortable: true },
  { title: 'Name', key: 'name', sortable: true },
  { title: 'External Account ID', key: 'externalAccountId', sortable: true },
  { title: 'DEP Account ID', key: 'depAccountId', sortable: true },
  { title: 'Updated', key: 'updatedAt', sortable: true },
];

async function load() {
  error.value = '';
  try {
    await accountsStore.fetchAll(search.value || undefined);
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Unable to load accounts.';
  }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 300);
}

async function syncAll() {
  error.value = '';
  syncResult.value = null;
  try {
    syncResult.value = await accountsStore.syncAll();
    await load();
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Unable to sync accounts.';
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="d-flex align-center mb-4">
      <h1 class="text-h4">Accounts</h1>
      <v-spacer></v-spacer>
      <v-btn
        color="primary"
        :loading="accountsStore.syncing"
        @click="syncAll"
        prepend-icon="mdi-cloud-sync"
      >Sync All from NetSuite</v-btn>
    </div>

    <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = ''">{{ error }}</v-alert>

    <v-alert
      v-if="syncResult"
      type="success" variant="tonal" class="mb-4" closable
      @click:close="syncResult = null"
    >
      Fetched {{ syncResult.fetched }} from NetSuite —
      {{ syncResult.created }} created, {{ syncResult.updated }} updated, {{ syncResult.skipped }} skipped.
    </v-alert>

    <v-card>
      <v-card-title>
        <v-row align="center" no-gutters>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="search"
              label="Search by name, external ID, or DEP ID"
              prepend-inner-icon="mdi-magnify"
              clearable
              density="compact"
              hide-details
              @update:model-value="onSearchInput"
            ></v-text-field>
          </v-col>
        </v-row>
      </v-card-title>
      <v-data-table
        :headers="headers"
        :items="accountsStore.accounts"
        :loading="accountsStore.loading"
        :sort-by="[{ key: 'id', order: 'desc' }]"
        class="elevation-1"
        item-value="id"
      >
        <template v-slot:item.updatedAt="{ item }">
          <span class="text-caption">{{ new Date(item.updatedAt).toLocaleString() }}</span>
        </template>
        <template v-slot:no-data>
          <div class="text-center text-grey pa-4">
            {{ search ? 'No accounts match your search.' : 'No accounts synced yet. Click "Sync All from NetSuite" to import them.' }}
          </div>
        </template>
      </v-data-table>
    </v-card>
  </div>
</template>
