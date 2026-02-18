<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useOrdersStore } from '../../stores/orders';
import type { Order, OrderStatus } from '../../types';

const ordersStore = useOrdersStore();
const search = ref('');
const statusFilter = ref<OrderStatus | ''>('');
const deleteDialog = ref(false);
const orderToDelete = ref<Order | null>(null);

const orderStatuses: OrderStatus[] = ['waiting', 'pending', 'submitted', 'complete', 'error', 'changes'];

const headers = [
  { title: 'ID', key: 'id', sortable: true },
  { title: 'Order ID', key: 'orderId', sortable: true },
  { title: 'Account ID', key: 'accountId', sortable: true },
  { title: 'Status', key: 'status', sortable: true },
  { title: 'PO', key: 'po', sortable: true },
  { title: 'Source', key: 'source', sortable: true },
  { title: 'Created', key: 'createdAt', sortable: true },
  { title: 'Actions', key: 'actions', sortable: false },
];

const filteredOrders = computed(() => {
  let result = ordersStore.orders;
  if (statusFilter.value) {
    result = result.filter((o) => o.status === statusFilter.value);
  }
  if (search.value) {
    const searchLower = search.value.toLowerCase();
    result = result.filter(
      (o) =>
        o.orderId.toLowerCase().includes(searchLower) ||
        o.po?.toLowerCase().includes(searchLower) ||
        o.source?.toLowerCase().includes(searchLower)
    );
  }
  return result;
});

function getStatusColor(status: OrderStatus): string {
  const colors: Record<OrderStatus, string> = {
    waiting: 'grey',
    pending: 'orange',
    submitted: 'blue',
    complete: 'success',
    error: 'error',
    changes: 'purple',
  };
  return colors[status] || 'grey';
}

function confirmDelete(order: Order) {
  orderToDelete.value = order;
  deleteDialog.value = true;
}

async function handleDelete() {
  if (!orderToDelete.value) return;
  try {
    await ordersStore.remove(orderToDelete.value.id);
    await ordersStore.fetchAll();
  } catch (err) {
    console.error('Delete failed:', err);
  }
  deleteDialog.value = false;
}

onMounted(() => {
  ordersStore.fetchAll();
});
</script>

<template>
  <div>
    <div class="d-flex justify-space-between align-center mb-4">
      <h1 class="text-h4">Orders</h1>
      <v-btn color="primary" to="/orders/create" prepend-icon="mdi-plus">
        Create Order
      </v-btn>
    </div>

    <v-card>
      <v-card-title>
        <v-row>
          <v-col cols="12" sm="4">
            <v-text-field
              v-model="search"
              prepend-icon="mdi-magnify"
              label="Search"
              single-line
              hide-details
              clearable
            ></v-text-field>
          </v-col>
          <v-col cols="12" sm="4">
            <v-select
              v-model="statusFilter"
              :items="[{ title: 'All Statuses', value: '' }, ...orderStatuses.map(s => ({ title: s.toUpperCase(), value: s }))]"
              label="Filter by Status"
              hide-details
              clearable
            ></v-select>
          </v-col>
        </v-row>
      </v-card-title>
      <v-data-table
        :headers="headers"
        :items="filteredOrders"
        :loading="ordersStore.loading"
        class="elevation-1"
      >
        <template v-slot:item.status="{ item }">
          <v-chip :color="getStatusColor(item.status)" size="small">
            {{ item.status }}
          </v-chip>
        </template>
        <template v-slot:item.createdAt="{ item }">
          {{ new Date(item.createdAt).toLocaleDateString() }}
        </template>
        <template v-slot:item.actions="{ item }">
          <v-btn icon size="small" :to="`/orders/${item.id}`" color="info">
            <v-icon>mdi-eye</v-icon>
          </v-btn>
          <v-btn icon size="small" :to="`/orders/${item.id}/edit`" color="primary">
            <v-icon>mdi-pencil</v-icon>
          </v-btn>
          <v-btn icon size="small" @click="confirmDelete(item)" color="error">
            <v-icon>mdi-delete</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </v-card>

    <!-- Delete Confirmation Dialog -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>Delete Order</v-card-title>
        <v-card-text>Are you sure you want to delete this order?</v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" @click="handleDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

