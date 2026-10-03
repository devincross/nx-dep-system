import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '../services/api';
import type { User, LoginDto, LoginResponse } from '../types';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const token = ref<string | null>(null);

  // Initialize from localStorage
  const storedToken = localStorage.getItem('token');
  const storedUser = localStorage.getItem('user');
  if (storedToken) token.value = storedToken;
  if (storedUser) user.value = JSON.parse(storedUser);

  const isAuthenticated = computed(() => !!token.value);
  const isAdmin = computed(() => user.value?.role === 'admin');

  async function login(credentials: LoginDto): Promise<void> {
    const response = await api.post<LoginResponse>('/auth/login', credentials);
    token.value = response.data.access_token;
    user.value = response.data.user;
    localStorage.setItem('token', response.data.access_token);
    localStorage.setItem('user', JSON.stringify(response.data.user));
  }

  async function getProfile(): Promise<User> {
    const response = await api.get<User>('/auth/me');
    user.value = response.data;
    localStorage.setItem('user', JSON.stringify(response.data));
    return response.data;
  }

  async function validateToken(): Promise<{ valid: boolean; user: User }> {
    const response = await api.get<{ valid: boolean; user: User }>('/auth/validate');
    return response.data;
  }

  function logout(): void {
    token.value = null;
    user.value = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }

  function setUser(updated: User): void {
    user.value = updated;
    localStorage.setItem('user', JSON.stringify(updated));
  }

  return {
    user,
    token,
    isAuthenticated,
    isAdmin,
    login,
    getProfile,
    validateToken,
    setUser,
    logout,
  };
});

