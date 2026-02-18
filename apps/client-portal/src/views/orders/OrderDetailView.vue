<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useOrdersStore } from '../../stores/orders';
import type { Order, OrderItem, OrderStatus, OrderItemDepStatus, CreateOrderItemDto } from '../../types';

const route = useRoute();
const router = useRouter();
const ordersStore = useOrdersStore();

const orderId = computed(() => Number(route.params.id));
const order = ref<Order | null>(null);
const loading = ref(true);
const error = ref('');

// Add item dialog
const addItemDialog = ref(false);
const newItemSerialNumber = ref('');
const newItemDepStatus = ref<OrderItemDepStatus>('pending');
const newItemIsDep = ref(false);
const itemLoading = ref(false);

// Delete item dialog
const deleteItemDialog = ref(false);
const itemToDelete = ref<OrderItem | null>(null);

const depStatuses: OrderItemDepStatus[] = ['pending', 'submitted', 'complete', 'error', 'changes'];

const itemHeaders = [
  { title: 'ID', key: 'id', sortable: true },
  { title: 'Serial Number', key: 'serialNumber', sortable: true },
  { title: 'DEP Status', key: 'depStatus', sortable: true },
  { title: 'Is DEP', key: 'isDep', sortable: true },
  { title: 'Created', key: 'createdAt', sortable: true },
  { title: 'Actions', key: 'actions', sortable: false },
];

function getStatusColor(status: OrderStatus | OrderItemDepStatus): string {
  const colors: Record<string, string> = {
    waiting: 'grey', pending: 'orange', submitted: 'blue', complete: 'success', error: 'error', changes: 'purple',
  };
  return colors[status] || 'grey';
}

async function loadOrder() {
  loading.value = true;
  error.value = '';
  try {
    order.value = await ordersStore.fetchOne(orderId.value);
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to load order';
  } finally {
    loading.value = false;
  }
}

async function handleAddItem() {
  if (!order.value) return;
  itemLoading.value = true;
  try {
    const itemData: CreateOrderItemDto = {
      serialNumber: newItemSerialNumber.value,
      depStatus: newItemDepStatus.value,
      isDep: newItemIsDep.value,
    };
    await ordersStore.addOrderItem(order.value.id, itemData);
    await loadOrder();
    addItemDialog.value = false;
    newItemSerialNumber.value = '';
    newItemDepStatus.value = 'pending';
    newItemIsDep.value = false;
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to add item';
  } finally {
    itemLoading.value = false;
  }
}

function confirmDeleteItem(item: OrderItem) {
  itemToDelete.value = item;
  deleteItemDialog.value = true;
}

async function handleDeleteItem() {
  if (!order.value || !itemToDelete.value) return;
  itemLoading.value = true;
  try {
    await ordersStore.removeOrderItem(order.value.id, itemToDelete.value.id);
    await loadOrder();
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to delete item';
  } finally {
    itemLoading.value = false;
    deleteItemDialog.value = false;
  }
}

async function handleRestoreItem(item: OrderItem) {
  if (!order.value) return;
  itemLoading.value = true;
  try {
    await ordersStore.restoreOrderItem(order.value.id, item.id);
    await loadOrder();
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to restore item';
  } finally {
    itemLoading.value = false;
  }
}

onMounted(() => { loadOrder(); });
</script>

