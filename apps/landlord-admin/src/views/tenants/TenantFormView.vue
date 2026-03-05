<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTenantsStore } from '../../stores/tenants';

const router = useRouter();
const route = useRoute();
const tenantsStore = useTenantsStore();

const isEditing = computed(() => !!route.params.id);
const loading = ref(false);
const error = ref('');

const connectionTypes = [
  { title: 'NetSuite', value: 'netsuite' },
  { title: 'Zoho', value: 'zoho' },
];

const form = ref({
  name: '',
  slug: '',
  subdomain: '',
  connectionType: 'netsuite' as 'netsuite' | 'zoho',
  isActive: true,
});

onMounted(async () => {
  if (isEditing.value) {
    try {
      const tenant = await tenantsStore.fetchTenant(route.params.id as string);
      const metadata = tenant.metadata ? JSON.parse(tenant.metadata) : {};
      form.value = {
        name: tenant.name,
        slug: tenant.slug,
        subdomain: '', // Not editable after creation
        connectionType: metadata.connectionType || 'netsuite',
        isActive: tenant.isActive,
      };
    } catch (err) {
      error.value = 'Failed to load tenant';
    }
  }
});

async function handleSubmit() {
  loading.value = true;
  error.value = '';
  try {
    const metadata = JSON.stringify({ connectionType: form.value.connectionType });

    if (isEditing.value) {
      // Don't send subdomain when editing
      const { subdomain, connectionType, ...updateData } = form.value;
      await tenantsStore.updateTenant(route.params.id as string, { ...updateData, metadata });
    } else {
      const { connectionType, ...createData } = form.value;
      await tenantsStore.createTenant({ ...createData, metadata });
    }
    router.push('/tenants');
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to save tenant';
  } finally {
    loading.value = false;
  }
}

function generateSlugAndSubdomain() {
  const generated = form.value.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  form.value.slug = generated;
  form.value.subdomain = generated;
}
</script>

<template>
  <div>
    <h1 class="text-h4 mb-6">{{ isEditing ? 'Edit Tenant' : 'Create Tenant' }}</h1>

    <v-card max-width="600">
      <v-card-text>
        <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = ''">
          {{ error }}
        </v-alert>
        <v-form @submit.prevent="handleSubmit">
          <v-text-field
            v-model="form.name"
            label="Name"
            required
            class="mb-4"
            @blur="!isEditing && !form.slug && generateSlugAndSubdomain()"
          ></v-text-field>
          <v-text-field
            v-model="form.slug"
            label="Slug"
            required
            class="mb-4"
            hint="URL-friendly identifier"
            persistent-hint
          ></v-text-field>
          <v-text-field
            v-if="!isEditing"
            v-model="form.subdomain"
            label="Subdomain"
            required
            class="mb-4"
            hint="e.g., 'acme' will create acme.801saas.com"
            persistent-hint
            suffix=".801saas.com"
          ></v-text-field>
          <v-alert v-if="!isEditing" type="info" density="compact" class="mb-4">
            A database will be automatically created: <strong>tenant_{{ form.slug?.replace(/-/g, '_') || 'xxx' }}</strong>
          </v-alert>
          <v-select
            v-model="form.connectionType"
            :items="connectionTypes"
            label="Connection Type"
            required
            class="mb-4"
            hint="The ERP system this tenant uses"
            persistent-hint
          ></v-select>
          <v-switch
            v-model="form.isActive"
            label="Active"
            color="primary"
            class="mb-4"
          ></v-switch>
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-btn @click="router.push('/tenants')">Cancel</v-btn>
        <v-spacer></v-spacer>
        <v-btn color="primary" :loading="loading" @click="handleSubmit">
          {{ isEditing ? 'Update' : 'Create' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </div>
</template>

