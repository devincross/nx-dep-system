import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../services/api';
import type {
  Order,
  OrderItem,
  CreateOrderDto,
  UpdateOrderDto,
  CreateOrderItemDto,
  UpdateOrderItemDto,
} from '../types';

export const useOrdersStore = defineStore('orders', () => {
  const orders = ref<Order[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchAll(): Promise<Order[]> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<Order[]>('/orders');
      orders.value = response.data;
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to fetch orders';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function fetchByAccountId(accountId: number): Promise<Order[]> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<Order[]>(`/orders/account/${accountId}`);
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to fetch orders';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function fetchOne(id: number): Promise<Order> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<Order>(`/orders/${id}`);
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to fetch order';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function create(data: CreateOrderDto): Promise<Order> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post<Order>('/orders', data);
      orders.value.push(response.data);
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to create order';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function update(id: number, data: UpdateOrderDto): Promise<Order> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.put<Order>(`/orders/${id}`, data);
      const index = orders.value.findIndex((o) => o.id === id);
      if (index !== -1) {
        orders.value[index] = response.data;
      }
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to update order';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function remove(id: number): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      await api.delete(`/orders/${id}`);
      orders.value = orders.value.filter((o) => o.id !== id);
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to delete order';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  // Order Items
  async function addOrderItem(orderId: number, data: CreateOrderItemDto): Promise<OrderItem> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post<OrderItem>(`/orders/${orderId}/items`, data);
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to add order item';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function updateOrderItem(
    orderId: number,
    itemId: number,
    data: UpdateOrderItemDto
  ): Promise<OrderItem> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.put<OrderItem>(`/orders/${orderId}/items/${itemId}`, data);
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to update order item';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function removeOrderItem(orderId: number, itemId: number): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      await api.delete(`/orders/${orderId}/items/${itemId}`);
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to delete order item';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function restoreOrderItem(orderId: number, itemId: number): Promise<OrderItem> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post<OrderItem>(`/orders/${orderId}/items/${itemId}/restore`);
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.message || 'Failed to restore order item';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return {
    orders,
    loading,
    error,
    fetchAll,
    fetchByAccountId,
    fetchOne,
    create,
    update,
    remove,
    addOrderItem,
    updateOrderItem,
    removeOrderItem,
    restoreOrderItem,
  };
});

