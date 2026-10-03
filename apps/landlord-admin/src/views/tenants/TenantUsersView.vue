<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useTenantsStore } from '../../stores/tenants';
import { useTenantUsersStore } from '../../stores/tenantUsers';
import type { Tenant, TenantUser, TenantUserRole } from '../../types';

const route = useRoute();
const tenantId = route.params.id as string;
const tenantsStore = useTenantsStore();
const usersStore = useTenantUsersStore();

const tenant = ref<Tenant | null>(null);
const error = ref('');
const snackbar = ref({ show: false, text: '', color: 'success' });

const headers = [
  { title: 'Name', key: 'name', sortable: false },
  { title: 'Email', key: 'email' },
  { title: 'Role', key: 'role' },
  { title: 'Status', key: 'isActive' },
  { title: 'Last Login', key: 'lastLoginAt' },
  { title: 'Actions', key: 'actions', sortable: false },
];

// ---- Add / edit dialog ----
const dialog = ref(false);
const saving = ref(false);
const dialogError = ref('');
const editing = ref<TenantUser | null>(null);
const form = ref({ email: '', firstName: '', lastName: '', role: 'user' as TenantUserRole, isActive: true, password: '' });

const isEdit = computed(() => !!editing.value);

function openCreate() {
  editing.value = null;
  form.value = { email: '', firstName: '', lastName: '', role: 'user', isActive: true, password: '' };
  dialogError.value = '';
  dialog.value = true;
}

function openEdit(user: TenantUser) {
  editing.value = user;
  form.value = {
    email: user.email,
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    role: user.role,
    isActive: user.isActive,
    password: '',
  };
  dialogError.value = '';
  dialog.value = true;
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(14));
  form.value.password = Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function copyPassword() {
  try {
    await navigator.clipboard.writeText(form.value.password);
    notify('Password copied to clipboard.');
  } catch {
    notify('Unable to copy — select the password and copy it manually.', 'warning');
  }
}

function notify(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

async function save() {
  dialogError.value = '';
  if (!form.value.email.trim()) { dialogError.value = 'Email is required.'; return; }
  if (!isEdit.value && form.value.password.length < 8) { dialogError.value = 'Password must be at least 8 characters.'; return; }
  if (isEdit.value && form.value.password && form.value.password.length < 8) { dialogError.value = 'New password must be at least 8 characters.'; return; }

  saving.value = true;
  try {
    const base = {
      email: form.value.email.trim(),
      firstName: form.value.firstName.trim() || undefined,
      lastName: form.value.lastName.trim() || undefined,
      role: form.value.role,
    };
    if (editing.value) {
      await usersStore.updateUser(tenantId, editing.value.id, {
        ...base,
        isActive: form.value.isActive,
        ...(form.value.password ? { password: form.value.password } : {}),
      });
      notify(form.value.password ? 'User updated and password reset.' : 'User updated.');
    } else {
      await usersStore.createUser(tenantId, { ...base, password: form.value.password });
      notify('User created. Share the password with them securely.');
    }
    dialog.value = false;
  } catch (err: any) {
    const msg = err.response?.data?.message;
    dialogError.value = (Array.isArray(msg) ? msg.join(', ') : msg) || 'Unable to save this user. Please try again.';
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    tenant.value = await tenantsStore.fetchTenant(tenantId);
    await usersStore.fetchUsers(tenantId);
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Unable to load this client\'s users.';
  }
});
</script>

<template>
  <div>
    <div class="d-flex justify-space-between align-center mb-6">
      <div>
        <h1 class="text-h4">Users</h1>
        <div v-if="tenant" class="text-subtitle-1 text-grey">{{ tenant.name }}</div>
      </div>
      <div>
        <v-btn variant="text" to="/tenants">Back to Clients</v-btn>
        <v-btn color="primary" prepend-icon="mdi-plus" class="ml-2" :disabled="!!error" @click="openCreate">Add User</v-btn>
      </div>
    </div>

    <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>

    <v-card>
      <v-data-table :headers="headers" :items="usersStore.users" :loading="usersStore.loading">
        <template v-slot:item.name="{ item }">{{ [item.firstName, item.lastName].filter(Boolean).join(' ') || '—' }}</template>
        <template v-slot:item.role="{ item }">
          <v-chip :color="item.role === 'admin' ? 'primary' : 'grey'" size="small">{{ item.role }}</v-chip>
        </template>
        <template v-slot:item.isActive="{ item }">
          <v-chip :color="item.isActive ? 'success' : 'grey'" size="small">{{ item.isActive ? 'Active' : 'Inactive' }}</v-chip>
        </template>
        <template v-slot:item.lastLoginAt="{ item }">{{ item.lastLoginAt ? new Date(item.lastLoginAt).toLocaleString() : 'Never' }}</template>
        <template v-slot:item.actions="{ item }">
          <v-btn icon size="small" title="Edit user" @click="openEdit(item)"><v-icon>mdi-pencil</v-icon></v-btn>
        </template>
        <template v-slot:no-data>No users yet. Add the first user so this client can sign in.</template>
      </v-data-table>
    </v-card>

    <v-dialog v-model="dialog" max-width="500" persistent>
      <v-card>
        <v-card-title>{{ isEdit ? 'Edit User' : 'Add User' }}</v-card-title>
        <v-card-text>
          <v-alert v-if="dialogError" type="error" density="compact" class="mb-4">{{ dialogError }}</v-alert>
          <v-text-field v-model="form.email" label="Email" type="email" autocomplete="off"></v-text-field>
          <v-row>
            <v-col cols="6"><v-text-field v-model="form.firstName" label="First name"></v-text-field></v-col>
            <v-col cols="6"><v-text-field v-model="form.lastName" label="Last name"></v-text-field></v-col>
          </v-row>
          <v-select v-model="form.role" :items="['user', 'admin']" label="Role" hint="Admins can manage this client's users and connections" persistent-hint class="mb-2"></v-select>
          <v-switch v-if="isEdit" v-model="form.isActive" label="Active (can sign in)" color="success" hide-details></v-switch>
          <v-text-field
            v-model="form.password"
            :label="isEdit ? 'Reset password (leave blank to keep)' : 'Password'"
            hint="At least 8 characters"
            persistent-hint
            autocomplete="new-password"
            class="mt-2"
          >
            <template v-slot:append-inner>
              <v-btn size="x-small" variant="text" @click="generatePassword">Generate</v-btn>
              <v-btn v-if="form.password" size="x-small" icon="mdi-content-copy" variant="text" title="Copy password" @click="copyPassword"></v-btn>
            </template>
          </v-text-field>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn :disabled="saving" @click="dialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="saving" @click="save">{{ isEdit ? 'Save' : 'Create' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="4000">{{ snackbar.text }}</v-snackbar>
  </div>
</template>
