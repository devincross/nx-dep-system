<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useDomainsStore } from '../../stores/domains';
import { useTenantsStore } from '../../stores/tenants';

const router = useRouter();
const route = useRoute();
const domainsStore = useDomainsStore();
const tenantsStore = useTenantsStore();

const isEditing = computed(() => !!route.params.id);
const loading = ref(false);
const error = ref('');

const form = ref({
  tenantId: '',
  domain: '',
  dbHost: 'localhost',
  dbPort: 3306,
  dbName: '',
  dbUser: '',
  dbPassword: '',
  isPrimary: false,
});

onMounted(async () => {
  await tenantsStore.fetchTenants();
  if (isEditing.value) {
    try {
      const domain = await domainsStore.fetchDomain(route.params.id as string);
      form.value = {
        tenantId: domain.tenantId,
        domain: domain.domain,
        dbHost: domain.dbHost,
        dbPort: domain.dbPort,
        dbName: domain.dbName,
        dbUser: domain.dbUser,
        dbPassword: '',
        isPrimary: domain.isPrimary,
      };
    } catch (err) {
      error.value = 'Failed to load domain';
    }
  }
});

async function handleSubmit() {
  loading.value = true;
  error.value = '';
  try {
    if (isEditing.value) {
      const updateData: any = { ...form.value };
      if (!updateData.dbPassword) delete updateData.dbPassword;
      delete updateData.tenantId;
      await domainsStore.updateDomain(route.params.id as string, updateData);
    } else {
      await domainsStore.createDomain(form.value);
    }
    router.push('/domains');
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to save domain';
  } finally {
    loading.value = false;
  }
}

const tenantOptions = computed(() =>
  tenantsStore.tenants.map((t) => ({ title: t.name, value: t.id }))
);
</script>

<template>
  <div>
    <h1 class="text-h4 mb-6">{{ isEditing ? 'Edit Domain' : 'Create Domain' }}</h1>

    <v-card max-width="600">
      <v-card-text>
        <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = ''">
          {{ error }}
        </v-alert>
        <v-form @submit.prevent="handleSubmit">
          <v-select
            v-model="form.tenantId"
            :items="tenantOptions"
            label="Tenant"
            required
            :disabled="isEditing"
            class="mb-4"
          ></v-select>
          <v-text-field v-model="form.domain" label="Domain" required class="mb-4"></v-text-field>
          <v-text-field v-model="form.dbHost" label="Database Host" required class="mb-4"></v-text-field>
          <v-text-field v-model.number="form.dbPort" label="Database Port" type="number" required class="mb-4"></v-text-field>
          <v-text-field v-model="form.dbName" label="Database Name" required class="mb-4"></v-text-field>
          <v-text-field v-model="form.dbUser" label="Database User" required class="mb-4"></v-text-field>
          <v-text-field
            v-model="form.dbPassword"
            label="Database Password"
            type="password"
            :hint="isEditing ? 'Leave blank to keep current' : ''"
            persistent-hint
            :required="!isEditing"
            class="mb-4"
          ></v-text-field>
          <v-checkbox v-model="form.isPrimary" label="Primary Domain"></v-checkbox>
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-btn @click="router.push('/domains')">Cancel</v-btn>
        <v-spacer></v-spacer>
        <v-btn color="primary" :loading="loading" @click="handleSubmit">
          {{ isEditing ? 'Update' : 'Create' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </div>
</template>

