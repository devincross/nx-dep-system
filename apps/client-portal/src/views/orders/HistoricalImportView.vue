<script setup lang="ts">
import { ref } from 'vue';
import api from '../../services/api';

const startDate = ref('');
const pageSize = ref(50);
const pageDelayMs = ref(2000);
const importing = ref(false);
const error = ref('');
const result = ref<{
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errored: number;
  errors: string[];
  pages: number;
} | null>(null);

async function startImport() {
  if (!startDate.value) {
    error.value = 'Please select a start date.';
    return;
  }

  importing.value = true;
  error.value = '';
  result.value = null;

  try {
    const response = await api.post('/orders/historical-import', {
      startDate: new Date(startDate.value).toISOString(),
      pageSize: pageSize.value,
      pageDelayMs: pageDelayMs.value,
    });
    result.value = response.data;
  } catch (err: any) {
    error.value = err.response?.data?.message || err.message || 'The import could not be completed. Please check your connection settings and try again.';
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <div>
    <h1 class="text-h4 mb-6">Historical Order Import</h1>

    <v-alert type="info" variant="tonal" class="mb-6">
      Import existing orders from your system (NetSuite or Zoho) starting from a specific date.
      Imported orders are recorded for tracking purposes only and will <strong>not</strong> be submitted to Apple Device Enrollment.
      Use this to bring in your order history when setting up your account for the first time.
    </v-alert>

    <v-card>
      <v-card-title>Import Settings</v-card-title>
      <v-card-text>
        <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = ''">{{ error }}</v-alert>

        <v-row>
          <v-col cols="12" md="4">
            <v-text-field
              v-model="startDate"
              label="Pull orders from"
              type="date"
              hint="Orders modified on or after this date will be imported"
              persistent-hint
              required
            ></v-text-field>
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field
              v-model.number="pageSize"
              label="Page size"
              type="number"
              hint="Number of orders to fetch at a time (max 200). Use a lower number if you experience timeouts."
              persistent-hint
              :min="1"
              :max="200"
            ></v-text-field>
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field
              v-model.number="pageDelayMs"
              label="Delay between batches (ms)"
              type="number"
              hint="Wait time between each batch to avoid overloading your system"
              persistent-hint
              :min="0"
              :max="30000"
            ></v-text-field>
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn
          color="primary"
          :loading="importing"
          :disabled="!startDate"
          @click="startImport"
          size="large"
        >
          <v-icon start>mdi-database-import</v-icon>
          Start Import
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- Progress -->
    <v-card v-if="importing" class="mt-6">
      <v-card-text class="text-center py-8">
        <v-progress-circular indeterminate color="primary" size="48" class="mb-4"></v-progress-circular>
        <div class="text-h6">Importing orders...</div>
        <div class="text-body-2 text-grey mt-2">
          This may take several minutes depending on the number of orders.
          Batches are fetched with a {{ pageDelayMs }}ms delay between each request.
        </div>
      </v-card-text>
    </v-card>

    <!-- Results -->
    <v-card v-if="result" class="mt-6">
      <v-card-title>Import Results</v-card-title>
      <v-card-text>
        <v-alert
          :type="result.errored === 0 ? 'success' : 'warning'"
          variant="tonal"
          class="mb-4"
        >
          {{ result.processed }} orders processed across {{ result.pages }} batches.
          <span v-if="result.errored > 0"> {{ result.errored }} errors encountered.</span>
        </v-alert>

        <v-row>
          <v-col cols="6" md="3">
            <v-card variant="outlined" class="text-center pa-4">
              <div class="text-h5 text-primary">{{ result.processed }}</div>
              <div class="text-caption">Processed</div>
            </v-card>
          </v-col>
          <v-col cols="6" md="3">
            <v-card variant="outlined" class="text-center pa-4">
              <div class="text-h5 text-success">{{ result.created }}</div>
              <div class="text-caption">Created</div>
            </v-card>
          </v-col>
          <v-col cols="6" md="3">
            <v-card variant="outlined" class="text-center pa-4">
              <div class="text-h5 text-info">{{ result.updated }}</div>
              <div class="text-caption">Updated</div>
            </v-card>
          </v-col>
          <v-col cols="6" md="3">
            <v-card variant="outlined" class="text-center pa-4">
              <div class="text-h5" :class="result.errored > 0 ? 'text-error' : 'text-grey'">{{ result.errored }}</div>
              <div class="text-caption">Errors</div>
            </v-card>
          </v-col>
        </v-row>

        <div v-if="result.errors.length > 0" class="mt-4">
          <div class="text-subtitle-2 mb-2">Errors</div>
          <v-list density="compact">
            <v-list-item v-for="(err, i) in result.errors.slice(0, 20)" :key="i">
              <template v-slot:prepend>
                <v-icon color="error" size="small">mdi-alert-circle</v-icon>
              </template>
              <v-list-item-title class="text-body-2">{{ err }}</v-list-item-title>
            </v-list-item>
            <v-list-item v-if="result.errors.length > 20">
              <v-list-item-title class="text-body-2 text-grey">
                ...and {{ result.errors.length - 20 }} more errors
              </v-list-item-title>
            </v-list-item>
          </v-list>
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>
