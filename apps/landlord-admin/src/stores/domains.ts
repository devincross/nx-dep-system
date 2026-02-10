import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../services/api';
import type { Domain, CreateDomainDto, UpdateDomainDto } from '../types';

export const useDomainsStore = defineStore('domains', () => {
  const domains = ref<Domain[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchDomains(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<Domain[]>('/domains');
      domains.value = response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to fetch domains';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function fetchDomain(id: string): Promise<Domain> {
    const response = await api.get<Domain>(`/domains/${id}`);
    return response.data;
  }

  async function createDomain(domainData: CreateDomainDto): Promise<Domain> {
    const response = await api.post<Domain>('/domains', domainData);
    domains.value.push(response.data);
    return response.data;
  }

  async function updateDomain(id: string, domainData: UpdateDomainDto): Promise<Domain> {
    const response = await api.put<Domain>(`/domains/${id}`, domainData);
    const index = domains.value.findIndex((d) => d.id === id);
    if (index !== -1) {
      domains.value[index] = response.data;
    }
    return response.data;
  }

  async function deleteDomain(id: string): Promise<void> {
    await api.delete(`/domains/${id}`);
    domains.value = domains.value.filter((d) => d.id !== id);
  }

  async function testConnection(id: string): Promise<{ success: boolean; message: string }> {
    const response = await api.post<{ success: boolean; message: string }>(`/domains/${id}/test-connection`);
    return response.data;
  }

  return {
    domains,
    loading,
    error,
    fetchDomains,
    fetchDomain,
    createDomain,
    updateDomain,
    deleteDomain,
    testConnection,
  };
});

