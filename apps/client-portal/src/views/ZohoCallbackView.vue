<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import api from '../services/api';

const router = useRouter();
const status = ref<'loading' | 'success' | 'error'>('loading');
const errorMessage = ref('');

onMounted(async () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const accountsServer = params.get('accounts-server');

  if (!code) {
    status.value = 'error';
    errorMessage.value = 'Zoho did not return an authorization code. Please try connecting again from the credentials page.';
    return;
  }

  // Retrieve OAuth params saved before redirect
  const saved = sessionStorage.getItem('zoho_oauth_params');
  if (!saved) {
    status.value = 'error';
    errorMessage.value = 'Your connection session has expired. Please go back to the credentials page and try connecting again.';
    return;
  }

  const oauthParams = JSON.parse(saved) as {
    client_id: string;
    client_secret: string;
    redirect_uri: string;
    data_center: string;
    credential_id?: number;
  };

  try {
    const response = await api.post<{ refresh_token: string; api_domain: string }>('/zoho/exchange-token', {
      code,
      client_id: oauthParams.client_id,
      client_secret: oauthParams.client_secret,
      redirect_uri: oauthParams.redirect_uri,
      accounts_server: accountsServer || undefined,
      data_center: oauthParams.data_center,
    });

    // Store the tokens for the credential form to pick up
    sessionStorage.setItem('zoho_oauth_result', JSON.stringify({
      refresh_token: response.data.refresh_token,
      api_domain: response.data.api_domain,
    }));

    sessionStorage.removeItem('zoho_oauth_params');
    status.value = 'success';

    // Redirect back to credential form
    const credentialId = oauthParams.credential_id;
    if (credentialId) {
      router.push(`/credentials/${credentialId}/edit`);
    } else {
      router.push('/credentials/create?type=zoho');
    }
  } catch (err: any) {
    status.value = 'error';
    errorMessage.value = err.response?.data?.message || err.message || 'Unable to complete the Zoho connection. Please try again from the credentials page.';
    sessionStorage.removeItem('zoho_oauth_params');
  }
});
</script>

<template>
  <div class="d-flex justify-center align-center" style="min-height: 60vh;">
    <v-card width="500" class="text-center pa-6">
      <template v-if="status === 'loading'">
        <v-progress-circular indeterminate color="primary" size="48" class="mb-4"></v-progress-circular>
        <div class="text-h6">Connecting to Zoho...</div>
        <div class="text-body-2 text-grey mt-2">Finishing the connection setup...</div>
      </template>

      <template v-if="status === 'success'">
        <v-icon size="48" color="success" class="mb-4">mdi-check-circle</v-icon>
        <div class="text-h6">Connected to Zoho</div>
        <div class="text-body-2 text-grey mt-2">Redirecting to credential form...</div>
      </template>

      <template v-if="status === 'error'">
        <v-icon size="48" color="error" class="mb-4">mdi-alert-circle</v-icon>
        <div class="text-h6">Connection Failed</div>
        <v-alert type="error" variant="tonal" class="mt-4 text-left">{{ errorMessage }}</v-alert>
        <v-btn color="primary" class="mt-4" to="/credentials">Back to Credentials</v-btn>
      </template>
    </v-card>
  </div>
</template>
