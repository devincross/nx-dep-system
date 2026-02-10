<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useUsersStore } from '../../stores/users';

const router = useRouter();
const route = useRoute();
const usersStore = useUsersStore();

const isEditing = computed(() => !!route.params.id);
const loading = ref(false);
const error = ref('');

const form = ref({
  name: '',
  email: '',
  password: '',
  status: 'active' as 'active' | 'inactive' | 'suspended',
});

const statusOptions = [
  { title: 'Active', value: 'active' },
  { title: 'Inactive', value: 'inactive' },
  { title: 'Suspended', value: 'suspended' },
];

onMounted(async () => {
  if (isEditing.value) {
    try {
      const user = await usersStore.fetchUser(route.params.id as string);
      form.value = {
        name: user.name,
        email: user.email,
        password: '',
        status: user.status,
      };
    } catch (err) {
      error.value = 'Failed to load user';
    }
  }
});

async function handleSubmit() {
  loading.value = true;
  error.value = '';
  try {
    if (isEditing.value) {
      const updateData: any = {
        name: form.value.name,
        email: form.value.email,
        status: form.value.status,
      };
      if (form.value.password) {
        updateData.password = form.value.password;
      }
      await usersStore.updateUser(route.params.id as string, updateData);
    } else {
      await usersStore.createUser(form.value);
    }
    router.push('/users');
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to save user';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div>
    <h1 class="text-h4 mb-6">{{ isEditing ? 'Edit User' : 'Create User' }}</h1>

    <v-card max-width="600">
      <v-card-text>
        <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = ''">
          {{ error }}
        </v-alert>
        <v-form @submit.prevent="handleSubmit">
          <v-text-field
            v-model="form.name"
            label="Name"
            required
            class="mb-4"
          ></v-text-field>
          <v-text-field
            v-model="form.email"
            label="Email"
            type="email"
            required
            class="mb-4"
          ></v-text-field>
          <v-text-field
            v-model="form.password"
            label="Password"
            type="password"
            :hint="isEditing ? 'Leave blank to keep current password' : ''"
            persistent-hint
            :required="!isEditing"
            class="mb-4"
          ></v-text-field>
          <v-select
            v-model="form.status"
            :items="statusOptions"
            label="Status"
            class="mb-4"
          ></v-select>
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-btn @click="router.push('/users')">Cancel</v-btn>
        <v-spacer></v-spacer>
        <v-btn color="primary" :loading="loading" @click="handleSubmit">
          {{ isEditing ? 'Update' : 'Create' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </div>
</template>

