<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useUsersStore } from '../stores/users';
import { useTenantsStore } from '../stores/tenants';
import { useDomainsStore } from '../stores/domains';

const usersStore = useUsersStore();
const tenantsStore = useTenantsStore();
const domainsStore = useDomainsStore();

const loading = ref(true);

onMounted(async () => {
  try {
    await Promise.all([
      usersStore.fetchUsers(),
      tenantsStore.fetchTenants(),
      domainsStore.fetchDomains(),
    ]);
  } catch (err) {
    console.error('Failed to load dashboard data', err);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div>
    <h1 class="text-h4 mb-6">Dashboard</h1>

    <v-row v-if="loading">
      <v-col cols="12" class="text-center">
        <v-progress-circular indeterminate color="primary"></v-progress-circular>
      </v-col>
    </v-row>

    <v-row v-else>
      <v-col cols="12" md="4">
        <v-card color="primary" theme="dark">
          <v-card-text>
            <div class="text-h2">{{ usersStore.users.length }}</div>
            <div class="text-subtitle-1">Users</div>
          </v-card-text>
          <v-card-actions>
            <v-btn variant="text" to="/users">View All</v-btn>
          </v-card-actions>
        </v-card>
      </v-col>

      <v-col cols="12" md="4">
        <v-card color="success" theme="dark">
          <v-card-text>
            <div class="text-h2">{{ tenantsStore.tenants.length }}</div>
            <div class="text-subtitle-1">Tenants</div>
          </v-card-text>
          <v-card-actions>
            <v-btn variant="text" to="/tenants">View All</v-btn>
          </v-card-actions>
        </v-card>
      </v-col>

      <v-col cols="12" md="4">
        <v-card color="info" theme="dark">
          <v-card-text>
            <div class="text-h2">{{ domainsStore.domains.length }}</div>
            <div class="text-subtitle-1">Domains</div>
          </v-card-text>
          <v-card-actions>
            <v-btn variant="text" to="/domains">View All</v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

