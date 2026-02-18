<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useCredentialsStore } from '../../stores/credentials';
import type { Credential, CredentialType } from '../../types';

const credentialsStore = useCredentialsStore();
const search = ref('');
const typeFilter = ref<CredentialType | ''>('');
const deleteDialog = ref(false);
const credentialToDelete = ref<Credential | null>(null);
const isPermanentDelete = ref(false);

const credentialTypes: CredentialType[] = ['dep', 'zoho', 'netsuite', 'database', 'ssl'];

const headers = [
  { title: 'ID', key: 'id', sortable: true },
  { title: 'Type', key: 'type', sortable: true },
  { title: 'Status', key: 'status', sortable: true },
  { title: 'Created', key: 'createdAt', sortable: true },
  { title: 'Actions', key: 'actions', sortable: false },
];

const filteredCredentials = computed(() => {
  let result = credentialsStore.credentials;
  if (typeFilter.value) {
    result = result.filter((c) => c.type === typeFilter.value);
  }
  if (search.value) {
    const searchLower = search.value.toLowerCase();
    result = result.filter(
      (c) =>
        c.type.toLowerCase().includes(searchLower) ||
        c.status.toLowerCase().includes(searchLower)
    );
  }
  return result;
});

function getTypeColor(type: CredentialType): string {
  const colors: Record<CredentialType, string> = {
    dep: 'blue',
    zoho: 'orange',
    netsuite: 'purple',
    database: 'green',
    ssl: 'red',
  };
  return colors[type] || 'grey';
}

function confirmDelete(credential: Credential, permanent = false) {
  credentialToDelete.value = credential;
  isPermanentDelete.value = permanent;
  deleteDialog.value = true;
}

async function handleDelete() {
  if (!credentialToDelete.value) return;
  try {
    if (isPermanentDelete.value) {
      await credentialsStore.hardDelete(credentialToDelete.value.id);
    } else {
      await credentialsStore.remove(credentialToDelete.value.id);
    }
    await credentialsStore.fetchAll();
  } catch (err) {
    console.error('Delete failed:', err);
  }
  deleteDialog.value = false;
}

async function handleRestore(id: number) {
  try {
    await credentialsStore.restore(id);
    await credentialsStore.fetchAll();
  } catch (err) {
    console.error('Restore failed:', err);
  }
}

onMounted(() => {
  credentialsStore.fetchAll();
});
</script>

<template>
  <div>
    <div class="d-flex justify-space-between align-center mb-4">
      <h1 class="text-h4">Credentials</h1>
      <v-btn color="primary" to="/credentials/create" prepend-icon="mdi-plus">
        Add Credential
      </v-btn>
    </div>

    <v-card>
      <v-card-title>
        <v-row>
          <v-col cols="12" sm="4">
            <v-text-field
              v-model="search"
              prepend-icon="mdi-magnify"
              label="Search"
              single-line
              hide-details
              clearable
            ></v-text-field>
          </v-col>
          <v-col cols="12" sm="4">
            <v-select
              v-model="typeFilter"
              :items="[{ title: 'All Types', value: '' }, ...credentialTypes.map(t => ({ title: t.toUpperCase(), value: t }))]"
              label="Filter by Type"
              hide-details
              clearable
            ></v-select>
          </v-col>
        </v-row>
      </v-card-title>
      <v-data-table
        :headers="headers"
        :items="filteredCredentials"
        :loading="credentialsStore.loading"
        class="elevation-1"
      >
        <template v-slot:item.type="{ item }">
          <v-chip :color="getTypeColor(item.type)" size="small">
            {{ item.type.toUpperCase() }}
          </v-chip>
        </template>
        <template v-slot:item.status="{ item }">
          <v-chip :color="item.status === 'current' ? 'success' : 'warning'" size="small">
            {{ item.status }}
          </v-chip>
        </template>
        <template v-slot:item.createdAt="{ item }">
          {{ new Date(item.createdAt).toLocaleDateString() }}
        </template>
        <template v-slot:item.actions="{ item }">
          <v-btn icon size="small" :to="`/credentials/${item.id}/edit`" color="primary">
            <v-icon>mdi-pencil</v-icon>
          </v-btn>
          <v-btn icon size="small" @click="confirmDelete(item)" color="error">
            <v-icon>mdi-delete</v-icon>
          </v-btn>
          <v-btn v-if="item.deletedAt" icon size="small" @click="handleRestore(item.id)" color="success">
            <v-icon>mdi-restore</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </v-card>

    <!-- Delete Confirmation Dialog -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>{{ isPermanentDelete ? 'Permanently Delete' : 'Delete' }} Credential</v-card-title>
        <v-card-text>
          Are you sure you want to {{ isPermanentDelete ? 'permanently delete' : 'delete' }} this credential?
          {{ isPermanentDelete ? 'This action cannot be undone.' : '' }}
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" @click="handleDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

