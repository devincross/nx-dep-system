import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../services/api';
import type {
  ReconciliationRun,
  ReconciliationFinding,
  ReconciliationRunsPage,
  ReconciliationFindingsPage,
  ReconciliationFindingsParams,
  CreateReconciliationRunResponse,
  ReconciliationActionResponse,
  RemediateParams,
  RemediateResult,
} from '../types';

export const useReconciliationStore = defineStore('reconciliation', () => {
  const run = ref<ReconciliationRun | null>(null);
  const runs = ref<ReconciliationRun[]>([]);
  const runsTotal = ref(0);
  const findings = ref<ReconciliationFinding[]>([]);
  const findingsTotal = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function createRun(note?: string): Promise<string> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post<CreateReconciliationRunResponse>('/reconciliation/runs', { note });
      return response.data.runId;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Unable to start a reconciliation run. Please try again.';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function fetchRun(runId: string): Promise<ReconciliationRun> {
    error.value = null;
    try {
      const response = await api.get<ReconciliationRun>(`/reconciliation/runs/${runId}`);
      run.value = response.data;
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Unable to load this reconciliation run. Please try again.';
      throw err;
    }
  }

  async function listRuns(page: number, limit: number): Promise<ReconciliationRun[]> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<ReconciliationRunsPage>('/reconciliation/runs', {
        params: { page, limit },
      });
      runs.value = response.data.items;
      runsTotal.value = response.data.total;
      return response.data.items;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Unable to load reconciliation runs. Please try again.';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function fetchFindings(
    runId: string,
    params: ReconciliationFindingsParams
  ): Promise<ReconciliationFinding[]> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<ReconciliationFindingsPage>(
        `/reconciliation/runs/${runId}/findings`,
        { params }
      );
      findings.value = response.data.items;
      findingsTotal.value = response.data.total;
      return response.data.items;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Unable to load findings. Please try again.';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function resume(runId: string): Promise<ReconciliationActionResponse> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post<ReconciliationActionResponse>(`/reconciliation/runs/${runId}/resume`);
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Unable to resume this run. Please try again.';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function cancel(runId: string): Promise<ReconciliationActionResponse> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post<ReconciliationActionResponse>(`/reconciliation/runs/${runId}/cancel`);
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Unable to cancel this run. Please try again.';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function remediate(runId: string, params: RemediateParams): Promise<RemediateResult> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post<RemediateResult>(
        `/reconciliation/runs/${runId}/remediate`,
        params
      );
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Unable to run remediation. Please try again.';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function downloadCsv(runId: string): Promise<void> {
    error.value = null;
    try {
      const response = await api.get(`/reconciliation/runs/${runId}/findings.csv`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `reconciliation-${runId}-findings.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Unable to download the findings CSV. Please try again.';
      throw err;
    }
  }

  return {
    run,
    runs,
    runsTotal,
    findings,
    findingsTotal,
    loading,
    error,
    createRun,
    fetchRun,
    listRuns,
    fetchFindings,
    resume,
    cancel,
    remediate,
    downloadCsv,
  };
});
