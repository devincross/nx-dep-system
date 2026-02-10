import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '../services/api';
import type { User, LoginDto, LoginResponse, CreateUserDto } from '../types';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const token = ref<string | null>(null);

  // Initialize from localStorage
  const storedToken = localStorage.getItem('token');
  const storedUser = localStorage.getItem('user');
  if (storedToken) token.value = storedToken;
  if (storedUser) user.value = JSON.parse(storedUser);

  const isAuthenticated = computed(() => !!token.value);

  async function login(credentials: LoginDto): Promise<void> {
    const response = await api.post<LoginResponse>('/users/login', credentials);
    token.value = response.data.access_token;
    user.value = response.data.user;
    localStorage.setItem('token', response.data.access_token);
    localStorage.setItem('user', JSON.stringify(response.data.user));
  }

  async function register(userData: CreateUserDto): Promise<User> {
    const response = await api.post<User>('/users/register', userData);
    return response.data;
  }

  function logout(): void {
    token.value = null;
    user.value = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }

  return {
    user,
    token,
    isAuthenticated,
    login,
    register,
    logout,
  };
});

