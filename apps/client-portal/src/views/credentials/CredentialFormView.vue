<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCredentialsStore } from '../../stores/credentials';
import type { CredentialType, CredentialStatus } from '../../types';

const route = useRoute();
const router = useRouter();
const credentialsStore = useCredentialsStore();

const isEdit = computed(() => !!route.params.id);
const credentialId = computed(() => (route.params.id ? Number(route.params.id) : null));

const loading = ref(false);
const error = ref('');

const credentialTypes: CredentialType[] = ['dep', 'zoho', 'netsuite', 'database', 'ssl'];
const credentialStatuses: CredentialStatus[] = ['current', 'disabled'];

// Form fields
const type = ref<CredentialType>('dep');
const status = ref<CredentialStatus>('current');
const connectionData = ref<Record<string, unknown>>({});

// Field definitions for each type
const depFields = ['ssl_key', 'ssl_cert', 'apple_api_url', 'dep_reseller_id', 'sap_ship_to', 'sap_sold_to'];
const zohoFields = [
  'client_id', 'client_secret', 'redirect_uri', 'current_user_email', 'account_field',
  'is_dep_field', 'po_field', 'serials_field', 'dep_status_field', 'status',
  'dep_order_id', 'dep_ordered_at', 'dep_shipped_at', 'application_log_file_path', 'token_persistence_path'
];
const netsuiteFields = [
  'netsuite_restlet_host', 'netsuite_account', 'client_id', 'client_secret', 'netsuite_realm',
  'netsuite_consumer_key', 'netsuite_consumer_secret', 'netsuite_token', 'netsuite_token_secret',
  'netsuite_signature_algorithm', 'netsuite_deploy_id', 'netsuite_order_script_id', 'netsuite_account_script_id', 'mapping_class'
];

const currentFields = computed(() => {
  switch (type.value) {
    case 'dep': return depFields;
    case 'zoho': return zohoFields;
    case 'netsuite': return netsuiteFields;
    default: return [];
  }
});

// Initialize connection data when type changes
watch(type, (newType) => {
  if (!isEdit.value) {
    const fields = newType === 'dep' ? depFields : newType === 'zoho' ? zohoFields : newType === 'netsuite' ? netsuiteFields : [];
    connectionData.value = fields.reduce((acc, field) => {
      acc[field] = field === 'netsuite_deploy_id' ? 1 : '';
      return acc;
    }, {} as Record<string, unknown>);
  }
});

async function loadCredential() {
  if (!credentialId.value) return;
  loading.value = true;
  error.value = '';
  try {
    const credential = await credentialsStore.fetchOne(credentialId.value);
    type.value = credential.type;
    status.value = credential.status;
    connectionData.value = credential.connectionData;
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to load credential';
  } finally {
    loading.value = false;
  }
}

async function handleSubmit() {
  loading.value = true;
  error.value = '';
  try {
    if (isEdit.value && credentialId.value) {
      await credentialsStore.update(credentialId.value, { status: status.value, connectionData: connectionData.value });
    } else {
      await credentialsStore.create({ type: type.value, status: status.value, connectionData: connectionData.value });
    }
    router.push('/credentials');
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to save credential';
  } finally {
    loading.value = false;
  }
}

function formatLabel(field: string): string {
  return field.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

function isPasswordField(field: string): boolean {
  return ['ssl_key', 'ssl_cert', 'client_secret', 'netsuite_consumer_secret', 'netsuite_token_secret'].includes(field);
}

onMounted(() => {
  if (isEdit.value) {
    loadCredential();
  } else {
    // Initialize with default fields for selected type
    const fields = depFields;
    connectionData.value = fields.reduce((acc, field) => {
      acc[field] = '';
      return acc;
    }, {} as Record<string, unknown>);
  }
});
</script>

<template>
  <div>
    <h1 class="text-h4 mb-6">{{ isEdit ? 'Edit' : 'Create' }} Credential</h1>
    <v-card>
      <v-card-text>
        <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = ''">{{ error }}</v-alert>
        <v-form @submit.prevent="handleSubmit">
          <v-row>
            <v-col cols="12" md="6">
              <v-select v-model="type" :items="credentialTypes" label="Type" :disabled="isEdit" required></v-select>
            </v-col>
            <v-col cols="12" md="6">
              <v-select v-model="status" :items="credentialStatuses" label="Status" required></v-select>
            </v-col>
          </v-row>
          <v-divider class="my-4"></v-divider>
          <h3 class="text-h6 mb-4">Connection Data</h3>
          <v-row>
            <v-col v-for="field in currentFields" :key="field" cols="12" md="6">
              <v-textarea v-if="isPasswordField(field)" v-model="connectionData[field]" :label="formatLabel(field)" rows="3" required></v-textarea>
              <v-text-field v-else-if="field === 'netsuite_deploy_id'" v-model.number="connectionData[field]" :label="formatLabel(field)" type="number" required></v-text-field>
              <v-text-field v-else v-model="connectionData[field]" :label="formatLabel(field)" required></v-text-field>
            </v-col>
          </v-row>
          <div v-if="type === 'database' || type === 'ssl'" class="mt-4">
            <v-textarea v-model="connectionData" label="Connection Data (JSON)" rows="10" hint="Enter valid JSON"></v-textarea>
          </div>
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" to="/credentials">Cancel</v-btn>
        <v-spacer></v-spacer>
        <v-btn color="primary" :loading="loading" @click="handleSubmit">{{ isEdit ? 'Update' : 'Create' }}</v-btn>
      </v-card-actions>
    </v-card>
  </div>
</template>