<template>
  <div>
    <div class="d-flex justify-space-between align-center mb-4">
      <h1 class="text-h4">Order Details</h1>
      <div>
        <v-btn variant="text" @click="router.push('/orders')">Back to Orders</v-btn>
        <v-btn color="primary" :to="`/orders/${orderId}/edit`" class="ml-2">Edit Order</v-btn>
      </div>
    </div>
    <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = ''">{{ error }}</v-alert>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4"></v-progress-linear>
    <v-row v-if="order && !loading">
      <v-col cols="12" md="6">
        <v-card>
          <v-card-title>Order Information</v-card-title>
          <v-card-text>
            <v-list dense>
              <v-list-item><v-list-item-title>Order ID</v-list-item-title><v-list-item-subtitle>{{ order.orderId }}</v-list-item-subtitle></v-list-item>
              <v-list-item><v-list-item-title>Account ID</v-list-item-title><v-list-item-subtitle>{{ order.accountId }}</v-list-item-subtitle></v-list-item>
              <v-list-item><v-list-item-title>Status</v-list-item-title><v-list-item-subtitle><v-chip :color="getStatusColor(order.status)" size="small">{{ order.status }}</v-chip></v-list-item-subtitle></v-list-item>
              <v-list-item v-if="order.po"><v-list-item-title>PO</v-list-item-title><v-list-item-subtitle>{{ order.po }}</v-list-item-subtitle></v-list-item>
              <v-list-item v-if="order.source"><v-list-item-title>Source</v-list-item-title><v-list-item-subtitle>{{ order.source }}</v-list-item-subtitle></v-list-item>
              <v-list-item v-if="order.externalOrderId"><v-list-item-title>External Order ID</v-list-item-title><v-list-item-subtitle>{{ order.externalOrderId }}</v-list-item-subtitle></v-list-item>
              <v-list-item><v-list-item-title>Created</v-list-item-title><v-list-item-subtitle>{{ new Date(order.createdAt).toLocaleString() }}</v-list-item-subtitle></v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="6">
        <v-card>
          <v-card-title class="d-flex justify-space-between align-center">Order Items<v-btn color="primary" size="small" @click="addItemDialog = true" prepend-icon="mdi-plus">Add Item</v-btn></v-card-title>
          <v-card-text>
            <v-data-table :headers="itemHeaders" :items="order.items || []" :loading="itemLoading" density="compact">
              <template v-slot:item.depStatus="{ item }"><v-chip :color="getStatusColor(item.depStatus)" size="small">{{ item.depStatus }}</v-chip></template>
              <template v-slot:item.isDep="{ item }"><v-icon :color="item.isDep ? 'success' : 'grey'">{{ item.isDep ? 'mdi-check' : 'mdi-close' }}</v-icon></template>
              <template v-slot:item.createdAt="{ item }">{{ new Date(item.createdAt).toLocaleDateString() }}</template>
              <template v-slot:item.actions="{ item }">
                <v-btn v-if="item.deletedAt" icon size="small" @click="handleRestoreItem(item)" color="success"><v-icon>mdi-restore</v-icon></v-btn>
                <v-btn v-else icon size="small" @click="confirmDeleteItem(item)" color="error"><v-icon>mdi-delete</v-icon></v-btn>
              </template>
            </v-data-table>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
    <!-- Add Item Dialog -->
    <v-dialog v-model="addItemDialog" max-width="500">
      <v-card><v-card-title>Add Order Item</v-card-title><v-card-text><v-text-field v-model="newItemSerialNumber" label="Serial Number" required></v-text-field><v-select v-model="newItemDepStatus" :items="depStatuses" label="DEP Status" required></v-select><v-checkbox v-model="newItemIsDep" label="Is DEP"></v-checkbox></v-card-text><v-card-actions><v-spacer></v-spacer><v-btn variant="text" @click="addItemDialog = false">Cancel</v-btn><v-btn color="primary" :loading="itemLoading" @click="handleAddItem">Add</v-btn></v-card-actions></v-card>
    </v-dialog>
    <!-- Delete Item Dialog -->
    <v-dialog v-model="deleteItemDialog" max-width="400"><v-card><v-card-title>Delete Item</v-card-title><v-card-text>Are you sure you want to delete this item?</v-card-text><v-card-actions><v-spacer></v-spacer><v-btn variant="text" @click="deleteItemDialog = false">Cancel</v-btn><v-btn color="error" :loading="itemLoading" @click="handleDeleteItem">Delete</v-btn></v-card-actions></v-card></v-dialog>
  </div>
</template>

