<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCredentialsStore } from '../../stores/credentials';
import api from '../../services/api';
import type { CredentialType, CredentialStatus, Credential } from '../../types';

const route = useRoute();
const router = useRouter();
const credentialsStore = useCredentialsStore();

const isEdit = computed(() => !!route.params.id);
const credentialId = computed(() => (route.params.id ? Number(route.params.id) : null));

const loading = ref(false);
const error = ref('');
const successMessage = ref('');
const showFieldMappings = ref(false);
const showJsonPreview = ref(false);
const zohoConnectLoading = ref(false);
const zohoConnected = ref(false);
const callbackUri = ref(window.location.origin + '/zoho/callback');

// Grant token flow
const showGrantTokenFlow = ref(false);
const grantToken = ref('');
const grantTokenLoading = ref(false);

// Zoho data center
const zohoDataCenter = ref('us');
const zohoDataCenters = [
  { title: 'United States (.com)', value: 'us' },
  { title: 'Europe (.eu)', value: 'eu' },
  { title: 'India (.in)', value: 'in' },
  { title: 'Australia (.com.au)', value: 'au' },
  { title: 'Japan (.jp)', value: 'jp' },
  { title: 'Canada (.ca)', value: 'ca' },
  { title: 'United Kingdom (.uk)', value: 'uk' },
];

// Certificate generation
const certGenerating = ref(false);
const generatedCert = ref<{
  privateKey: string;
  certificatePem: string;
  fingerprint: string;
  serialNumber: string;
  validFrom: string;
  validTo: string;
} | null>(null);
const certCopied = ref(false);

// Credential rotation
const existingCredentials = ref<Credential[]>([]);
const activeCredential = ref<Credential | null>(null);
const activatingCredential = ref(false);

// DEP setup mode: 'new' = generate CSR, 'migrate' = paste existing key/cert
const depSetupMode = ref<'new' | 'migrate'>('new');

// DEP CSR generation state
const csrGenerating = ref(false);
const csrResult = ref<{ privateKey: string; csrPem: string; subject: any } | null>(null);
const csrCopied = ref(false);
const depCsrForm = ref({
  soldTo: '',
  country: '',
  state: '',
  city: '',
  organization: '',
  organizationalUnit: '',
});

const credentialTypes: CredentialType[] = ['dep', 'zoho', 'netsuite', 'database', 'ssl'];
const credentialStatuses: CredentialStatus[] = ['current', 'disabled'];

// Form fields
const type = ref<CredentialType>('dep');
const status = ref<CredentialStatus>('current');
const connectionData = ref<Record<string, unknown>>({});

// Zoho field mappings (kept separate for structured editing)
const zohoFieldMappings = ref<{
  account: Record<string, string>;
  order: Record<string, string>;
  orderItems: Record<string, string>;
}>({
  account: { externalAccountId: '', name: '', depAccountId: '' },
  order: { externalOrderId: '', externalAccountId: '', externalOrderStatus: '', isDep: '', po: '' },
  orderItems: { sourceField: '', serialNumbers: '', isDep: '' },
});

// Our domain fields with descriptions and defaults
const accountMappingFields = [
  { key: 'externalAccountId', label: 'External Account ID', description: 'Unique identifier for the account in Zoho', default: 'id' },
  { key: 'name', label: 'Account Name', description: 'Display name of the account', default: 'Account_Name' },
  { key: 'depAccountId', label: 'Enrollment Account ID', description: 'Apple Device Enrollment account ID (optional)', default: 'DEP_Account_ID' },
];

const orderMappingFields = [
  { key: 'externalOrderId', label: 'External Order ID', description: 'Unique identifier for the order in Zoho', default: 'id' },
  { key: 'externalAccountId', label: 'Account ID on Order', description: 'Account reference on the order. Use dot-notation for nested fields (e.g. Account_Name.id)', default: 'Account_Name.id' },
  { key: 'externalOrderStatus', label: 'Order Status', description: 'Status field on the order', default: 'Status' },
  { key: 'isDep', label: 'Enrollment Eligible', description: 'Field indicating if the order is eligible for Apple Device Enrollment', default: 'Is_DEP' },
  { key: 'po', label: 'Purchase Order', description: 'Purchase order number', default: 'PO_Number' },
];

const orderItemMappingFields = [
  { key: 'sourceField', label: 'Line Items Field', description: 'Field on the order that contains the array of line items', default: 'Product_Details' },
  { key: 'serialNumbers', label: 'Serial Numbers', description: 'Field on each line item containing serial numbers (comma, semicolon, or newline separated)', default: 'Serial_Numbers' },
  { key: 'isDep', label: 'Item Enrollment Eligible', description: 'Field on each line item indicating if it is eligible for Apple Device Enrollment', default: 'Is_DEP' },
];

// Field definitions for each type
const depFields = ['ssl_key', 'ssl_cert', 'apple_api_url', 'dep_reseller_id', 'sap_ship_to', 'sap_sold_to'];
const zohoConnectionFields = ['client_id', 'client_secret', 'refresh_token', 'api_domain', 'accounts_module', 'orders_module'];

const zohoFieldDefaults: Record<string, string> = {
  api_domain: 'https://www.zohoapis.com',
  accounts_module: 'Accounts',
  orders_module: 'Sales_Orders',
};

// NetSuite auth type
const netsuiteAuthType = ref<'oauth1' | 'oauth2'>('oauth1');

