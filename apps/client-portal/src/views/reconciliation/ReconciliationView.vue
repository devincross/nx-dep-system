<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useReconciliationStore } from '../../stores/reconciliation';
import { useNotify } from '../../composables/useNotify';
import type {
  ReconciliationRunStatus,
  FindingSeverity,
  RecommendedAction,
  ReconciliationFinding,
  RemediateResult,
  RemediateDryRunResult,
} from '../../types';

const notify = useNotify();
const store = useReconciliationStore();
const route = useRoute();
const router = useRouter();

const TERMINAL_STATUSES: ReconciliationRunStatus[] = ['complete', 'error', 'canceled'];

const activeRunId = ref<string | null>(null);
const starting = ref(false);

// Findings table state
const page = ref(1);
const itemsPerPage = ref(25);
const search = ref('');
const severityFilter = ref<FindingSeverity | ''>('');
const recommendedActionFilter = ref<RecommendedAction | ''>('');
const onlyMismatches = ref(false);

const severities: FindingSeverity[] = ['ok', 'warn', 'critical'];
const recommendedActions: RecommendedAction[] = ['none', 'ov_restore', 'investigate', 'not_in_apple', 'not_in_zoho'];

const expanded = ref<string[]>([]);

const headers = [
  { title: 'Order', key: 'orderNumber', sortable: false },
  { title: 'Severity', key: 'severity', sortable: false },
  { title: 'Action', key: 'recommendedAction', sortable: false },
  { title: 'Our', key: 'ourCount', sortable: false },
  { title: 'Zoho', key: 'zohoCount', sortable: false },
  { title: 'Apple', key: 'appleCount', sortable: false },
  { title: 'Missing from Apple', key: 'missingFromApple', sortable: false },
  { title: '', key: 'data-table-expand', sortable: false },
];

const run = computed(() => store.run);
const isTerminal = computed(() => (run.value ? TERMINAL_STATUSES.includes(run.value.status) : false));
const canResume = computed(() => run.value?.status === 'paused' || run.value?.status === 'error');
const canCancel = computed(
  () => run.value?.status === 'running' || run.value?.status === 'pending' || run.value?.status === 'paused'
);

// ---- Polling ----
let pollTimer: ReturnType<typeof setInterval> | undefined;

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

async function pollOnce() {
  if (!activeRunId.value) return;
  try {
    const r = await store.fetchRun(activeRunId.value);
    if (TERMINAL_STATUSES.includes(r.status)) {
      stopPolling();
    }
  } catch {
    stopPolling();
  }
}

function startPolling() {
  stopPolling();
  if (!activeRunId.value) return;
  pollOnce();
  pollTimer = setInterval(pollOnce, 5000);
}

async function selectRun(runId: string) {
  activeRunId.value = runId;
  router.replace({ query: { ...route.query, runId } });
  page.value = 1;
  startPolling();
  await loadFindings();
}

// ---- Start a run ----
async function startRun() {
  starting.value = true;
  try {
    const runId = await store.createRun();
    notify.success('Reconciliation started.');
    await selectRun(runId);
  } catch (err: any) {
    // 409 if a run is already active — surface the server message.
    notify.errorFrom(err, 'Unable to start reconciliation. Please try again.');
  } finally {
    starting.value = false;
  }
}

// ---- Findings ----
async function loadFindings() {
  if (!activeRunId.value) return;
  await store.fetchFindings(activeRunId.value, {
    page: page.value,
    limit: itemsPerPage.value,
    search: search.value || undefined,
    severity: severityFilter.value || undefined,
    recommendedAction: recommendedActionFilter.value || undefined,
    onlyMismatches: onlyMismatches.value || undefined,
  });
}

function onTableOptions(options: { page: number; itemsPerPage: number }) {
  page.value = options.page;
  itemsPerPage.value = options.itemsPerPage;
  loadFindings();
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    loadFindings();
  }, 400);
});

watch([severityFilter, recommendedActionFilter, onlyMismatches], () => {
  page.value = 1;
  loadFindings();
});

