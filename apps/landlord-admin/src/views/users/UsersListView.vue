<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useUsersStore } from '../../stores/users';
import type { User } from '../../types';

const usersStore = useUsersStore();
const deleteDialog = ref(false);
const userToDelete = ref<User | null>(null);

onMounted(() => {
  usersStore.fetchUsers();
});

function confirmDelete(user: User) {
  userToDelete.value = user;
  deleteDialog.value = true;
}

async function deleteUser() {
  if (userToDelete.value) {
    await usersStore.deleteUser(userToDelete.value.id);
    deleteDialog.value = false;
    userToDelete.value = null;
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case 'active': return 'success';
    case 'inactive': return 'grey';
    case 'suspended': return 'error';
    default: return 'grey';
  }
}
</script>

<template>
  <div>
    <div class="d-flex justify-space-between align-center mb-6">
      <h1 class="text-h4">Users</h1>
      <v-btn color="primary" to="/users/create" prepend-icon="mdi-plus">
        Add User
      </v-btn>
    </div>

    <v-card>
      <v-data-table
        :items="usersStore.users"
        :headers="[
          { title: 'Name', key: 'name' },
          { title: 'Email', key: 'email' },
          { title: 'Status', key: 'status' },
          { title: 'Created', key: 'createdAt' },
          { title: 'Actions', key: 'actions', sortable: false },
        ]"
        :loading="usersStore.loading"
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
          <v-btn icon size="small" :to="`/users/${item.id}/edit`">
            <v-icon>mdi-pencil</v-icon>
          </v-btn>
          <v-btn icon size="small" color="error" @click="confirmDelete(item)">
            <v-icon>mdi-delete</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </v-card>

    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>Confirm Delete</v-card-title>
        <v-card-text>
          Are you sure you want to delete user "{{ userToDelete?.name }}"?
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" @click="deleteUser">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

