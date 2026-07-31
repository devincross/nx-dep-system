import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../services/api';
import type { User, CreateUserDto, UpdateUserDto, UpdateMeDto } from '../types';

export const useUsersStore = defineStore('users', () => {
  const users = ref<User[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchAll(): Promise<User[]> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<User[]>('/users');
      users.value = response.data;
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Unable to load users. Please try again.';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function create(data: CreateUserDto): Promise<User> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post<User>('/users', data);
      users.value.push(response.data);
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Unable to create the user. Please check your entries and try again.';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function update(id: string, data: UpdateUserDto): Promise<User> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.put<User>(`/users/${id}`, data);
      const index = users.value.findIndex((u) => u.id === id);
      if (index !== -1) users.value[index] = response.data;
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Unable to update the user. Please check your entries and try again.';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function remove(id: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      await api.delete(`/users/${id}`);
      users.value = users.value.filter((u) => u.id !== id);
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Unable to delete this user. Please try again.';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function updateMe(data: UpdateMeDto): Promise<User> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.put<User>('/users/me', data);
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Unable to update your account. Please check your entries and try again.';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return {
    users,
    loading,
    error,
    fetchAll,
    create,
    update,
    remove,
    updateMe,
  };
});