function severityColor(severity: FindingSeverity): string {
  const colors: Record<FindingSeverity, string> = { ok: 'success', warn: 'warning', critical: 'error' };
  return colors[severity] || 'grey';
}

function statusColor(status: ReconciliationRunStatus): string {
  const colors: Record<ReconciliationRunStatus, string> = {
    pending: 'grey',
    running: 'blue',
    paused: 'orange',
    complete: 'success',
    error: 'error',
    canceled: 'grey',
  };
  return colors[status] || 'grey';
}

function rowProps({ item }: { item: ReconciliationFinding }) {
  return item.severity === 'critical' ? { class: 'bg-red-lighten-5' } : {};
}

// ---- CSV ----
async function downloadCsv() {
  if (!activeRunId.value) return;
  try {
    await store.downloadCsv(activeRunId.value);
  } catch (err: any) {
    notify.errorFrom(err, 'Unable to download the CSV. Please try again.');
  }
}

// ---- Resume / Cancel ----
async function resume() {
  if (!activeRunId.value) return;
  try {
    await store.resume(activeRunId.value);
    notify.success('Reconciliation resumed.');
    startPolling();
  } catch (err: any) {
    notify.errorFrom(err, 'Unable to resume this run. Please try again.');
  }
}

async function cancel() {
  if (!activeRunId.value) return;
  try {
    await store.cancel(activeRunId.value);
    notify.success('Reconciliation canceled.');
    await pollOnce();
  } catch (err: any) {
    notify.errorFrom(err, 'Unable to cancel this run. Please try again.');
  }
}

// ---- Remediation ----
const remediateDialog = ref(false);
const remediating = ref(false);
const executing = ref(false);
const executeConfirm = ref(false);
const dryRunResult = ref<RemediateDryRunResult | null>(null);

async function openRemediate() {
  if (!activeRunId.value) return;
  remediating.value = true;
  dryRunResult.value = null;
  executeConfirm.value = false;
  remediateDialog.value = true;
  try {
    const result: RemediateResult = await store.remediate(activeRunId.value, { dryRun: true });
    if (result.dryRun) {
      dryRunResult.value = result;
    }
  } catch (err: any) {
    remediateDialog.value = false;
    notify.errorFrom(err, 'Unable to run the remediation dry run. Please try again.');
  } finally {
    remediating.value = false;
  }
}

async function executeRemediation() {
  if (!activeRunId.value) return;
  executing.value = true;
  try {
    const result: RemediateResult = await store.remediate(activeRunId.value, { dryRun: false });
    if (!result.dryRun) {
      notify.success(
        `Overrides submitted: ${result.submitted} submitted, ${result.skipped} skipped, ${result.failed} failed.`
      );
    }
    remediateDialog.value = false;
  } catch (err: any) {
    notify.errorFrom(err, 'Unable to execute the overrides. Please try again.');
  } finally {
    executing.value = false;
    executeConfirm.value = false;
  }
}

onMounted(() => {
  const queryRunId = route.query.runId;
  if (typeof queryRunId === 'string' && queryRunId) {
    selectRun(queryRunId);
  }
});

onUnmounted(() => {
  stopPolling();
});
</script>

