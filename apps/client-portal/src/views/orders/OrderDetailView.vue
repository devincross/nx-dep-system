<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useOrdersStore } from '../../stores/orders';
import api from '../../services/api';
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

// Apple DEP status
const depDetailsLoading = ref(false);
const depDetails = ref<any>(null);
const depDetailsError = ref('');
const depTransactions = ref<any[]>([]);
const depTransactionsLoading = ref(false);
const checkStatusLoading = ref(false);
const checkStatusResult = ref<any>(null);
const expandedTransactions = ref<number[]>([]);

const depStatuses: OrderItemDepStatus[] = ['pending', 'submitted', 'complete', 'error', 'changes'];

const itemHeaders = [
  { title: 'ID', key: 'id', sortable: true },
  { title: 'Serial Number', key: 'serialNumber', sortable: true },
  { title: 'Enrollment Status', key: 'depStatus', sortable: true },
  { title: 'Enrolled', key: 'isDep', sortable: true },
  { title: 'Apple Status', key: 'appleStatus', sortable: false },
  { title: 'Created', key: 'createdAt', sortable: true },
  { title: 'Actions', key: 'actions', sortable: false },
];

const transactionHeaders = [
  { title: 'Transaction ID', key: 'transactionId', sortable: true },
  { title: 'Type', key: 'orderType', sortable: true },
  { title: 'Status', key: 'status', sortable: true },
  { title: 'Apple Transaction ID', key: 'deviceEnrollmentTransactionId', sortable: false },
  { title: 'Error', key: 'errorMessage', sortable: false },
  { title: 'Date', key: 'createdAt', sortable: true },
  { title: '', key: 'expand', sortable: false, width: '50px' },
];

// Build a map of serial -> Apple DEP device data for comparison
const appleDeviceMap = computed(() => {
  const map = new Map<string, any>();
  if (!depDetails.value?.response?.orders) return map;
  for (const depOrder of depDetails.value.response.orders) {
    for (const delivery of depOrder.deliveries ?? []) {
      for (const device of delivery.devices ?? []) {
        map.set(device.deviceId, { ...device, orderType: depOrder.orderType, customerId: depOrder.customerId });
      }
    }
  }
  return map;
});

// Serials in Apple but not in our system
const serialsOnlyInApple = computed(() => {
  if (!order.value?.items) return [];
  const ourSerials = new Set(order.value.items.map((i) => i.serialNumber));
  return [...appleDeviceMap.value.keys()].filter((s) => !ourSerials.has(s));
});

// Serials in our system but not in Apple
const serialsOnlyInOurs = computed(() => {
  if (!order.value?.items) return [];
  return order.value.items
    .filter((i) => i.isDep && !i.deletedAt && !appleDeviceMap.value.has(i.serialNumber))
    .map((i) => i.serialNumber);
});

function getStatusColor(status: OrderStatus | OrderItemDepStatus): string {
  const colors: Record<string, string> = {
    waiting: 'grey', pending: 'orange', submitted: 'blue', complete: 'success', error: 'error', changes: 'purple',
  };
  return colors[status] || 'grey';
}

function getOrderTypeLabel(type: string): string {
  const labels: Record<string, string> = { OR: 'Enroll', RE: 'Return', VD: 'Void', OV: 'Override' };
  return labels[type] || type;
}

function getAppleStatusForItem(serialNumber: string): string | null {
  const device = appleDeviceMap.value.get(serialNumber);
  if (!device) return null;
  return device.status || device.enrollmentStatus || 'enrolled';
}

async function loadOrder() {
  loading.value = true;
  error.value = '';
  try {
    order.value = await ordersStore.fetchOne(orderId.value);
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Unable to load order.';
  } finally {
    loading.value = false;
  }
}

async function loadDepDetails() {
  depDetailsLoading.value = true;
  depDetailsError.value = '';
  depDetails.value = null;
  try {
    const response = await api.get(`/orders/${orderId.value}/dep/details`);
    depDetails.value = response.data;
  } catch (err: any) {
    depDetailsError.value = err.response?.data?.message || 'Unable to check enrollment status with Apple. Make sure DEP credentials are configured.';
  } finally {
    depDetailsLoading.value = false;
  }
}

