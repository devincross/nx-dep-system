<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useOrdersStore } from '../../stores/orders';
import api from '../../services/api';
import type { Order, OrderStatus } from '../../types';

const ordersStore = useOrdersStore();
const search = ref('');
const statusFilter = ref<OrderStatus | ''>('');
const deleteDialog = ref(false);
const orderToDelete = ref<Order | null>(null);

// DEP action state
const depActionLoading = ref<number | null>(null);
const depActionResult = ref<{ orderId: number; action: string; success: boolean; message: string } | null>(null);
const depDialog = ref(false);
const depDialogOrder = ref<Order | null>(null);
const depReturnSerials = ref('');

// Reconciliation state
const reconciling = ref(false);
const reconcileResults = ref<any[] | null>(null);
const reconcileDialog = ref(false);
const selectedOrders = ref<number[]>([]);

const orderStatuses: OrderStatus[] = ['waiting', 'pending', 'submitted', 'complete', 'error', 'changes'];

const headers = [
  { title: 'ID', key: 'id', sortable: true },
  { title: 'Order ID', key: 'orderId', sortable: true },
  { title: 'Ext Order', key: 'externalOrderId', sortable: true },
  { title: 'Status', key: 'status', sortable: true },
  { title: 'PO', key: 'po', sortable: true },
  { title: 'Source', key: 'source', sortable: true },
  { title: 'DEP', key: 'depOrderId', sortable: true },
  { title: 'Actions', key: 'actions', sortable: false, width: 280 },
];

const filteredOrders = computed(() => {
  let result = ordersStore.orders;
  if (statusFilter.value) {
    result = result.filter((o) => o.status === statusFilter.value);
  }
  if (search.value) {
    const s = search.value.toLowerCase();
    result = result.filter(
      (o) =>
        o.orderId.toLowerCase().includes(s) ||
        o.externalOrderId?.toLowerCase().includes(s) ||
        o.depOrderId?.toLowerCase().includes(s) ||
        o.po?.toLowerCase().includes(s) ||
        o.source?.toLowerCase().includes(s)
    );
  }
  return result;
});

function getStatusColor(status: OrderStatus): string {
  const colors: Record<OrderStatus, string> = {
    waiting: 'grey', pending: 'orange', submitted: 'blue',
    complete: 'success', error: 'error', changes: 'purple',
  };
  return colors[status] || 'grey';
}

// ---- DEP Actions ----

async function depAction(order: Order, action: 'enroll' | 'void' | 'override') {
  depActionLoading.value = order.id;
  depActionResult.value = null;
  try {
    const response = await api.post(`/orders/${order.id}/dep/${action}`);
    depActionResult.value = {
      orderId: order.id,
      action: action.toUpperCase(),
      success: true,
      message: `Successfully submitted. Reference: ${response.data.transactionId}`,
    };
  } catch (err: any) {
    depActionResult.value = {
      orderId: order.id,
      action: action.toUpperCase(),
      success: false,
      message: err.response?.data?.message || err.message,
    };
  } finally {
    depActionLoading.value = null;
  }
}

function openReturnDialog(order: Order) {
  depDialogOrder.value = order;
  depReturnSerials.value = '';
  depDialog.value = true;
}

async function submitReturn() {
  if (!depDialogOrder.value) return;
  depActionLoading.value = depDialogOrder.value.id;
  depActionResult.value = null;
  depDialog.value = false;

  const serialNumbers = depReturnSerials.value
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const response = await api.post(`/orders/${depDialogOrder.value.id}/dep/return`, {
      serialNumbers: serialNumbers.length > 0 ? serialNumbers : undefined,
    });
    depActionResult.value = {
      orderId: depDialogOrder.value.id,
      action: 'RETURN',
      success: true,
      message: `Return successfully submitted. Reference: ${response.data.transactionId}`,
    };
  } catch (err: any) {
    depActionResult.value = {
      orderId: depDialogOrder.value.id,
      action: 'RETURN',
      success: false,
      message: err.response?.data?.message || err.message,
    };
  } finally {
    depActionLoading.value = null;
  }
}

// ---- Reconciliation ----

async function runReconcile() {
  reconciling.value = true;
  reconcileResults.value = null;
  reconcileDialog.value = true;

  try {
    const ids = selectedOrders.value.length > 0
      ? selectedOrders.value
      : filteredOrders.value.slice(0, 50).map((o) => o.id);

    const response = await api.post('/orders/dep/reconcile', { orderIds: ids });
    reconcileResults.value = response.data.comparisons;
  } catch (err: any) {
    reconcileResults.value = [];
  } finally {
    reconciling.value = false;
  }
}

