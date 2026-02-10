import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../services/api';
import type { User, CreateUserDto, UpdateUserDto } from '../types';

export const useUsersStore = defineStore('users', () => {
  const users = ref<User[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchUsers(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<User[]>('/users');
      users.value = response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to fetch users';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function fetchUser(id: string): Promise<User> {
    const response = await api.get<User>(`/users/${id}`);
    return response.data;
  }

  async function createUser(userData: CreateUserDto): Promise<User> {
    const response = await api.post<User>('/users', userData);
    users.value.push(response.data);
    return response.data;
  }

  async function updateUser(id: string, userData: UpdateUserDto): Promise<User> {
    const response = await api.put<User>(`/users/${id}`, userData);
    const index = users.value.findIndex((u) => u.id === id);
    if (index !== -1) {
      users.value[index] = response.data;
    }
    return response.data;
  }

  async function deleteUser(id: string): Promise<void> {
    await api.delete(`/users/${id}`);
    users.value = users.value.filter((u) => u.id !== id);
  }

  return {
    users,
    loading,
    error,
    fetchUsers,
    fetchUser,
    createUser,
    updateUser,
    deleteUser,
  };
});

