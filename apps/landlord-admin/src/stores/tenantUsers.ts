import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../services/api';
import type { TenantUser, CreateTenantUserDto, UpdateTenantUserDto } from '../types';

export const useTenantUsersStore = defineStore('tenantUsers', () => {
  const users = ref<TenantUser[]>([]);
  const loading = ref(false);

  async function fetchUsers(tenantId: string): Promise<void> {
    loading.value = true;
    try {
      users.value = (await api.get<TenantUser[]>(`/tenants/${tenantId}/users`)).data;
    } finally {
      loading.value = false;
    }
  }

  async function createUser(tenantId: string, dto: CreateTenantUserDto): Promise<TenantUser> {
    const created = (await api.post<TenantUser>(`/tenants/${tenantId}/users`, dto)).data;
    users.value.push(created);
    return created;
  }

  async function updateUser(tenantId: string, userId: string, dto: UpdateTenantUserDto): Promise<TenantUser> {
    const updated = (await api.put<TenantUser>(`/tenants/${tenantId}/users/${userId}`, dto)).data;
    const i = users.value.findIndex((u) => u.id === userId);
    if (i !== -1) users.value[i] = updated;
    return updated;
  }

  return { users, loading, fetchUsers, createUser, updateUser };
});
