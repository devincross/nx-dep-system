<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useTenantsStore } from '../../stores/tenants';
import type { Tenant } from '../../types';

const tenantsStore = useTenantsStore();
const deleteDialog = ref(false);
const tenantToDelete = ref<Tenant | null>(null);

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
      <v-btn color="primary" to="/tenants/create" prepend-icon="mdi-plus">
        Add Tenant
      </v-btn>
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
  </div>
</template>

