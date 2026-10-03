import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../services/api';
import type { Account, SyncAllAccountsResult } from '../types';

export const useAccountsStore = defineStore('accounts', () => {
  const accounts = ref<Account[]>([]);
  const loading = ref(false);
  const syncing = ref(false);
  const error = ref<string | null>(null);

  async function fetchAll(search?: string): Promise<Account[]> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<Account[]>('/accounts', {
        params: search ? { search } : undefined,
      });
      accounts.value = response.data;
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Unable to load accounts. Please try again.';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function syncAll(): Promise<SyncAllAccountsResult> {
    syncing.value = true;
    error.value = null;
    try {
      const response = await api.post<SyncAllAccountsResult>('/accounts/sync');
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Unable to sync accounts. Please try again.';
      throw err;
    } finally {
      syncing.value = false;
    }
  }

  return { accounts, loading, syncing, error, fetchAll, syncAll };
});
