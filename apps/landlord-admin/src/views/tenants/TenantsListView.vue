<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useTenantsStore } from '../../stores/tenants';
import type { Tenant } from '../../types';

const tenantsStore = useTenantsStore();
const deleteDialog = ref(false);
const tenantToDelete = ref<Tenant | null>(null);

// Migration state
const migrateDialog = ref(false);
const migrating = ref(false);
const migrateResults = ref<{
  total: number;
  succeeded: number;
  failed: number;
  results: { tenant: string; success: boolean; message: string }[];
} | null>(null);
const migrateError = ref('');

onMounted(() => {
  tenantsStore.fetchTenants();
});

function confirmDelete(tenant: Tenant) {
  tenantToDelete.value = tenant;
  deleteDialog.value = true;
}

async function deleteTenant() {
  if (tenantToDelete.value) {
    await tenantsStore.deleteTenant(tenantToDelete.value.id);
    deleteDialog.value = false;
    tenantToDelete.value = null;
  }
}

async function runMigrateAll() {
  migrating.value = true;
  migrateError.value = '';
  migrateResults.value = null;
  migrateDialog.value = true;

  try {
    migrateResults.value = await tenantsStore.migrateAllTenants();
  } catch (err: any) {
    migrateError.value = err.response?.data?.message || err.message || 'Migration failed';
  } finally {
    migrating.value = false;
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case 'active': return 'success';
    case 'inactive': return 'grey';
    case 'suspended': return 'error';
    default: return 'grey';
  }
}
</script>

<template>
  <div>
    <div class="d-flex justify-space-between align-center mb-6">
      <h1 class="text-h4">Tenants</h1>
      <div class="d-flex ga-2">
        <v-btn
          color="warning"
          variant="outlined"
          prepend-icon="mdi-database-sync"
          :loading="migrating"
          @click="runMigrateAll"
        >
          Run Migrations
        </v-btn>
        <v-btn color="primary" to="/tenants/create" prepend-icon="mdi-plus">
          Add Tenant
        </v-btn>
      </div>
    </div>

    <v-card>
      <v-data-table
        :items="tenantsStore.tenants"
        :headers="[
          { title: 'Name', key: 'name' },
          { title: 'Slug', key: 'slug' },
          { title: 'Status', key: 'status' },
          { title: 'Sync', key: 'syncEnabled' },
          { title: 'Created', key: 'createdAt' },
          { title: 'Actions', key: 'actions', sortable: false },
        ]"
        :loading="tenantsStore.loading"
      >
        <template v-slot:item.status="{ item }">
          <v-chip :color="getStatusColor(item.status)" size="small">
            {{ item.status }}
          </v-chip>
        </template>
        <template v-slot:item.syncEnabled="{ item }">
          <v-chip :color="item.syncEnabled ? 'success' : 'grey'" size="small">
            <v-icon start size="small">{{ item.syncEnabled ? 'mdi-sync' : 'mdi-sync-off' }}</v-icon>
            {{ item.syncEnabled ? 'Enabled' : 'Disabled' }}
          </v-chip>
        </template>
        <template v-slot:item.createdAt="{ item }">
          {{ new Date(item.createdAt).toLocaleDateString() }}
        </template>
        <template v-slot:item.actions="{ item }">
          <v-btn icon size="small" :to="`/tenants/${item.id}/edit`">
            <v-icon>mdi-pencil</v-icon>
          </v-btn>
          <v-btn icon size="small" color="error" @click="confirmDelete(item)">
            <v-icon>mdi-delete</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </v-card>

    <!-- Delete Dialog -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>Confirm Delete</v-card-title>
        <v-card-text>
          Are you sure you want to delete tenant "{{ tenantToDelete?.name }}"?
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" @click="deleteTenant">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Migration Results Dialog -->
    <v-dialog v-model="migrateDialog" max-width="600" persistent>
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon start>mdi-database-sync</v-icon>
          Run Migrations — All Tenants
        </v-card-title>
        <v-card-text>
          <!-- Loading -->
          <div v-if="migrating" class="text-center py-6">
            <v-progress-circular indeterminate color="primary" size="48" class="mb-4"></v-progress-circular>
            <div class="text-body-1">Running migrations on all tenant databases...</div>
          </div>

          <!-- Error -->
          <v-alert v-if="migrateError" type="error" class="mb-4">{{ migrateError }}</v-alert>

          <!-- Results -->
          <template v-if="migrateResults">
            <v-alert
              :type="migrateResults.failed === 0 ? 'success' : 'warning'"
              variant="tonal"
              class="mb-4"
            >
              {{ migrateResults.succeeded }} of {{ migrateResults.total }} tenants migrated successfully.
              <span v-if="migrateResults.failed > 0"> {{ migrateResults.failed }} failed.</span>
            </v-alert>

            <v-table density="compact">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Status</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in migrateResults.results" :key="r.tenant">
                  <td class="font-weight-medium">{{ r.tenant }}</td>
                  <td>
                    <v-icon :color="r.success ? 'success' : 'error'" size="small">
                      {{ r.success ? 'mdi-check-circle' : 'mdi-alert-circle' }}
                    </v-icon>
                  </td>
                  <td class="text-body-2">{{ r.message }}</td>
                </tr>
              </tbody>
            </v-table>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn :disabled="migrating" @click="migrateDialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
