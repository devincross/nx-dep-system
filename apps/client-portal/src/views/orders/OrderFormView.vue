<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useOrdersStore } from '../../stores/orders';
import type { OrderStatus, CreateOrderDto, UpdateOrderDto, OrderItem } from '../../types';

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

// Devices
const serialNumbersInput = ref('');
const newItemsAreDep = ref(true);
const existingItems = ref<OrderItem[]>([]);
const itemsToRemove = ref<number[]>([]);

function parseSerialNumbers(input: string): string[] {
  return [...new Set(input.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
}

function toggleRemoveItem(itemId: number) {
  const idx = itemsToRemove.value.indexOf(itemId);
  if (idx >= 0) itemsToRemove.value.splice(idx, 1);
  else itemsToRemove.value.push(itemId);
}

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
    existingItems.value = order.items ?? [];
    itemsToRemove.value = [];
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
    const newSerials = parseSerialNumbers(serialNumbersInput.value);

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

      for (const itemId of itemsToRemove.value) {
        await ordersStore.removeOrderItem(orderIdParam.value, itemId);
      }
      for (const serialNumber of newSerials) {
        await ordersStore.addOrderItem(orderIdParam.value, {
          serialNumber,
          isDep: newItemsAreDep.value,
          depStatus: 'pending',
        });
      }
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
        items: newSerials.length > 0
          ? newSerials.map((serialNumber) => ({
              serialNumber,
              isDep: newItemsAreDep.value,
              depStatus: 'pending' as const,
            }))
          : undefined,
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

            <!-- Devices -->
            <v-col cols="12">
              <v-divider class="mb-3"></v-divider>
              <div class="text-subtitle-1 mb-2">Devices</div>

              <template v-if="isEdit && existingItems.length > 0">
                <div class="text-caption text-medium-emphasis mb-1">Current devices — click one to mark it for removal</div>
                <div class="mb-3">
                  <v-chip
                    v-for="item in existingItems"
                    :key="item.id"
                    class="mr-2 mb-2"
                    :color="itemsToRemove.includes(item.id) ? 'error' : (item.isDep ? 'primary' : undefined)"
                    :variant="itemsToRemove.includes(item.id) ? 'outlined' : 'tonal'"
                    :class="{ 'text-decoration-line-through': itemsToRemove.includes(item.id) }"
                    @click="toggleRemoveItem(item.id)"
                  >
                    {{ item.serialNumber }}
                  </v-chip>
                </div>
                <v-alert v-if="itemsToRemove.length > 0" type="warning" variant="tonal" density="compact" class="mb-3">
                  {{ itemsToRemove.length }} device{{ itemsToRemove.length !== 1 ? 's' : '' }} will be removed on update (DEP devices get returned from Apple).
                </v-alert>
              </template>

              <v-textarea
                v-model="serialNumbersInput"
                :label="isEdit ? 'Add Serial Numbers' : 'Serial Numbers'"
                rows="3"
                hint="One per line or comma-separated. A leading 'S' is stripped automatically."
                persistent-hint
              ></v-textarea>
              <v-checkbox v-model="newItemsAreDep" label="DEP devices" density="compact" hide-details></v-checkbox>
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