const netsuiteOAuth2Fields = ['netsuite_restlet_host', 'netsuite_account', 'client_id', 'certificate_id', 'private_key', 'certificate_pem', 'netsuite_deploy_id', 'netsuite_order_script_id', 'netsuite_account_script_id', 'mapping_class'];
const netsuiteOAuth1Fields = ['netsuite_restlet_host', 'netsuite_account', 'client_id', 'client_secret', 'netsuite_realm', 'netsuite_consumer_key', 'netsuite_consumer_secret', 'netsuite_token', 'netsuite_token_secret', 'netsuite_signature_algorithm', 'netsuite_deploy_id', 'netsuite_order_script_id', 'netsuite_account_script_id', 'mapping_class'];

const currentFields = computed(() => {
  switch (type.value) {
    case 'dep': return depFields;
    case 'zoho': return zohoConnectionFields;
    case 'netsuite': return netsuiteAuthType.value === 'oauth2' ? netsuiteOAuth2Fields : netsuiteOAuth1Fields;
    default: return [];
  }
});

// Check if this credential is currently disabled (being set up as a replacement)
const isNewRotation = computed(() => {
  return isEdit.value && status.value === 'disabled' && activeCredential.value !== null;
});

// Build the final connectionData including field_mappings for Zoho
function buildConnectionData(): Record<string, unknown> {
  const data = { ...connectionData.value };

  if (type.value === 'netsuite') {
    data['auth_type'] = netsuiteAuthType.value;
  }

  // Persist CSR form data so it can be pre-populated later
  if (type.value === 'dep') {
    if (depCsrForm.value.organization) data['csr_organization'] = depCsrForm.value.organization;
    if (depCsrForm.value.organizationalUnit) data['csr_organizational_unit'] = depCsrForm.value.organizationalUnit;
    if (depCsrForm.value.country) data['csr_country'] = depCsrForm.value.country;
    if (depCsrForm.value.state) data['csr_state'] = depCsrForm.value.state;
    if (depCsrForm.value.city) data['csr_city'] = depCsrForm.value.city;
  }

  if (type.value === 'zoho' && showFieldMappings.value) {
    const mappings: Record<string, Record<string, string>> = {};
    for (const [group, fields] of Object.entries(zohoFieldMappings.value)) {
      const nonEmpty = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v.trim() !== '')
      );
      if (Object.keys(nonEmpty).length > 0) {
        mappings[group] = nonEmpty;
      }
    }
    if (Object.keys(mappings).length > 0) {
      data['field_mappings'] = mappings;
    } else {
      delete data['field_mappings'];
    }
  }

  return data;
}

// Computed JSON preview
const jsonPreview = computed(() => {
  const data = buildConnectionData();
  return JSON.stringify(data, null, 2);
});

// ---- Certificate generation ----

async function generateCertificate() {
  certGenerating.value = true;
  error.value = '';
  try {
    const response = await api.post<{
      privateKey: string;
      certificatePem: string;
      fingerprint: string;
      serialNumber: string;
      validFrom: string;
      validTo: string;
    }>('/credentials/generate-certificate', {
      validityDays: 730,
      commonName: 'DEP Sync Integration',
    });

    generatedCert.value = response.data;

    // Auto-fill the form fields
    connectionData.value['private_key'] = response.data.privateKey;
    connectionData.value['certificate_pem'] = response.data.certificatePem;
    connectionData.value['certificate_expires_at'] = response.data.validTo;

    successMessage.value = 'Certificate generated successfully. Copy it below and upload it to your NetSuite integration record.';
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Unable to generate the certificate. Please try again or contact support.';
  } finally {
    certGenerating.value = false;
  }
}

async function copyCertToClipboard() {
  if (!generatedCert.value) return;
  try {
    await navigator.clipboard.writeText(generatedCert.value.certificatePem);
    certCopied.value = true;
    setTimeout(() => { certCopied.value = false; }, 2000);
  } catch {
    // Fallback: select the textarea
    const el = document.querySelector('#cert-pem-display') as HTMLTextAreaElement;
    if (el) { el.select(); document.execCommand('copy'); }
  }
}

// ---- Credential rotation ----

async function loadExistingCredentials() {
  if (type.value === 'database' || type.value === 'ssl') return;
  try {
    const creds = await credentialsStore.fetchByType(type.value);
    existingCredentials.value = creds;
    activeCredential.value = creds.find((c) => c.status === 'current') ?? null;
  } catch {
    // Non-critical
  }
}

async function activateAndReplace() {
  if (!credentialId.value) return;
  activatingCredential.value = true;
  error.value = '';
  try {
    // Save first
    const data = buildConnectionData();
    await credentialsStore.update(credentialId.value, { status: status.value, connectionData: data });

    // Then activate (disables old ones)
    await api.post(`/credentials/${credentialId.value}/activate`);
    successMessage.value = 'Your new connection is now active. The previous connection has been disabled.';
    activeCredential.value = null;
    status.value = 'current';
    await loadExistingCredentials();
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Unable to activate this connection. Please try again or contact support.';
  } finally {
    activatingCredential.value = false;
  }
}

// ---- Zoho OAuth flows ----

