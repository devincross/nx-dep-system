<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useOrdersStore } from '../../stores/orders';
import type { OrderStatus, CreateOrderDto, UpdateOrderDto } from '../../types';

const route = useRoute();
const router = useRouter();
const ordersStore = useOrdersStore();

const isEdit = computed(() => !!route.params.id);
const orderIdParam = computed(() => (route.params.id ? Number(route.params.id) : null));

const loading = ref(false);
const error = ref('');

const orderStatuses: OrderStatus[] = ['waiting', 'pending', 'submitted', 'complete', 'error', 'changes'];

// Form fields
const orderId = ref('');
const accountId = ref<number>(0);
const externalOrderId = ref('');
const externalAccountId = ref('');
const externalOrderStatus = ref('');
const status = ref<OrderStatus>('waiting');
const po = ref('');
const changes = ref('');
const depOrderId = ref('');
const source = ref('');

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function loadOrder() {
  if (!orderIdParam.value) return;
  loading.value = true;
  error.value = '';
  try {
    const order = await ordersStore.fetchOne(orderIdParam.value);
    orderId.value = order.orderId;
    accountId.value = order.accountId;
    externalOrderId.value = order.externalOrderId || '';
    externalAccountId.value = order.externalAccountId || '';
    externalOrderStatus.value = order.externalOrderStatus || '';
    status.value = order.status;
    po.value = order.po || '';
    changes.value = order.changes || '';
    depOrderId.value = order.depOrderId || '';
    source.value = order.source || '';
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to load order';
  } finally {
    loading.value = false;
  }
}

async function handleSubmit() {
  loading.value = true;
  error.value = '';
  try {
    if (isEdit.value && orderIdParam.value) {
      const updateData: UpdateOrderDto = {
        externalOrderId: externalOrderId.value || undefined,
        externalAccountId: externalAccountId.value || undefined,
        externalOrderStatus: externalOrderStatus.value || undefined,
        status: status.value,
        po: po.value || undefined,
        changes: changes.value || undefined,
        depOrderId: depOrderId.value || undefined,
        source: source.value || undefined,
      };
      await ordersStore.update(orderIdParam.value, updateData);
    } else {
      const createData: CreateOrderDto = {
        orderId: orderId.value,
        accountId: accountId.value,
        externalOrderId: externalOrderId.value || undefined,
        externalAccountId: externalAccountId.value || undefined,
        externalOrderStatus: externalOrderStatus.value || undefined,
        status: status.value,
        po: po.value || undefined,
        changes: changes.value || undefined,
        depOrderId: depOrderId.value || undefined,
        source: source.value || undefined,
      };
      await ordersStore.create(createData);
    }
    router.push('/orders');
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to save order';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (isEdit.value) {
    loadOrder();
  } else {
    // Generate a new UUID for the order
    orderId.value = generateUUID();
  }
});
</script>

<template>
  <div>
    <h1 class="text-h4 mb-6">{{ isEdit ? 'Edit' : 'Create' }} Order</h1>

    <v-card>
      <v-card-text>
        <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = ''">
          {{ error }}
        </v-alert>

        <v-form @submit.prevent="handleSubmit">
          <v-row>
            <v-col cols="12" md="6">
              <v-text-field v-model="orderId" label="Order ID (UUID)" :disabled="isEdit" required hint="Auto-generated UUID"></v-text-field>
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field v-model.number="accountId" label="Account ID" type="number" :disabled="isEdit" required></v-text-field>
            </v-col>
            <v-col cols="12" md="6">
              <v-select v-model="status" :items="orderStatuses" label="Status" required></v-select>
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field v-model="po" label="PO (Purchase Order)"></v-text-field>
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field v-model="source" label="Source"></v-text-field>
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field v-model="depOrderId" label="DEP Order ID"></v-text-field>
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field v-model="externalOrderId" label="External Order ID"></v-text-field>
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field v-model="externalAccountId" label="External Account ID"></v-text-field>
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field v-model="externalOrderStatus" label="External Order Status"></v-text-field>
            </v-col>
            <v-col cols="12">
              <v-textarea v-model="changes" label="Changes" rows="3"></v-textarea>
            </v-col>
          </v-row>
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" to="/orders">Cancel</v-btn>
        <v-spacer></v-spacer>
        <v-btn color="primary" :loading="loading" @click="handleSubmit">{{ isEdit ? 'Update' : 'Create' }}</v-btn>
      </v-card-actions>
    </v-card>
  </div>
</template>

