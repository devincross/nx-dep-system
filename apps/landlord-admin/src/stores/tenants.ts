import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../services/api';
import type { Tenant, CreateTenantDto, UpdateTenantDto } from '../types';

export const useTenantsStore = defineStore('tenants', () => {
  const tenants = ref<Tenant[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchTenants(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<Tenant[]>('/tenants');
      tenants.value = response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to fetch tenants';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function fetchTenant(id: string): Promise<Tenant> {
    const response = await api.get<Tenant>(`/tenants/${id}`);
    return response.data;
  }

  async function createTenant(tenantData: CreateTenantDto): Promise<Tenant> {
    const response = await api.post<Tenant>('/tenants', tenantData);
    tenants.value.push(response.data);
    return response.data;
  }

  async function updateTenant(id: string, tenantData: UpdateTenantDto): Promise<Tenant> {
    const response = await api.put<Tenant>(`/tenants/${id}`, tenantData);
    const index = tenants.value.findIndex((t) => t.id === id);
    if (index !== -1) {
      tenants.value[index] = response.data;
    }
    return response.data;
  }

  async function deleteTenant(id: string): Promise<void> {
    await api.delete(`/tenants/${id}`);
    tenants.value = tenants.value.filter((t) => t.id !== id);
  }

  return {
    tenants,
    loading,
    error,
    fetchTenants,
    fetchTenant,
    createTenant,
    updateTenant,
    deleteTenant,
  };
});