async function connectToZoho() {
  const clientId = connectionData.value['client_id'] as string;
  const clientSecret = connectionData.value['client_secret'] as string;
  if (!clientId || !clientSecret) {
    error.value = 'Please enter your Client ID and Client Secret before connecting.';
    return;
  }
  zohoConnectLoading.value = true;
  error.value = '';
  try {
    const redirectUri = `${window.location.origin}/zoho/callback`;
    const response = await api.get<{ url: string }>('/zoho/auth-url', {
      params: { client_id: clientId, redirect_uri: redirectUri, data_center: zohoDataCenter.value },
    });
    sessionStorage.setItem('zoho_oauth_params', JSON.stringify({
      client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, data_center: zohoDataCenter.value,
      credential_id: credentialId.value,
    }));
    window.location.href = response.data.url;
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Unable to start the Zoho connection. Please check your Client ID and try again.';
    zohoConnectLoading.value = false;
  }
}

async function exchangeGrantToken() {
  const clientId = connectionData.value['client_id'] as string;
  const clientSecret = connectionData.value['client_secret'] as string;
  if (!clientId || !clientSecret) { error.value = 'Please enter your Client ID and Client Secret first.'; return; }
  if (!grantToken.value.trim()) { error.value = 'Please paste the grant token you generated in your Zoho account.'; return; }
  grantTokenLoading.value = true;
  error.value = '';
  try {
    const response = await api.post<{ refresh_token: string; api_domain: string }>('/zoho/exchange-grant-token', {
      grant_token: grantToken.value.trim(), client_id: clientId, client_secret: clientSecret, data_center: zohoDataCenter.value,
    });
    connectionData.value['refresh_token'] = response.data.refresh_token;
    if (response.data.api_domain) connectionData.value['api_domain'] = response.data.api_domain;
    zohoConnected.value = true;
    grantToken.value = '';
    showGrantTokenFlow.value = false;
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Unable to exchange the grant token. It may have expired — please generate a new one in Zoho and try again.';
  } finally {
    grantTokenLoading.value = false;
  }
}

// ---- DEP CSR Generation ----

async function generateCsr() {
  const f = depCsrForm.value;
  if (!f.soldTo || !f.country || !f.state || !f.city || !f.organization) {
    error.value = 'Please fill in all required fields: SoldTo Number, Country, State, City, and Organization.';
    return;
  }
  csrGenerating.value = true;
  error.value = '';
  csrResult.value = null;
  try {
    const response = await api.post('/credentials/generate-csr', {
      soldTo: f.soldTo,
      country: f.country,
      state: f.state,
      city: f.city,
      organization: f.organization,
      organizationalUnit: f.organizationalUnit || undefined,
    });
    csrResult.value = response.data;
    // Auto-fill the private key into connection data
    connectionData.value['ssl_key'] = response.data.privateKey;
    successMessage.value = 'Certificate request generated successfully. Download it and send it to Apple, then save this page to preserve your private key.';
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Unable to generate the certificate request. Please try again or contact support.';
  } finally {
    csrGenerating.value = false;
  }
}