async function loadDepTransactions() {
  depTransactionsLoading.value = true;
  try {
    const response = await api.get(`/orders/${orderId.value}/dep/status`);
    depTransactions.value = response.data.transactions ?? [];
  } catch {
    // Non-critical
  } finally {
    depTransactionsLoading.value = false;
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
    error.value = err.response?.data?.message || 'Unable to add item.';
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
    error.value = err.response?.data?.message || 'Unable to delete item.';
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
    error.value = err.response?.data?.message || 'Unable to restore item.';
  } finally {
    itemLoading.value = false;
  }
}

async function checkAndUpdateStatus() {
  checkStatusLoading.value = true;
  checkStatusResult.value = null;
  try {
    const response = await api.post(`/orders/${orderId.value}/dep/check-status`);
    checkStatusResult.value = response.data;
    // Reload order to reflect updated statuses
    await loadOrder();
    await loadDepTransactions();
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Unable to check DEP status.';
  } finally {
    checkStatusLoading.value = false;
  }
}

function toggleTransaction(id: number) {
  const idx = expandedTransactions.value.indexOf(id);
  if (idx >= 0) expandedTransactions.value.splice(idx, 1);
  else expandedTransactions.value.push(id);
}

function formatJson(raw: string | object): string {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return JSON.stringify(obj, null, 2);
  } catch { return String(raw); }
}