// ---- Delete ----

function confirmDelete(order: Order) {
  orderToDelete.value = order;
  deleteDialog.value = true;
}

async function handleDelete() {
  if (!orderToDelete.value) return;
  try {
    await ordersStore.remove(orderToDelete.value.id);
    await ordersStore.fetchAll();
  } catch (err) { /* */ }
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
      <div class="d-flex ga-2">
        <v-btn
          color="warning"
          variant="outlined"
          prepend-icon="mdi-compare-horizontal"
          :loading="reconciling"
          @click="runReconcile"
        >
          Reconcile{{ selectedOrders.length > 0 ? ` (${selectedOrders.length})` : '' }}
        </v-btn>
        <v-btn color="info" variant="outlined" to="/orders/historical-import" prepend-icon="mdi-database-import">
          Historical Import
        </v-btn>
        <v-btn color="primary" to="/orders/create" prepend-icon="mdi-plus">
          Create Order
        </v-btn>
      </div>
    </div>

    <!-- DEP action result alert -->
    <v-alert
      v-if="depActionResult"
      :type="depActionResult.success ? 'success' : 'error'"
      variant="tonal"
      class="mb-4"
      closable
      @click:close="depActionResult = null"
    >
      <strong>{{ depActionResult.action }}</strong> (Order #{{ depActionResult.orderId }}): {{ depActionResult.message }}
    </v-alert>

    <v-card>
      <v-card-title>
        <v-row>
          <v-col cols="12" sm="4">
            <v-text-field v-model="search" prepend-icon="mdi-magnify" label="Search" single-line hide-details clearable></v-text-field>
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
      <v-data-table :headers="headers" :items="filteredOrders" :loading="ordersStore.loading" class="elevation-1" show-select v-model="selectedOrders" item-value="id">
        <template v-slot:item.status="{ item }">
          <v-chip :color="getStatusColor(item.status)" size="small">{{ item.status }}</v-chip>
        </template>
        <template v-slot:item.depOrderId="{ item }">
          <span v-if="item.depOrderId" class="text-caption">{{ item.depOrderId }}</span>
          <span v-else class="text-caption text-grey">--</span>
        </template>
        <template v-slot:item.createdAt="{ item }">
          {{ new Date(item.createdAt).toLocaleDateString() }}
        </template>
        <template v-slot:item.actions="{ item }">
          <v-btn icon size="small" :to="`/orders/${item.id}`" color="info"><v-icon>mdi-eye</v-icon></v-btn>
          <v-btn icon size="small" :to="`/orders/${item.id}/edit`" color="primary"><v-icon>mdi-pencil</v-icon></v-btn>

          <!-- DEP Actions Menu -->
          <v-menu>
            <template v-slot:activator="{ props }">
              <v-btn icon size="small" color="teal" v-bind="props" :loading="depActionLoading === item.id">
                <v-icon>mdi-apple</v-icon>
              </v-btn>
            </template>
            <v-list density="compact">
              <v-list-subheader>Apple Enrollment Actions</v-list-subheader>
              <v-list-item @click="depAction(item, 'enroll')" prepend-icon="mdi-plus-circle">
                <v-list-item-title>Enroll Devices</v-list-item-title>
              </v-list-item>
              <v-list-item @click="openReturnDialog(item)" prepend-icon="mdi-undo">
                <v-list-item-title>Return Devices</v-list-item-title>
              </v-list-item>
              <v-list-item @click="depAction(item, 'override')" prepend-icon="mdi-swap-horizontal">
                <v-list-item-title>Override Enrollment</v-list-item-title>
              </v-list-item>
              <v-list-item @click="depAction(item, 'void')" prepend-icon="mdi-cancel">
                <v-list-item-title>Void Order</v-list-item-title>
              </v-list-item>
              <v-divider></v-divider>
              <v-list-item :to="`/orders/${item.id}`" prepend-icon="mdi-information">
                <v-list-item-title>View Enrollment Status</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>

          <v-btn icon size="small" @click="confirmDelete(item)" color="error"><v-icon>mdi-delete</v-icon></v-btn>
        </template>
      </v-data-table>
    </v-card>

    <!-- Return Dialog -->
    <v-dialog v-model="depDialog" max-width="500">
      <v-card>
        <v-card-title>Return Devices</v-card-title>
        <v-card-text>
          <div class="text-body-2 mb-3">
            Enter the serial numbers of the devices you want to return from Apple Device Enrollment. Leave blank to return all enrolled devices on this order. Returned devices will no longer be managed through Apple enrollment.
          </div>
          <v-textarea
            v-model="depReturnSerials"
            label="Serial Numbers"
            hint="One per line, or comma-separated"
            persistent-hint
            rows="4"
          ></v-textarea>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="depDialog = false">Cancel</v-btn>
          <v-btn color="warning" @click="submitReturn">Submit Return</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete Dialog -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>Delete Order</v-card-title>
        <v-card-text>Are you sure you want to delete this order? This will remove it from the system. Any devices already enrolled with Apple will not be affected.</v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" @click="handleDelete">Delete Order</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Reconciliation Dialog -->
    <v-dialog v-model="reconcileDialog" max-width="900" persistent>
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon start>mdi-compare-horizontal</v-icon>
          Device Comparison — Our Records vs Apple Enrollment
        </v-card-title>
        <v-card-text>
          <div v-if="reconciling" class="text-center py-6">
            <v-progress-circular indeterminate color="primary" size="48" class="mb-4"></v-progress-circular>
            <div>Comparing your order data with Apple's enrollment records...</div>
          </div>

          <template v-if="reconcileResults">
            <v-table density="compact" class="mb-4">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Match</th>
                  <th>Our Devices</th>
                  <th>Apple Devices</th>
                  <th>Only in Our Records</th>
                  <th>Only in Apple</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in reconcileResults" :key="c.orderId">
                  <td>
                    <div class="font-weight-medium">{{ c.orderNumber }}</div>
                    <div class="text-caption text-grey">ID: {{ c.orderId }} | {{ c.source }}</div>
                  </td>
                  <td>
                    <v-icon v-if="c.differences.match" color="success" size="small">mdi-check-circle</v-icon>
                    <v-icon v-else-if="c.dep === null" color="grey" size="small">mdi-help-circle</v-icon>
                    <v-icon v-else color="warning" size="small">mdi-alert-circle</v-icon>
                  </td>
                  <td>{{ c.our.deviceCount }}</td>
                  <td>{{ c.dep ? c.dep.deviceCount : 'N/A' }}</td>
                  <td>
                    <span v-if="c.differences.inOursNotDep.length === 0" class="text-grey">--</span>
                    <v-chip v-else size="x-small" color="warning">{{ c.differences.inOursNotDep.length }}</v-chip>
                  </td>
                  <td>
                    <span v-if="c.differences.inDepNotOurs.length === 0" class="text-grey">--</span>
                    <v-chip v-else size="x-small" color="error">{{ c.differences.inDepNotOurs.length }}</v-chip>
                  </td>
                </tr>
              </tbody>
            </v-table>

            <!-- Expandable detail for mismatches -->
            <template v-for="c in reconcileResults.filter(r => !r.differences.match)" :key="'detail-' + c.orderId">
              <v-card variant="outlined" class="mb-3">
                <v-card-title class="text-subtitle-2 py-2 px-4 bg-orange-lighten-5">
                  {{ c.orderNumber }} — Mismatch Details
                </v-card-title>
                <v-card-text class="pa-3">
                  <v-row>
                    <v-col cols="6">
                      <div class="text-caption font-weight-bold mb-1">Our Records ({{ c.our.deviceCount }} devices)</div>
                      <div v-for="s in c.our.devices" :key="s" class="text-caption" :class="c.differences.inOursNotDep.includes(s) ? 'text-warning font-weight-bold' : ''">
                        {{ s }} {{ c.differences.inOursNotDep.includes(s) ? '(not in Apple)' : '' }}
                      </div>
                      <div v-if="c.our.devices.length === 0" class="text-caption text-grey">No devices</div>
                    </v-col>
                    <v-col cols="6">
                      <div class="text-caption font-weight-bold mb-1">Apple Enrollment ({{ c.dep ? c.dep.deviceCount : 0 }} devices)</div>
                      <template v-if="c.dep">
                        <div v-for="s in c.dep.devices" :key="s" class="text-caption" :class="c.differences.inDepNotOurs.includes(s) ? 'text-error font-weight-bold' : ''">
                          {{ s }} {{ c.differences.inDepNotOurs.includes(s) ? '(not in our records)' : '' }}
                        </div>
                      </template>
                      <div v-else class="text-caption text-grey">Not found in Apple Enrollment</div>
                    </v-col>
                  </v-row>
                </v-card-text>
              </v-card>
            </template>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn :disabled="reconciling" @click="reconcileDialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