function downloadCsr() {
  if (!csrResult.value) return;
  const blob = new Blob([csrResult.value.csrPem], { type: 'application/pkcs10' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dep-csr-${depCsrForm.value.soldTo}.pem`;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyCsrToClipboard() {
  if (!csrResult.value) return;
  try {
    await navigator.clipboard.writeText(csrResult.value.csrPem);
    csrCopied.value = true;
    setTimeout(() => { csrCopied.value = false; }, 2000);
  } catch { /* */ }
}

// Initialize connection data when type changes
watch(type, (newType) => {
  if (!isEdit.value) {
    let fields: string[];
    if (newType === 'dep') fields = depFields;
    else if (newType === 'zoho') fields = zohoConnectionFields;
    else if (newType === 'netsuite') fields = netsuiteAuthType.value === 'oauth2' ? netsuiteOAuth2Fields : netsuiteOAuth1Fields;
    else fields = [];

    connectionData.value = fields.reduce((acc, field) => {
      acc[field] = field === 'netsuite_deploy_id' ? 1 : (zohoFieldDefaults[field] ?? '');
      return acc;
    }, {} as Record<string, unknown>);

    zohoFieldMappings.value = {
      account: { externalAccountId: '', name: '', depAccountId: '' },
      order: { externalOrderId: '', externalAccountId: '', externalOrderStatus: '', isDep: '', po: '' },
      orderItems: { sourceField: '', serialNumbers: '', isDep: '' },
    };
    showFieldMappings.value = false;
    zohoConnected.value = false;
    generatedCert.value = null;
  }
  loadExistingCredentials();
});

watch(netsuiteAuthType, () => {
  if (!isEdit.value && type.value === 'netsuite') {
    const fields = netsuiteAuthType.value === 'oauth2' ? netsuiteOAuth2Fields : netsuiteOAuth1Fields;
    connectionData.value = fields.reduce((acc, field) => {
      acc[field] = field === 'netsuite_deploy_id' ? 1 : '';
      return acc;
    }, {} as Record<string, unknown>);
    generatedCert.value = null;
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
    connectionData.value = { ...credential.connectionData };

    if (credential.type === 'netsuite') {
      netsuiteAuthType.value = (credential.connectionData['auth_type'] as 'oauth1' | 'oauth2') || 'oauth1';
    }

    if (credential.type === 'zoho' && credential.connectionData['field_mappings']) {
      const fm = credential.connectionData['field_mappings'] as Record<string, Record<string, string>>;
      showFieldMappings.value = true;
      if (fm.account) {
        zohoFieldMappings.value.account = { externalAccountId: fm.account.externalAccountId ?? '', name: fm.account.name ?? '', depAccountId: fm.account.depAccountId ?? '' };
      }
      if (fm.order) {
        zohoFieldMappings.value.order = { externalOrderId: fm.order.externalOrderId ?? '', externalAccountId: fm.order.externalAccountId ?? '', externalOrderStatus: fm.order.externalOrderStatus ?? '', isDep: fm.order.isDep ?? '', po: fm.order.po ?? '' };
      }
      if (fm.orderItems) {
        zohoFieldMappings.value.orderItems = { sourceField: fm.orderItems.sourceField ?? '', serialNumbers: fm.orderItems.serialNumbers ?? '', isDep: fm.orderItems.isDep ?? '' };
      }
      delete connectionData.value['field_mappings'];
    }

    if (credential.type === 'zoho' && credential.connectionData['refresh_token']) {
      zohoConnected.value = true;
    }

    // Pre-populate CSR form from existing DEP credential data
    if (credential.type === 'dep') {
      depCsrForm.value.soldTo = (credential.connectionData['sap_sold_to'] as string) || '';
      depCsrForm.value.organization = (credential.connectionData['csr_organization'] as string) || '';
      depCsrForm.value.organizationalUnit = (credential.connectionData['csr_organizational_unit'] as string) || '';
      depCsrForm.value.country = (credential.connectionData['csr_country'] as string) || '';
      depCsrForm.value.state = (credential.connectionData['csr_state'] as string) || '';
      depCsrForm.value.city = (credential.connectionData['csr_city'] as string) || '';
      // If key/cert already exist, default to migrate mode
      if (credential.connectionData['ssl_key'] && credential.connectionData['ssl_cert']) {
        depSetupMode.value = 'migrate';
      }
    }

    await loadExistingCredentials();
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Unable to load this connection. Please try again or contact support.';
  } finally {
    loading.value = false;
  }
}

async function handleSubmit() {
  loading.value = true;
  error.value = '';
  try {
    const data = buildConnectionData();
    if (isEdit.value && credentialId.value) {
      await credentialsStore.update(credentialId.value, { status: status.value, connectionData: data });
    } else {
      await credentialsStore.create({ type: type.value, status: status.value, connectionData: data });
    }
    router.push('/credentials');
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Unable to save this connection. Please check your entries and try again.';
  } finally {
    loading.value = false;
  }
}

async function saveAsDraft() {
  loading.value = true;
  error.value = '';
  try {
    const data = buildConnectionData();
    if (isEdit.value && credentialId.value) {
      await credentialsStore.update(credentialId.value, { status: 'disabled', connectionData: data });
    } else {
      await credentialsStore.create({ type: type.value, status: 'disabled', connectionData: data });
    }
    successMessage.value = 'Saved as inactive. Your current active connection is unchanged — activate this one when you are ready to switch.';
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Unable to save this connection. Please check your entries and try again.';
  } finally {
    loading.value = false;
  }
}

function formatLabel(field: string): string {
  return field.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

function isPasswordField(field: string): boolean {
  return ['ssl_key', 'ssl_cert', 'client_secret', 'netsuite_consumer_secret', 'netsuite_token_secret', 'refresh_token', 'private_key'].includes(field);
}

function isRequiredZohoField(field: string): boolean {
  return ['client_id', 'client_secret'].includes(field);
}

function resetMappingsToDefaults() {
  const allFields = [
    { group: 'account', fields: accountMappingFields },
    { group: 'order', fields: orderMappingFields },
    { group: 'orderItems', fields: orderItemMappingFields },
  ];
  for (const { group, fields } of allFields) {
    for (const f of fields) {
      (zohoFieldMappings.value as any)[group][f.key] = f.default;
    }
  }
}

onMounted(() => {
  const oauthResult = sessionStorage.getItem('zoho_oauth_result');
  if (oauthResult) {
    const result = JSON.parse(oauthResult) as { refresh_token: string; api_domain: string };
    sessionStorage.removeItem('zoho_oauth_result');
    if (!isEdit.value) type.value = 'zoho';
    setTimeout(() => {
      connectionData.value['refresh_token'] = result.refresh_token;
      if (result.api_domain) connectionData.value['api_domain'] = result.api_domain;
      zohoConnected.value = true;
    }, 0);
  }
  if (route.query.type === 'zoho' && !isEdit.value) type.value = 'zoho';
  if (isEdit.value) {
    loadCredential();
  } else if (!oauthResult) {
    connectionData.value = depFields.reduce((acc, field) => { acc[field] = ''; return acc; }, {} as Record<string, unknown>);
  }
});
</script>

<template>
  <div>
    <h1 class="text-h4 mb-6">{{ isEdit ? 'Edit' : 'Create' }} Credential</h1>

    <!-- Rotation banner: show when editing a disabled credential while an active one exists -->
    <v-alert v-if="isNewRotation" type="info" variant="tonal" class="mb-4">
      <div class="d-flex align-center">
        <div>
          <strong>Setting up new connection.</strong>
          The current active {{ type }} credential (#{{ activeCredential?.id }}) remains in use until you activate this one.
        </div>
        <v-spacer></v-spacer>
        <v-btn color="primary" variant="elevated" size="small" :loading="activatingCredential" @click="activateAndReplace" class="ml-4">
          Activate &amp; Replace
        </v-btn>
      </div>
    </v-alert>

    <v-card>
      <v-card-text>
        <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = ''">{{ error }}</v-alert>
        <v-alert v-if="successMessage" type="success" class="mb-4" closable @click:close="successMessage = ''">{{ successMessage }}</v-alert>
        <v-alert v-if="zohoConnected && type === 'zoho'" type="success" variant="tonal" density="compact" class="mb-4">
          Zoho is connected and ready to sync.
        </v-alert>

        <v-form @submit.prevent="handleSubmit">
          <v-row>
            <v-col cols="12" md="6">
              <v-select v-model="type" :items="credentialTypes" label="Type" :disabled="isEdit" required></v-select>
            </v-col>
            <v-col cols="12" md="6">
              <v-select v-model="status" :items="credentialStatuses" label="Status" required></v-select>
            </v-col>
          </v-row>

          <!-- Active credential info -->
          <v-alert v-if="!isEdit && activeCredential && (type === 'netsuite' || type === 'zoho' || type === 'dep')" type="warning" variant="tonal" density="compact" class="mb-4">
            An active {{ type }} credential already exists (#{{ activeCredential.id }}).
            Save this as <strong>inactive</strong> to set it up without disrupting the current connection, then activate when ready.
          </v-alert>

          <v-divider class="my-4"></v-divider>

          <!-- ==================== DEP CERTIFICATE SECTION ==================== -->
          <template v-if="type === 'dep'">
            <h3 class="text-h6 mb-4">Certificate Setup</h3>

            <v-btn-toggle v-model="depSetupMode" mandatory color="primary" variant="outlined" density="compact" class="mb-4">
              <v-btn value="new">New Certificate</v-btn>
              <v-btn value="migrate">Migrate Existing</v-btn>
            </v-btn-toggle>

            <!-- ===== NEW CERTIFICATE FLOW (CSR) ===== -->
            <template v-if="depSetupMode === 'new'">
              <v-alert type="info" variant="tonal" density="compact" class="mb-4">
                Apple Device Enrollment requires an SSL certificate to communicate securely.
                Generate a certificate request below, send it to Apple, and upload the signed certificate they return.
                Your current connection stays active until you activate this new one.
              </v-alert>

              <v-card variant="outlined" class="mb-4">
                <v-card-title class="text-subtitle-1 bg-blue-grey-lighten-5 py-2 px-4">
                  Step 1: Generate Certificate Request
                </v-card-title>
                <v-card-text>
                  <v-row>
                    <v-col cols="12" md="6">
                      <v-text-field v-model="depCsrForm.soldTo" label="SoldTo Number" hint="Your 10-digit Apple SoldTo number (found in your Apple reseller agreement)" persistent-hint required density="compact" variant="outlined"></v-text-field>
                    </v-col>
                    <v-col cols="12" md="6">
                      <v-text-field v-model="depCsrForm.organization" label="Organization" hint="Legal company name" persistent-hint required density="compact" variant="outlined"></v-text-field>
                    </v-col>
                  </v-row>
                  <v-row>
                    <v-col cols="12" md="4">
                      <v-text-field v-model="depCsrForm.organizationalUnit" label="Organizational Unit" hint="Department (optional)" persistent-hint density="compact" variant="outlined"></v-text-field>
                    </v-col>
                    <v-col cols="12" md="4">
                      <v-text-field v-model="depCsrForm.city" label="City" required density="compact" variant="outlined"></v-text-field>
                    </v-col>
                    <v-col cols="12" md="2">
                      <v-text-field v-model="depCsrForm.state" label="State" required density="compact" variant="outlined"></v-text-field>
                    </v-col>
                    <v-col cols="12" md="2">
                      <v-text-field v-model="depCsrForm.country" label="Country" hint="2-letter" persistent-hint maxlength="2" counter required density="compact" variant="outlined"></v-text-field>
                    </v-col>
                  </v-row>

                  <v-btn
                    color="primary"
                    variant="outlined"
                    :loading="csrGenerating"
                    @click="generateCsr"
                    class="mt-2"
                  >
                    <v-icon start>mdi-certificate</v-icon>
                    Generate Certificate Request
                  </v-btn>

                  <template v-if="csrResult">
                    <v-alert type="success" variant="tonal" density="compact" class="mt-4 mb-3">
                      <div><strong>Certificate request generated.</strong> Subject: {{ csrResult.subject.commonName }}</div>
                      <div class="text-caption mt-1">Your private key has been saved automatically. Download the certificate request below and send it to Apple.</div>
                    </v-alert>

                    <div class="text-subtitle-2 mb-2">Certificate Request (send this to Apple)</div>
                    <v-textarea
                      :model-value="csrResult.csrPem"
                      readonly
                      rows="6"
                      variant="outlined"
                      density="compact"
                      class="font-monospace text-body-2"
                    ></v-textarea>
                    <div class="d-flex ga-2 mt-1">
                      <v-btn size="small" variant="tonal" color="primary" @click="downloadCsr">
                        <v-icon start size="small">mdi-download</v-icon>
                        Download Request
                      </v-btn>
                      <v-btn size="small" variant="tonal" :color="csrCopied ? 'success' : 'default'" @click="copyCsrToClipboard">
                        <v-icon start size="small">{{ csrCopied ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
                        {{ csrCopied ? 'Copied' : 'Copy' }}
                      </v-btn>
                    </div>
                  </template>
                </v-card-text>
              </v-card>

              <v-card variant="outlined" class="mb-4">
                <v-card-title class="text-subtitle-1 bg-blue-grey-lighten-5 py-2 px-4">
                  Step 2: Upload Signed Certificate from Apple
                </v-card-title>
                <v-card-text>
                  <v-alert type="info" variant="tonal" density="compact" class="mb-3">
                    Once Apple returns your signed certificate, paste it below.
                    Your private key was saved in Step 1 — do not regenerate it.
                  </v-alert>
                  <v-textarea
                    v-model="connectionData['ssl_cert']"
                    label="Signed Certificate (from Apple)"
                    hint="Paste the certificate Apple sent back"
                    persistent-hint
                    rows="4"
                    variant="outlined"
                    density="compact"
                  ></v-textarea>
                </v-card-text>
              </v-card>
            </template>

            <!-- ===== MIGRATE EXISTING FLOW ===== -->
            <template v-if="depSetupMode === 'migrate'">
              <v-alert type="info" variant="tonal" density="compact" class="mb-4">
                If you already have a private key and certificate from an existing Apple DEP setup, paste them below.
                This is typically used when migrating from another system.
              </v-alert>

              <v-card variant="outlined" class="mb-4">
                <v-card-title class="text-subtitle-1 bg-blue-grey-lighten-5 py-2 px-4">
                  Existing Certificate &amp; Key
                </v-card-title>
                <v-card-text>
                  <v-textarea
                    v-model="connectionData['ssl_key']"
                    label="Private Key (PEM)"
                    hint="Paste your existing private key in PEM format (begins with -----BEGIN)"
                    persistent-hint
                    rows="4"
                    variant="outlined"
                    density="compact"
                    class="mb-4"
                  ></v-textarea>
                  <v-textarea
                    v-model="connectionData['ssl_cert']"
                    label="Certificate (PEM)"
                    hint="Paste your existing signed certificate in PEM format"
                    persistent-hint
                    rows="4"
                    variant="outlined"
                    density="compact"
                  ></v-textarea>
                </v-card-text>
              </v-card>
            </template>

            <v-divider class="my-4"></v-divider>
          </template>

          <!-- ==================== ZOHO CONNECT SECTION ==================== -->
          <template v-if="type === 'zoho'">
            <h3 class="text-h6 mb-4">Connect to Zoho</h3>
            <v-alert type="info" variant="tonal" density="compact" class="mb-4">
              Enter your Client ID and Client Secret from the
              <a href="https://api-console.zoho.com/" target="_blank" rel="noopener">Zoho API Console</a>,
              then use one of the options below to get your refresh token.
              Your redirect URI is: <code>{{ callbackUri }}</code>
            </v-alert>

            <v-row class="mb-2">
              <v-col cols="12" md="4">
                <v-select v-model="zohoDataCenter" :items="zohoDataCenters" label="Data Center" density="compact" variant="outlined"></v-select>
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field v-model="connectionData['client_id']" label="Client ID" required density="compact" variant="outlined"></v-text-field>
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field v-model="connectionData['client_secret']" label="Client Secret" type="password" required density="compact" variant="outlined"></v-text-field>
              </v-col>
            </v-row>

            <v-row class="mb-4">
              <v-col cols="12" md="6">
                <v-card variant="outlined" class="pa-4 h-100">
                  <div class="text-subtitle-2 mb-2">Option 1: Connect Directly (Recommended)</div>
                  <div class="text-body-2 text-grey mb-3">You will be redirected to Zoho to authorize access. The connection is set up automatically.</div>
                  <v-btn color="primary" variant="outlined" :loading="zohoConnectLoading" :disabled="zohoConnected" @click="connectToZoho" block>
                    <v-icon start>mdi-open-in-new</v-icon>
                    {{ zohoConnected ? 'Connected' : 'Connect to Zoho' }}
                  </v-btn>
                </v-card>
              </v-col>
              <v-col cols="12" md="6">
                <v-card variant="outlined" class="pa-4 h-100">
                  <div class="text-subtitle-2 mb-2">Option 2: Manual Token Entry</div>
                  <div class="text-body-2 text-grey mb-3">
                    If the redirect option does not work, generate a grant token in your <a href="https://api-console.zoho.com/" target="_blank" rel="noopener">Zoho API Console</a> (Self Client) and paste it below.
                  </div>
                  <v-btn v-if="!showGrantTokenFlow" color="primary" variant="outlined" :disabled="zohoConnected" @click="showGrantTokenFlow = true" block>
                    <v-icon start>mdi-key-variant</v-icon>
                    {{ zohoConnected ? 'Connected' : 'Use Grant Token' }}
                  </v-btn>
                  <template v-if="showGrantTokenFlow && !zohoConnected">
                    <v-text-field v-model="grantToken" label="Grant Token" placeholder="1000.abc123..." density="compact" variant="outlined" class="mb-2" hint="This token expires in 2-3 minutes. Make sure to use these scopes when generating it: ZohoCRM.modules.accounts.READ, ZohoCRM.modules.salesorders.READ" persistent-hint></v-text-field>
                    <v-btn color="primary" :loading="grantTokenLoading" @click="exchangeGrantToken" block size="small">Connect with Token</v-btn>
                  </template>
                </v-card>
              </v-col>
            </v-row>
            <v-divider class="my-4"></v-divider>
          </template>

          <!-- ==================== NETSUITE AUTH TYPE + CERT GEN ==================== -->
          <template v-if="type === 'netsuite'">
            <h3 class="text-h6 mb-4">Authentication</h3>
            <v-row class="mb-4">
              <v-col cols="12" md="6">
                <v-btn-toggle v-model="netsuiteAuthType" mandatory color="primary" variant="outlined" density="compact">
                  <v-btn value="oauth1">Token-Based Auth</v-btn>
                  <v-btn value="oauth2">Certificate Auth</v-btn>
                </v-btn-toggle>
              </v-col>
            </v-row>

            <!-- Certificate generation for OAuth 2.0 -->
            <template v-if="netsuiteAuthType === 'oauth2'">
              <v-card variant="outlined" class="mb-4">
                <v-card-title class="text-subtitle-1 bg-blue-grey-lighten-5 py-2 px-4">
                  Certificate &amp; Keys
                </v-card-title>
                <v-card-text>
                  <v-alert type="info" variant="tonal" density="compact" class="mb-4">
                    NetSuite OAuth 2.0 requires an RSA key pair. Generate one here, then upload the certificate to your NetSuite integration record.
                    NetSuite will provide a <strong>Certificate ID</strong> after upload — enter it in the field below.
                  </v-alert>

                  <v-btn
                    color="primary"
                    variant="outlined"
                    :loading="certGenerating"
                    :disabled="!!generatedCert"
                    @click="generateCertificate"
                    class="mb-4"
                  >
                    <v-icon start>mdi-certificate</v-icon>
                    {{ generatedCert ? 'Certificate Generated' : 'Generate Certificate &amp; Keys' }}
                  </v-btn>

                  <template v-if="generatedCert">
                    <v-alert type="success" variant="tonal" density="compact" class="mb-3">
                      <div><strong>Certificate generated successfully.</strong></div>
                      <div class="text-caption mt-1">
                        Fingerprint: {{ generatedCert.fingerprint }}<br>
                        Valid: {{ new Date(generatedCert.validFrom).toLocaleDateString() }} — {{ new Date(generatedCert.validTo).toLocaleDateString() }}
                      </div>
                    </v-alert>

                    <div class="text-subtitle-2 mb-2">
                      Certificate PEM
                      <span class="text-caption text-grey ml-2">Copy this and upload to NetSuite</span>
                    </div>
                    <div class="position-relative">
                      <v-textarea
                        id="cert-pem-display"
                        :model-value="generatedCert.certificatePem"
                        readonly
                        rows="8"
                        variant="outlined"
                        density="compact"
                        class="font-monospace text-body-2"
                      ></v-textarea>
                      <v-btn
                        size="small"
                        variant="tonal"
                        :color="certCopied ? 'success' : 'primary'"
                        style="position: absolute; top: 8px; right: 8px;"
                        @click="copyCertToClipboard"
                      >
                        <v-icon start size="small">{{ certCopied ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
                        {{ certCopied ? 'Copied' : 'Copy' }}
                      </v-btn>
                    </div>

                    <v-alert type="warning" variant="tonal" density="compact" class="mt-3 mb-0">
                      <strong>Next steps:</strong>
                      <ol class="mt-1 mb-0 pl-4">
                        <li>Copy the certificate above</li>
                        <li>Log in to NetSuite and navigate to Setup &gt; Integration &gt; Manage Integrations</li>
                        <li>Open your integration record and paste the certificate into the certificate field</li>
                        <li>Save the record — NetSuite will display a <strong>Certificate ID</strong></li>
                        <li>Come back here and enter that Certificate ID in the field below</li>
                      </ol>
                    </v-alert>
                  </template>
                </v-card-text>
              </v-card>
            </template>
            <v-divider class="my-4"></v-divider>
          </template>

          <!-- ==================== CONNECTION FIELDS ==================== -->
          <h3 class="text-h6 mb-4">
            {{ type === 'zoho' ? 'Connection Settings' : type === 'netsuite' ? (netsuiteAuthType === 'oauth2' ? 'Certificate Auth Settings' : 'Token-Based Auth Settings') : type === 'dep' ? 'Apple DEP Account Details' : 'Connection Details' }}
          </h3>
          <v-row>
            <template v-for="field in currentFields" :key="field">
              <!-- Skip fields already shown in dedicated sections -->
              <v-col
                v-if="!(type === 'zoho' && (field === 'client_id' || field === 'client_secret'))
                    && !(type === 'netsuite' && field === 'auth_type')
                    && !(type === 'netsuite' && netsuiteAuthType === 'oauth2' && (field === 'private_key' || field === 'certificate_pem'))
                    && !(type === 'dep' && (field === 'ssl_key' || field === 'ssl_cert'))"
                cols="12" md="6"
              >
                <v-textarea
                  v-if="isPasswordField(field)"
                  v-model="connectionData[field]"
                  :label="formatLabel(field)"
                  rows="3"
                  :required="type !== 'zoho' || isRequiredZohoField(field)"
                  :hint="zohoFieldDefaults[field] ? `Default: ${zohoFieldDefaults[field]}` : undefined"
                  persistent-hint
                  :readonly="type === 'zoho' && field === 'refresh_token' && zohoConnected"
                ></v-textarea>
                <v-text-field
                  v-else-if="field === 'netsuite_deploy_id'"
                  v-model.number="connectionData[field]"
                  :label="formatLabel(field)"
                  type="number"
                  required
                ></v-text-field>
                <v-text-field
                  v-else
                  v-model="connectionData[field]"
                  :label="formatLabel(field)"
                  :required="type !== 'zoho' || isRequiredZohoField(field)"
                  :placeholder="zohoFieldDefaults[field]"
                  :hint="zohoFieldDefaults[field] ? `Default: ${zohoFieldDefaults[field]}` : undefined"
                  persistent-hint
                ></v-text-field>
              </v-col>
            </template>
          </v-row>

          <!-- ==================== ZOHO FIELD MAPPINGS ==================== -->
          <template v-if="type === 'zoho'">
            <v-divider class="my-6"></v-divider>
            <div class="d-flex align-center mb-4">
              <h3 class="text-h6">Field Mappings</h3>
              <v-spacer></v-spacer>
              <v-switch v-model="showFieldMappings" label="Custom field mappings" color="primary" hide-details density="compact" class="ml-4"></v-switch>
            </div>
            <v-alert type="info" variant="tonal" density="compact" class="mb-4">
              Tell us which fields in your Zoho CRM correspond to ours. Leave a field blank to use the default value shown.
              For nested fields, use dot notation (e.g. <code>Account_Name.id</code>).
              If you are unsure, start with the defaults — you can adjust them later.
            </v-alert>
            <template v-if="showFieldMappings">
              <div class="d-flex justify-end mb-3">
                <v-btn size="small" variant="outlined" @click="resetMappingsToDefaults">Fill with defaults</v-btn>
              </div>

              <!-- Account Mappings -->
              <v-card variant="outlined" class="mb-4">
                <v-card-title class="text-subtitle-1 bg-blue-grey-lighten-5 py-2 px-4">Account Mappings</v-card-title>
                <v-card-text>
                  <v-row v-for="field in accountMappingFields" :key="field.key" align="center" class="my-1">
                    <v-col cols="12" md="4">
                      <div class="font-weight-medium">{{ field.label }}</div>
                      <div class="text-caption text-grey">{{ field.description }}</div>
                    </v-col>
                    <v-col cols="12" md="1" class="text-center d-none d-md-flex justify-center"><v-icon size="small">mdi-arrow-left</v-icon></v-col>
                    <v-col cols="12" md="7">
                      <v-text-field v-model="zohoFieldMappings.account[field.key]" :placeholder="field.default" :hint="`Default: ${field.default}`" persistent-hint density="compact" variant="outlined"></v-text-field>
                    </v-col>
                  </v-row>
                </v-card-text>
              </v-card>

              <!-- Order Mappings -->
              <v-card variant="outlined" class="mb-4">
                <v-card-title class="text-subtitle-1 bg-blue-grey-lighten-5 py-2 px-4">Order Mappings</v-card-title>
                <v-card-text>
                  <v-row v-for="field in orderMappingFields" :key="field.key" align="center" class="my-1">
                    <v-col cols="12" md="4">
                      <div class="font-weight-medium">{{ field.label }}</div>
                      <div class="text-caption text-grey">{{ field.description }}</div>
                    </v-col>
                    <v-col cols="12" md="1" class="text-center d-none d-md-flex justify-center"><v-icon size="small">mdi-arrow-left</v-icon></v-col>
                    <v-col cols="12" md="7">
                      <v-text-field v-model="zohoFieldMappings.order[field.key]" :placeholder="field.default" :hint="`Default: ${field.default}`" persistent-hint density="compact" variant="outlined"></v-text-field>
                    </v-col>
                  </v-row>
                </v-card-text>
              </v-card>

              <!-- Order Item Mappings -->
              <v-card variant="outlined" class="mb-4">
                <v-card-title class="text-subtitle-1 bg-blue-grey-lighten-5 py-2 px-4">Order Item Mappings</v-card-title>
                <v-card-text>
                  <v-row v-for="field in orderItemMappingFields" :key="field.key" align="center" class="my-1">
                    <v-col cols="12" md="4">
                      <div class="font-weight-medium">{{ field.label }}</div>
                      <div class="text-caption text-grey">{{ field.description }}</div>
                    </v-col>
                    <v-col cols="12" md="1" class="text-center d-none d-md-flex justify-center"><v-icon size="small">mdi-arrow-left</v-icon></v-col>
                    <v-col cols="12" md="7">
                      <v-text-field v-model="zohoFieldMappings.orderItems[field.key]" :placeholder="field.default" :hint="`Default: ${field.default}`" persistent-hint density="compact" variant="outlined"></v-text-field>
                    </v-col>
                  </v-row>
                </v-card-text>
              </v-card>

              <!-- JSON Preview -->
              <div class="d-flex align-center mb-2">
                <v-btn size="small" variant="text" @click="showJsonPreview = !showJsonPreview" :append-icon="showJsonPreview ? 'mdi-chevron-up' : 'mdi-chevron-down'">
                  {{ showJsonPreview ? 'Hide' : 'Show' }} JSON preview
                </v-btn>
              </div>
              <v-card v-if="showJsonPreview" variant="outlined" class="mb-4">
                <v-card-text>
                  <pre class="text-body-2" style="white-space: pre-wrap; word-break: break-word;">{{ jsonPreview }}</pre>
                </v-card-text>
              </v-card>
            </template>
          </template>

          <div v-if="type === 'database' || type === 'ssl'" class="mt-4">
            <v-textarea v-model="connectionData" label="Connection Data (JSON)" rows="10" hint="Enter valid JSON"></v-textarea>
          </div>
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" to="/credentials">Cancel</v-btn>
        <v-spacer></v-spacer>
        <!-- Save as disabled (draft) when there's an active credential of this type -->
        <v-btn
          v-if="(type === 'netsuite' || type === 'zoho' || type === 'dep') && activeCredential && !isEdit"
          variant="outlined"
          :loading="loading"
          @click="saveAsDraft"
        >
          Save as Disabled
        </v-btn>
        <v-btn color="primary" :loading="loading" @click="handleSubmit">
          {{ isEdit ? 'Update' : 'Create' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </div>
</template>
