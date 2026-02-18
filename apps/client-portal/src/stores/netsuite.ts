import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../services/api';
import type { NetsuiteStatus, NetsuiteTestResult, NetsuiteResponse } from '../types';

export const useNetsuiteStore = defineStore('netsuite', () => {
  const status = ref<NetsuiteStatus | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchStatus(): Promise<NetsuiteStatus> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<NetsuiteStatus>('/netsuite/status');
      status.value = response.data;
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to fetch NetSuite status';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function testConnection(): Promise<NetsuiteTestResult> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<NetsuiteTestResult>('/netsuite/test');
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to test NetSuite connection';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function getOrders(query?: Record<string, unknown>): Promise<NetsuiteResponse> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<NetsuiteResponse>('/netsuite/orders', { params: query });
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to fetch NetSuite orders';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function createOrder(data: Record<string, unknown>): Promise<NetsuiteResponse> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post<NetsuiteResponse>('/netsuite/orders', data);
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to create NetSuite order';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function getAccounts(query?: Record<string, unknown>): Promise<NetsuiteResponse> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<NetsuiteResponse>('/netsuite/accounts', { params: query });
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to fetch NetSuite accounts';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function createAccount(data: Record<string, unknown>): Promise<NetsuiteResponse> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post<NetsuiteResponse>('/netsuite/accounts', data);
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to create NetSuite account';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function callRestlet(
    scriptId: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    data?: Record<string, unknown>
  ): Promise<NetsuiteResponse> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post<NetsuiteResponse>('/netsuite/restlet', {
        scriptId,
        method,
        data,
      });
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to call NetSuite RESTlet';
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
    createOrder,
    getAccounts,
    createAccount,
    callRestlet,
  };
});

