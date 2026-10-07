import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../services/api';
import type { ZohoStatus, ZohoTestResult, ZohoResponse } from '../types';

export const useZohoStore = defineStore('zoho', () => {
  const status = ref<ZohoStatus | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchStatus(): Promise<ZohoStatus> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<ZohoStatus>('/zoho/status');
      status.value = response.data;
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to fetch Zoho status';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function testConnection(): Promise<ZohoTestResult> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<ZohoTestResult>('/zoho/test');
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to test Zoho connection';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function getOrders(query?: Record<string, unknown>): Promise<ZohoResponse> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<ZohoResponse>('/zoho/orders', { params: query });
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to fetch Zoho orders';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function getAccounts(query?: Record<string, unknown>): Promise<ZohoResponse> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<ZohoResponse>('/zoho/accounts', { params: query });
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to fetch Zoho accounts';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function fetchModule(query: Record<string, unknown>): Promise<ZohoResponse> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<ZohoResponse>('/zoho/module', { params: query });
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to read Zoho module';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return {
    status,
    loading,
    error,
    fetchStatus,
    testConnection,
    getOrders,
    getAccounts,
    fetchModule,
  };
});
