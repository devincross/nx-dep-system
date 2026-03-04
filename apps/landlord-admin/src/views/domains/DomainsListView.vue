<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useDomainsStore } from '../../stores/domains';
import type { Domain } from '../../types';

const domainsStore = useDomainsStore();
const deleteDialog = ref(false);
const domainToDelete = ref<Domain | null>(null);
const testingConnection = ref<string | null>(null);
const provisioningDatabase = ref<string | null>(null);
const testResult = ref<{ success: boolean; message: string } | null>(null);

onMounted(() => {
  domainsStore.fetchDomains();
});

function confirmDelete(domain: Domain) {
  domainToDelete.value = domain;
  deleteDialog.value = true;
}

async function deleteDomain() {
  if (domainToDelete.value) {
    await domainsStore.deleteDomain(domainToDelete.value.id);
    deleteDialog.value = false;
    domainToDelete.value = null;
  }
}

async function testConnection(domain: Domain) {
  testingConnection.value = domain.id;
  testResult.value = null;
  try {
    testResult.value = await domainsStore.testConnection(domain.id);
  } catch (err: any) {
    testResult.value = {
      success: false,
      message: err.response?.data?.message || 'Connection test failed',
    };
  } finally {
    testingConnection.value = null;
  }
}

async function provisionDatabase(domain: Domain) {
  provisioningDatabase.value = domain.id;
  testResult.value = null;
  try {
    testResult.value = await domainsStore.provisionDatabase(domain.id);
  } catch (err: any) {
    testResult.value = {
      success: false,
      message: err.response?.data?.message || 'Database provisioning failed',
    };
  } finally {
    provisioningDatabase.value = null;
  }
}
</script>

<template>
  <div>
    <div class="d-flex justify-space-between align-center mb-6">
      <h1 class="text-h4">Domains</h1>
      <v-btn color="primary" to="/domains/create" prepend-icon="mdi-plus">
        Add Domain
      </v-btn>
    </div>

    <v-alert v-if="testResult" :type="testResult.success ? 'success' : 'error'" class="mb-4" closable @click:close="testResult = null">
      {{ testResult.message }}
    </v-alert>

    <v-card>
      <v-data-table
        :items="domainsStore.domains"
        :headers="[
          { title: 'Domain', key: 'domain' },
          { title: 'Database', key: 'dbName' },
          { title: 'Host', key: 'dbHost' },
          { title: 'Primary', key: 'isPrimary' },
          { title: 'Actions', key: 'actions', sortable: false },
        ]"
        :loading="domainsStore.loading"
      >
        <template v-slot:item.isPrimary="{ item }">
          <v-icon :color="item.isPrimary ? 'success' : 'grey'">
            {{ item.isPrimary ? 'mdi-check-circle' : 'mdi-circle-outline' }}
          </v-icon>
        </template>
        <template v-slot:item.actions="{ item }">
          <v-btn icon size="small" :loading="testingConnection === item.id" @click="testConnection(item)" title="Test Connection">
            <v-icon>mdi-connection</v-icon>
          </v-btn>
          <v-btn icon size="small" color="primary" :loading="provisioningDatabase === item.id" @click="provisionDatabase(item)" title="Provision Database">
            <v-icon>mdi-database-sync</v-icon>
          </v-btn>
          <v-btn icon size="small" :to="`/domains/${item.id}/edit`" title="Edit">
            <v-icon>mdi-pencil</v-icon>
          </v-btn>
          <v-btn icon size="small" color="error" @click="confirmDelete(item)" title="Delete">
            <v-icon>mdi-delete</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </v-card>

    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>Confirm Delete</v-card-title>
        <v-card-text>
          Are you sure you want to delete domain "{{ domainToDelete?.domain }}"?
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" @click="deleteDomain">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

