<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useUsersStore } from '../stores/users';
import { useAuthStore } from '../stores/auth';

const usersStore = useUsersStore();
const authStore = useAuthStore();

const form = reactive({
  email: '',
  firstName: '',
  lastName: '',
  password: '',
  passwordConfirm: '',
});
const saving = ref(false);
const saved = ref(false);
const error = ref<string | null>(null);

onMounted(() => {
  const u = authStore.user;
  if (u) {
    form.email = u.email;
    form.firstName = u.firstName || '';
    form.lastName = u.lastName || '';
  }
});

async function save() {
  error.value = null;
  saved.value = false;

  if (form.password && form.password !== form.passwordConfirm) {
    error.value = 'Passwords do not match';
    return;
  }

  saving.value = true;
  try {
    const updated = await usersStore.updateMe({
      email: form.email,
      firstName: form.firstName || undefined,
      lastName: form.lastName || undefined,
      ...(form.password ? { password: form.password } : {}),
    });
    authStore.setUser(updated);
    form.password = '';
    form.passwordConfirm = '';
    saved.value = true;
  } catch {
    error.value = usersStore.error;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div>
    <h1 class="text-h4 mb-4">My Account</h1>

    <v-row>
      <v-col cols="12" md="6">
        <v-card>
          <v-card-text>
            <v-alert v-if="saved" type="success" variant="tonal" class="mb-3" density="compact" closable @click:close="saved = false">
              Your account has been updated.
            </v-alert>
            <v-alert v-if="error" type="error" variant="tonal" class="mb-3" density="compact">{{ error }}</v-alert>

            <v-text-field v-model="form.email" label="Email" type="email" class="mb-2"></v-text-field>
            <v-row dense>
              <v-col cols="6"><v-text-field v-model="form.firstName" label="First Name"></v-text-field></v-col>
              <v-col cols="6"><v-text-field v-model="form.lastName" label="Last Name"></v-text-field></v-col>
            </v-row>

            <v-divider class="my-3"></v-divider>
            <div class="text-subtitle-2 mb-2">Change Password</div>
            <v-text-field
              v-model="form.password"
              label="New Password"
              type="password"
              hint="Minimum 8 characters. Leave blank to keep your current password."
              persistent-hint
              class="mb-2"
            ></v-text-field>
            <v-text-field v-model="form.passwordConfirm" label="Confirm New Password" type="password"></v-text-field>
          </v-card-text>
          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn color="primary" :loading="saving" @click="save">Save Changes</v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>
