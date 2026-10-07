import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../services/api';
import type { TenantInfo, ConnectionType } from '../types';

export const useTenantStore = defineStore('tenant', () => {
  const info = ref<TenantInfo | null>(null);
  const connectionType = ref<ConnectionType | null>(null);

  async function fetchTenantInfo(): Promise<TenantInfo | null> {
    try {
      const response = await api.get<TenantInfo>('/tenant-info');
      info.value = response.data;
      connectionType.value = response.data.tenant.connectionType;
      return response.data;
    } catch {
      // Non-fatal: nav falls back to showing nothing ERP-specific.
      return null;
    }
  }

  return { info, connectionType, fetchTenantInfo };
});