<template>
  <div>
    <div class="d-flex justify-space-between align-center mb-4">
      <h1 class="text-h4">Reconciliation</h1>
      <div class="d-flex ga-2">
        <v-btn
          color="primary"
          prepend-icon="mdi-compare-horizontal"
          :loading="starting"
          @click="startRun"
        >
          Start Reconciliation
        </v-btn>
      </div>
    </div>

    <p class="text-body-2 text-grey mb-4">
      Compares every order across our database, Zoho, and Apple DEP. Our records are auto-corrected from Zoho,
      and device mismatches (especially devices missing from Apple) are reported below.
    </p>

    <!-- Run status / stats -->
    <v-card v-if="run" class="mb-4">
      <v-card-title class="d-flex align-center justify-space-between">
        <div class="d-flex align-center ga-2">
          <v-icon>mdi-progress-check</v-icon>
          <span class="text-subtitle-1">Run {{ run.runId }}</span>
          <v-chip :color="statusColor(run.status)" size="small">{{ run.status }}</v-chip>
        </div>
        <div class="d-flex ga-2">
          <v-btn
            v-if="canResume"
            color="success"
            variant="outlined"
            size="small"
            prepend-icon="mdi-play"
            @click="resume"
          >
            Resume
          </v-btn>
          <v-btn
            v-if="canCancel"
            color="error"
            variant="outlined"
            size="small"
            prepend-icon="mdi-stop"
            @click="cancel"
          >
            Cancel
          </v-btn>
          <v-btn
            color="warning"
            variant="outlined"
            size="small"
            prepend-icon="mdi-auto-fix"
            :disabled="!isTerminal"
            @click="openRemediate"
          >
            Remediate (dry run)
          </v-btn>
          <v-btn
            color="info"
            variant="outlined"
            size="small"
            prepend-icon="mdi-download"
            @click="downloadCsv"
          >
            Download CSV
          </v-btn>
        </div>
      </v-card-title>
      <v-card-text>
        <v-progress-linear
          :model-value="(run.progress || 0) * 100"
          :indeterminate="run.status === 'running' && !run.totalOrders"
          color="primary"
          height="20"
          rounded
          class="mb-4"
        >
          <template v-slot:default>
            <span class="text-caption">
              {{ run.processedOrders }} / {{ run.totalOrders ?? '?' }}
              ({{ Math.round((run.progress || 0) * 100) }}%)
            </span>
          </template>
        </v-progress-linear>

        <v-alert v-if="run.error" type="error" variant="tonal" class="mb-4">{{ run.error }}</v-alert>

        <v-row dense>
          <v-col cols="6" sm="4" md="2">
            <v-card variant="tonal" color="grey">
              <v-card-text class="text-center">
                <div class="text-h6">{{ run.processedOrders }} / {{ run.totalOrders ?? '?' }}</div>
                <div class="text-caption">Processed</div>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="6" sm="4" md="2">
            <v-card variant="tonal" color="error">
              <v-card-text class="text-center">
                <div class="text-h6">{{ run.criticalCount }}</div>
                <div class="text-caption">Critical (missing from Apple)</div>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="6" sm="4" md="2">
            <v-card variant="tonal" color="warning">
              <v-card-text class="text-center">
                <div class="text-h6">{{ run.zohoMismatchCount }}</div>
                <div class="text-caption">Zoho Mismatches</div>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="6" sm="4" md="2">
            <v-card variant="tonal" color="teal">
              <v-card-text class="text-center">
                <div class="text-h6">{{ run.zohoCorrectedCount }}</div>
                <div class="text-caption">Zoho Corrected</div>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="6" sm="4" md="2">
            <v-card variant="tonal" color="success">
              <v-card-text class="text-center">
                <div class="text-h6">{{ run.appleMatchCount }}</div>
                <div class="text-caption">Apple Matches</div>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="6" sm="4" md="2">
            <v-card variant="tonal" color="deep-orange">
              <v-card-text class="text-center">
                <div class="text-h6">{{ run.errorOrderCount }}</div>
                <div class="text-caption">Order Errors</div>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-alert v-else type="info" variant="tonal" class="mb-4">
      No active run selected. Start a reconciliation to begin.
    </v-alert>

    <!-- Findings table -->
    <v-card v-if="run">
      <v-card-title>
        <v-row>
          <v-col cols="12" sm="4">
            <v-text-field
              v-model="search"
              prepend-icon="mdi-magnify"
              label="Search order or serial"
              single-line
              hide-details
              clearable
            ></v-text-field>
          </v-col>
          <v-col cols="12" sm="3">
            <v-select
              v-model="severityFilter"
              :items="[{ title: 'All Severities', value: '' }, ...severities.map(s => ({ title: s.toUpperCase(), value: s }))]"
              label="Severity"
              hide-details
              clearable
            ></v-select>
          </v-col>
          <v-col cols="12" sm="3">
            <v-select
              v-model="recommendedActionFilter"
              :items="[{ title: 'All Actions', value: '' }, ...recommendedActions.map(a => ({ title: a, value: a }))]"
              label="Recommended Action"
              hide-details
              clearable
            ></v-select>
          </v-col>
          <v-col cols="12" sm="2" class="d-flex align-center">
            <v-switch
              v-model="onlyMismatches"
              label="Only mismatches"
              hide-details
              color="primary"
              density="compact"
            ></v-switch>
          </v-col>
        </v-row>
      </v-card-title>
      <v-data-table-server
        v-model:expanded="expanded"
        :headers="headers"
        :items="store.findings"
        :items-length="store.findingsTotal"
        :loading="store.loading"
        :page="page"
        :items-per-page="itemsPerPage"
        :row-props="rowProps"
        show-expand
        item-value="id"
        class="elevation-1"
        @update:options="onTableOptions"
      >
        <template v-slot:item.severity="{ item }">
          <v-chip :color="severityColor(item.severity)" size="small">{{ item.severity }}</v-chip>
        </template>
        <template v-slot:item.recommendedAction="{ item }">
          <span class="text-caption">{{ item.recommendedAction }}</span>
        </template>
        <template v-slot:item.ourCount="{ item }">
          {{ item.ourDevices.length }}
        </template>
        <template v-slot:item.zohoCount="{ item }">
          {{ item.zohoDevices ? item.zohoDevices.length : '--' }}
        </template>
        <template v-slot:item.appleCount="{ item }">
          {{ item.appleDevices ? item.appleDevices.length : '--' }}
        </template>
        <template v-slot:item.missingFromApple="{ item }">
          <v-chip v-if="item.missingFromApple.length > 0" color="error" size="x-small">
            {{ item.missingFromApple.length }}
          </v-chip>
          <span v-else class="text-grey">--</span>
        </template>
        <template v-slot:expanded-row="{ columns, item }">
          <tr>
            <td :colspan="columns.length" class="pa-4">
              <v-row>
                <v-col cols="12" md="4">
                  <div class="text-caption font-weight-bold mb-1">Our Devices ({{ item.ourDevices.length }})</div>
                  <div v-for="s in item.ourDevices" :key="'our-' + s" class="text-caption">{{ s }}</div>
                  <div v-if="item.ourDevices.length === 0" class="text-caption text-grey">None</div>
                </v-col>
                <v-col cols="12" md="4">
                  <div class="text-caption font-weight-bold mb-1">
                    Zoho Devices ({{ item.zohoDevices ? item.zohoDevices.length : 'N/A' }})
                  </div>
                  <template v-if="item.zohoDevices">
                    <div v-for="s in item.zohoDevices" :key="'zoho-' + s" class="text-caption">{{ s }}</div>
                    <div v-if="item.zohoDevices.length === 0" class="text-caption text-grey">None</div>
                  </template>
                  <div v-else class="text-caption text-grey">Not found in Zoho</div>
                </v-col>
                <v-col cols="12" md="4">
                  <div class="text-caption font-weight-bold mb-1">
                    Apple Devices ({{ item.appleDevices ? item.appleDevices.length : 'N/A' }})
                  </div>
                  <template v-if="item.appleDevices">
                    <div
                      v-for="s in item.appleDevices"
                      :key="'apple-' + s"
                      class="text-caption"
                    >{{ s }}</div>
                    <div v-if="item.appleDevices.length === 0" class="text-caption text-grey">None</div>
                  </template>
                  <div v-else class="text-caption text-grey">Not found in Apple</div>
                </v-col>
              </v-row>
              <v-divider class="my-3"></v-divider>
              <v-row>
                <v-col cols="12" md="4">
                  <div class="text-caption font-weight-bold text-error mb-1">Missing from Apple</div>
                  <div v-for="s in item.missingFromApple" :key="'mfa-' + s" class="text-caption text-error">{{ s }}</div>
                  <div v-if="item.missingFromApple.length === 0" class="text-caption text-grey">None</div>
                </v-col>
                <v-col cols="12" md="4">
                  <div class="text-caption font-weight-bold text-teal mb-1">Zoho Added</div>
                  <div v-for="s in item.zohoAdded" :key="'za-' + s" class="text-caption">{{ s }}</div>
                  <div v-if="item.zohoAdded.length === 0" class="text-caption text-grey">None</div>
                </v-col>
                <v-col cols="12" md="4">
                  <div class="text-caption font-weight-bold text-orange mb-1">Zoho Removed</div>
                  <div v-for="s in item.zohoRemoved" :key="'zr-' + s" class="text-caption">{{ s }}</div>
                  <div v-if="item.zohoRemoved.length === 0" class="text-caption text-grey">None</div>
                </v-col>
              </v-row>
            </td>
          </tr>
        </template>
      </v-data-table-server>
    </v-card>

    <!-- Remediation dialog -->
    <v-dialog v-model="remediateDialog" max-width="900" persistent>
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon start>mdi-auto-fix</v-icon>
          Remediate — Restore Overrides to Apple
        </v-card-title>
        <v-card-text>
          <div v-if="remediating" class="text-center py-6">
            <v-progress-circular indeterminate color="primary" size="48" class="mb-4"></v-progress-circular>
            <div>Computing remediation candidates (dry run)...</div>
          </div>

          <template v-if="dryRunResult">
            <v-alert type="info" variant="tonal" class="mb-4">
              {{ dryRunResult.candidateCount }} candidate order(s), {{ dryRunResult.eligible }} eligible,
              {{ dryRunResult.skipped.length }} skipped.
              Will submit in {{ dryRunResult.chunkCount }} chunk(s) of {{ dryRunResult.chunkSize }}.
            </v-alert>

            <v-alert type="warning" variant="tonal" class="mb-4">
              Executing will push OV (override) restores to Apple for the devices listed below. This is a
              destructive operation that changes enrollment in Apple Business Manager.
            </v-alert>

            <v-table density="compact" class="mb-4">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Devices</th>
                  <th>Serials</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="o in dryRunResult.orders" :key="o.orderId">
                  <td>
                    <div class="font-weight-medium">{{ o.orderNumber }}</div>
                    <div class="text-caption text-grey">ID: {{ o.orderId }}</div>
                  </td>
                  <td>{{ o.deviceCount }}</td>
                  <td>
                    <div v-for="s in o.devices" :key="s" class="text-caption">{{ s }}</div>
                  </td>
                </tr>
                <tr v-if="dryRunResult.orders.length === 0">
                  <td colspan="3" class="text-caption text-grey">No eligible orders to remediate.</td>
                </tr>
              </tbody>
            </v-table>

            <template v-if="dryRunResult.skipped.length > 0">
              <div class="text-caption font-weight-bold mb-1">Skipped</div>
              <div v-for="s in dryRunResult.skipped" :key="'skip-' + s.orderId" class="text-caption text-grey">
                Order {{ s.orderId }}: {{ s.reason }}
              </div>
            </template>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn :disabled="remediating || executing" @click="remediateDialog = false">Close</v-btn>
          <v-btn
            v-if="dryRunResult && dryRunResult.eligible > 0 && !executeConfirm"
            color="error"
            :disabled="remediating"
            @click="executeConfirm = true"
          >
            Execute Overrides
          </v-btn>
          <template v-if="executeConfirm">
            <span class="text-caption text-error mr-2">Push {{ dryRunResult?.eligible }} override(s) to Apple?</span>
            <v-btn :disabled="executing" @click="executeConfirm = false">Cancel</v-btn>
            <v-btn color="error" :loading="executing" @click="executeRemediation">Confirm Execute</v-btn>
          </template>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
