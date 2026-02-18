import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../services/api';
import type {
  Credential,
  CreateCredentialDto,
  UpdateCredentialDto,
  CredentialType,
} from '../types';

export const useCredentialsStore = defineStore('credentials', () => {
  const credentials = ref<Credential[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchAll(): Promise<Credential[]> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<Credential[]>('/credentials');
      credentials.value = response.data;
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to fetch credentials';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function fetchByType(type: CredentialType): Promise<Credential[]> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<Credential[]>(`/credentials/type/${type}`);
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to fetch credentials';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function fetchOne(id: number): Promise<Credential> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<Credential>(`/credentials/${id}`);
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to fetch credential';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function create(data: CreateCredentialDto): Promise<Credential> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post<Credential>('/credentials', data);
      credentials.value.push(response.data);
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to create credential';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function update(id: number, data: UpdateCredentialDto): Promise<Credential> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.put<Credential>(`/credentials/${id}`, data);
      const index = credentials.value.findIndex((c) => c.id === id);
      if (index !== -1) {
        credentials.value[index] = response.data;
      }
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to update credential';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function remove(id: number): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      await api.delete(`/credentials/${id}`);
      credentials.value = credentials.value.filter((c) => c.id !== id);
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to delete credential';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function restore(id: number): Promise<Credential> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post<Credential>(`/credentials/${id}/restore`);
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to restore credential';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function hardDelete(id: number): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      await api.delete(`/credentials/${id}/permanent`);
      credentials.value = credentials.value.filter((c) => c.id !== id);
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to permanently delete credential';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return {
    credentials,
    loading,
    error,
    fetchAll,
    fetchByType,
    fetchOne,
    create,
    update,
    remove,
    restore,
    hardDelete,
  };
});

