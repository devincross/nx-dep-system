<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useUsersStore } from '../../stores/users';
import { useAuthStore } from '../../stores/auth';
import type { User, UserRole } from '../../types';

const usersStore = useUsersStore();
const authStore = useAuthStore();

const roleOptions: { title: string; value: UserRole }[] = [
  { title: 'Admin — full access', value: 'admin' },
  { title: 'User — no user/credential/ERP management', value: 'user' },
];

const headers = [
  { title: 'Name', key: 'name', sortable: false },
  { title: 'Email', key: 'email', sortable: true },
  { title: 'Role', key: 'role', sortable: true },
  { title: 'Active', key: 'isActive', sortable: true },
  { title: 'Last Login', key: 'lastLoginAt', sortable: true },
  { title: 'Actions', key: 'actions', sortable: false, width: 120 },
];

// Create/edit dialog
const dialog = ref(false);
const editingUser = ref<User | null>(null);
const form = reactive({
  email: '',
  firstName: '',
  lastName: '',
  password: '',
  role: 'user' as UserRole,
  isActive: true,
});
const formError = ref<string | null>(null);
const saving = ref(false);

// Delete dialog
const deleteDialog = ref(false);
const userToDelete = ref<User | null>(null);

function openCreate() {
  editingUser.value = null;
  Object.assign(form, { email: '', firstName: '', lastName: '', password: '', role: 'user', isActive: true });
  formError.value = null;
  dialog.value = true;
}

function openEdit(user: User) {
  editingUser.value = user;
  Object.assign(form, {
    email: user.email,
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    password: '',
    role: user.role,
    isActive: user.isActive,
  });
  formError.value = null;
  dialog.value = true;
}

async function save() {
  formError.value = null;
  saving.value = true;
  try {
    if (editingUser.value) {
      await usersStore.update(editingUser.value.id, {
        email: form.email,
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        role: form.role,
        isActive: form.isActive,
        ...(form.password ? { password: form.password } : {}),
      });
    } else {
      if (!form.password) {
        formError.value = 'Password is required for new users';
        return;
      }
      await usersStore.create({
        email: form.email,
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        role: form.role,
        password: form.password,
      });
    }
    dialog.value = false;
  } catch {
    formError.value = usersStore.error;
  } finally {
    saving.value = false;
  }
}

function confirmDelete(user: User) {
  userToDelete.value = user;
  deleteDialog.value = true;
}

async function handleDelete() {
  if (!userToDelete.value) return;
  try {
    await usersStore.remove(userToDelete.value.id);
  } catch { /* error shown via store */ }
  deleteDialog.value = false;
}

function isSelf(user: User): boolean {
  return user.id === authStore.user?.id;
}

onMounted(() => {
  usersStore.fetchAll();
});
</script>

<template>
  <div>
    <div class="d-flex justify-space-between align-center mb-4">
      <h1 class="text-h4">Users</h1>
      <v-btn color="primary" prepend-icon="mdi-account-plus" @click="openCreate">
        Add User
      </v-btn>
    </div>

    <v-alert
      v-if="usersStore.error"
      type="error"
      variant="tonal"
      class="mb-4"
      closable
      @click:close="usersStore.error = null"
    >
      {{ usersStore.error }}
    </v-alert>

    <v-card>
      <v-data-table :headers="headers" :items="usersStore.users" :loading="usersStore.loading" class="elevation-1">
        <template v-slot:item.name="{ item }">
          {{ [item.firstName, item.lastName].filter(Boolean).join(' ') || '--' }}
          <v-chip v-if="isSelf(item)" size="x-small" class="ml-1">you</v-chip>
        </template>
        <template v-slot:item.role="{ item }">
          <v-chip :color="item.role === 'admin' ? 'purple' : 'blue'" size="small">{{ item.role }}</v-chip>
        </template>
        <template v-slot:item.isActive="{ item }">
          <v-icon v-if="item.isActive" color="success" size="small">mdi-check-circle</v-icon>
          <v-icon v-else color="grey" size="small">mdi-close-circle</v-icon>
        </template>
        <template v-slot:item.lastLoginAt="{ item }">
          <span v-if="item.lastLoginAt">{{ new Date(item.lastLoginAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }}</span>
          <span v-else class="text-caption text-grey">never</span>
        </template>
        <template v-slot:item.actions="{ item }">
          <v-btn icon size="small" color="primary" @click="openEdit(item)"><v-icon>mdi-pencil</v-icon></v-btn>
          <v-btn icon size="small" color="error" :disabled="isSelf(item)" @click="confirmDelete(item)"><v-icon>mdi-delete</v-icon></v-btn>
        </template>
      </v-data-table>
    </v-card>

    <!-- Create/Edit Dialog -->
    <v-dialog v-model="dialog" max-width="520">
      <v-card>
        <v-card-title>{{ editingUser ? 'Edit User' : 'Add User' }}</v-card-title>
        <v-card-text>
          <v-alert v-if="formError" type="error" variant="tonal" class="mb-3" density="compact">{{ formError }}</v-alert>
          <v-text-field v-model="form.email" label="Email" type="email" class="mb-2"></v-text-field>
          <v-row dense>
            <v-col cols="6"><v-text-field v-model="form.firstName" label="First Name"></v-text-field></v-col>
            <v-col cols="6"><v-text-field v-model="form.lastName" label="Last Name"></v-text-field></v-col>
          </v-row>
          <v-select
            v-model="form.role"
            :items="roleOptions"
            label="Role"
            :disabled="editingUser ? isSelf(editingUser) : false"
            :hint="editingUser && isSelf(editingUser) ? 'You cannot change your own role' : ''"
            persistent-hint
            class="mb-2"
          ></v-select>
          <v-text-field
            v-model="form.password"
            :label="editingUser ? 'New Password (leave blank to keep current)' : 'Initial Password'"
            type="password"
            hint="Minimum 8 characters"
            persistent-hint
            class="mb-2"
          ></v-text-field>
          <v-switch
            v-if="editingUser"
            v-model="form.isActive"
            label="Active"
            color="success"
            :disabled="isSelf(editingUser)"
            hide-details
          ></v-switch>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="dialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="saving" @click="save">{{ editingUser ? 'Save' : 'Create' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete Dialog -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>Delete User</v-card-title>
        <v-card-text>
          Are you sure you want to delete <strong>{{ userToDelete?.email }}</strong>? They will no longer be able to log in.
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" @click="handleDelete">Delete User</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