onMounted(() => {
  loadOrder();
  loadDepTransactions();
});
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

    <template v-if="order && !loading">
      <!-- Order Info + Apple Enrollment Side by Side -->
      <v-row>
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
                <v-list-item v-if="order.depOrderId"><v-list-item-title>Apple DEP Order ID</v-list-item-title><v-list-item-subtitle>{{ order.depOrderId }}</v-list-item-subtitle></v-list-item>
                <v-list-item><v-list-item-title>Created</v-list-item-title><v-list-item-subtitle>{{ new Date(order.createdAt).toLocaleString() }}</v-list-item-subtitle></v-list-item>
              </v-list>
            </v-card-text>
          </v-card>
        </v-col>

        <!-- Apple Enrollment Status Card -->
        <v-col cols="12" md="6">
          <v-card>
            <v-card-title class="d-flex justify-space-between align-center">
              <div><v-icon start>mdi-apple</v-icon> Apple Enrollment Status</div>
              <div>
                <v-btn size="small" variant="outlined" :loading="depDetailsLoading" @click="loadDepDetails" prepend-icon="mdi-refresh" class="mr-2">Query Apple</v-btn>
                <v-btn size="small" color="primary" :loading="checkStatusLoading" @click="checkAndUpdateStatus" prepend-icon="mdi-sync">Check &amp; Update Status</v-btn>
              </div>
            </v-card-title>
            <v-card-text>
              <v-alert v-if="checkStatusResult" :type="checkStatusResult.enrolledCount === checkStatusResult.depItemCount ? 'success' : 'info'" variant="tonal" density="compact" class="mb-3" closable @click:close="checkStatusResult = null">
                {{ checkStatusResult.enrolledCount }}/{{ checkStatusResult.depItemCount }} devices enrolled.
                Status: {{ checkStatusResult.previousStatus }} &rarr; {{ checkStatusResult.newStatus }}
              </v-alert>

              <v-progress-linear v-if="depDetailsLoading" indeterminate color="primary" class="mb-3"></v-progress-linear>

              <v-alert v-if="depDetailsError" type="warning" variant="tonal" density="compact" class="mb-3">
                {{ depDetailsError }}
              </v-alert>

              <template v-if="depDetails?.response?.orders?.length">
                <div v-for="depOrder in depDetails.response.orders" :key="depOrder.orderNumber" class="mb-3">
                  <v-list dense>
                    <v-list-item>
                      <v-list-item-title>Order Number</v-list-item-title>
                      <v-list-item-subtitle>{{ depOrder.orderNumber }}</v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item>
                      <v-list-item-title>Type</v-list-item-title>
                      <v-list-item-subtitle>{{ getOrderTypeLabel(depOrder.orderType) }} ({{ depOrder.orderType }})</v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item>
                      <v-list-item-title>Customer ID</v-list-item-title>
                      <v-list-item-subtitle>{{ depOrder.customerId }}</v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item>
                      <v-list-item-title>Apple Devices</v-list-item-title>
                      <v-list-item-subtitle>
                        <strong>{{ appleDeviceMap.size }}</strong> device{{ appleDeviceMap.size !== 1 ? 's' : '' }} enrolled
                      </v-list-item-subtitle>
                    </v-list-item>
                  </v-list>
                </div>

                <!-- Mismatch alerts -->
                <v-alert v-if="serialsOnlyInOurs.length > 0" type="warning" variant="tonal" density="compact" class="mb-2">
                  <strong>{{ serialsOnlyInOurs.length }} device{{ serialsOnlyInOurs.length !== 1 ? 's' : '' }} in our records but not in Apple:</strong>
                  <div class="text-caption mt-1">{{ serialsOnlyInOurs.join(', ') }}</div>
                </v-alert>
                <v-alert v-if="serialsOnlyInApple.length > 0" type="error" variant="tonal" density="compact" class="mb-2">
                  <strong>{{ serialsOnlyInApple.length }} device{{ serialsOnlyInApple.length !== 1 ? 's' : '' }} in Apple but not in our records:</strong>
                  <div class="text-caption mt-1">{{ serialsOnlyInApple.join(', ') }}</div>
                </v-alert>
                <v-alert v-if="serialsOnlyInOurs.length === 0 && serialsOnlyInApple.length === 0 && appleDeviceMap.size > 0" type="success" variant="tonal" density="compact">
                  All devices match between our records and Apple.
                </v-alert>
              </template>

              <template v-else-if="depDetails && !depDetailsLoading">
                <div class="text-center text-grey pa-4">
                  <v-icon size="36" color="grey">mdi-apple</v-icon>
                  <div class="mt-2">No enrollment data found at Apple for this order.</div>
                  <div class="text-caption mt-1">The order may not have been submitted yet, or the order number may not match.</div>
                </div>
              </template>

              <div v-if="!depDetails && !depDetailsLoading && !depDetailsError" class="text-center text-grey pa-4">
                <v-icon size="36" color="grey">mdi-apple</v-icon>
                <div class="mt-2">Click Refresh to check enrollment status with Apple.</div>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <!-- Order Items Table -->
      <v-row class="mt-4">
        <v-col cols="12">
          <v-card>
            <v-card-title class="d-flex justify-space-between align-center">
              Order Items ({{ order.items?.length || 0 }})
              <v-btn color="primary" size="small" @click="addItemDialog = true" prepend-icon="mdi-plus">Add Item</v-btn>
            </v-card-title>
            <v-card-text>
              <v-data-table :headers="itemHeaders" :items="order.items || []" :loading="itemLoading" density="compact">
                <template v-slot:item.serialNumber="{ item }">
                  <span
                    :class="{
                      'text-warning font-weight-bold': item.isDep && !item.deletedAt && !appleDeviceMap.has(item.serialNumber) && depDetails?.response?.orders?.length,
                    }"
                  >
                    {{ item.serialNumber }}
                    <v-icon
                      v-if="item.isDep && !item.deletedAt && !appleDeviceMap.has(item.serialNumber) && depDetails?.response?.orders?.length"
                      size="small" color="warning" class="ml-1"
                      title="Not found in Apple enrollment"
                    >mdi-alert</v-icon>
                  </span>
                </template>
                <template v-slot:item.depStatus="{ item }"><v-chip :color="getStatusColor(item.depStatus)" size="small">{{ item.depStatus }}</v-chip></template>
                <template v-slot:item.isDep="{ item }"><v-icon :color="item.isDep ? 'success' : 'grey'">{{ item.isDep ? 'mdi-check' : 'mdi-close' }}</v-icon></template>
                <template v-slot:item.appleStatus="{ item }">
                  <template v-if="depDetailsLoading">
                    <v-progress-circular size="16" width="2" indeterminate></v-progress-circular>
                  </template>
                  <template v-else-if="getAppleStatusForItem(item.serialNumber)">
                    <v-chip color="success" size="small">{{ getAppleStatusForItem(item.serialNumber) }}</v-chip>
                  </template>
                  <template v-else-if="depDetails?.response?.orders?.length && item.isDep && !item.deletedAt">
                    <v-chip color="warning" size="small">Not found</v-chip>
                  </template>
                  <template v-else>
                    <span class="text-grey">--</span>
                  </template>
                </template>
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

      <!-- Transaction History -->
      <v-row class="mt-4">
        <v-col cols="12">
          <v-card>
            <v-card-title class="d-flex justify-space-between align-center">
              Enrollment Transaction History
              <v-btn size="small" variant="outlined" :loading="depTransactionsLoading" @click="loadDepTransactions" prepend-icon="mdi-refresh">Refresh</v-btn>
            </v-card-title>
            <v-card-text>
              <v-data-table
                v-if="depTransactions.length > 0"
                :headers="transactionHeaders"
                :items="depTransactions"
                density="compact"
              >
                <template v-slot:item.orderType="{ item }">
                  <v-chip size="small" :color="item.orderType === 'OR' ? 'primary' : item.orderType === 'RE' ? 'warning' : 'grey'">
                    {{ getOrderTypeLabel(item.orderType) }}
                  </v-chip>
                </template>
                <template v-slot:item.status="{ item }">
                  <v-chip :color="getStatusColor(item.status)" size="small">{{ item.status }}</v-chip>
                </template>
                <template v-slot:item.deviceEnrollmentTransactionId="{ item }">
                  <span v-if="item.deviceEnrollmentTransactionId" class="text-caption">{{ item.deviceEnrollmentTransactionId }}</span>
                  <span v-else class="text-grey">--</span>
                </template>
                <template v-slot:item.errorMessage="{ item }">
                  <span v-if="item.errorMessage" class="text-error text-caption">{{ item.errorMessage }}</span>
                  <span v-else class="text-grey">--</span>
                </template>
                <template v-slot:item.createdAt="{ item }">{{ new Date(item.createdAt).toLocaleString() }}</template>
                <template v-slot:item.expand="{ item }">
                  <v-btn icon size="small" variant="text" @click="toggleTransaction(item.id)">
                    <v-icon>{{ expandedTransactions.includes(item.id) ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
                  </v-btn>
                </template>
                <template v-slot:item.data-table-expand></template>
                <template v-slot:bottom></template>
              </v-data-table>

              <!-- Expanded transaction details -->
              <template v-for="txn in depTransactions" :key="'detail-' + txn.id">
                <v-expand-transition>
                  <div v-if="expandedTransactions.includes(txn.id)" class="pa-4" style="background: #f5f5f5; border-top: 1px solid #e0e0e0;">
                    <v-row>
                      <v-col cols="12" md="6">
                        <div class="text-subtitle-2 mb-1">Request Payload</div>
                        <pre class="text-caption pa-2" style="background: #fff; border: 1px solid #e0e0e0; border-radius: 4px; max-height: 300px; overflow: auto; white-space: pre-wrap;">{{ txn.requestPayload ? formatJson(txn.requestPayload) : 'No request data' }}</pre>
                      </v-col>
                      <v-col cols="12" md="6">
                        <div class="text-subtitle-2 mb-1">Response Payload</div>
                        <pre class="text-caption pa-2" style="background: #fff; border: 1px solid #e0e0e0; border-radius: 4px; max-height: 300px; overflow: auto; white-space: pre-wrap;">{{ txn.responsePayload ? formatJson(txn.responsePayload) : 'No response data' }}</pre>
                      </v-col>
                    </v-row>
                  </div>
                </v-expand-transition>
              </template>
              <div v-else class="text-center text-grey pa-4">
                No enrollment transactions recorded for this order yet.
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </template>

    <!-- Add Item Dialog -->
    <v-dialog v-model="addItemDialog" max-width="500">
      <v-card>
        <v-card-title>Add Order Item</v-card-title>
        <v-card-text>
          <v-text-field v-model="newItemSerialNumber" label="Serial Number" required></v-text-field>
          <v-select v-model="newItemDepStatus" :items="depStatuses" label="Enrollment Status" required></v-select>
          <v-checkbox v-model="newItemIsDep" label="Eligible for Apple Enrollment"></v-checkbox>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="addItemDialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="itemLoading" @click="handleAddItem">Add</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete Item Dialog -->
    <v-dialog v-model="deleteItemDialog" max-width="400">
      <v-card>
        <v-card-title>Remove Item</v-card-title>
        <v-card-text>Are you sure you want to remove this item? It can be restored later if needed.</v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="deleteItemDialog = false">Cancel</v-btn>
          <v-btn color="error" :loading="itemLoading" @click="handleDeleteItem">Remove</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
