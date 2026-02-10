<script setup lang="ts">
import { ref, computed } from 'vue';
import { RouterView, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const drawer = ref(true);
const router = useRouter();
const authStore = useAuthStore();

const isAuthenticated = computed(() => authStore.isAuthenticated);
const user = computed(() => authStore.user);

const menuItems = [
  { title: 'Dashboard', icon: 'mdi-view-dashboard', to: '/' },
  { title: 'Users', icon: 'mdi-account-group', to: '/users' },
  { title: 'Tenants', icon: 'mdi-domain', to: '/tenants' },
  { title: 'Domains', icon: 'mdi-web', to: '/domains' },
];

function logout() {
  authStore.logout();
  router.push('/login');
}
</script>

<template>
  <v-app>
    <!-- Show full layout only when authenticated -->
    <template v-if="isAuthenticated">
      <v-app-bar color="primary" prominent>
        <v-app-bar-nav-icon @click="drawer = !drawer"></v-app-bar-nav-icon>
        <v-toolbar-title>Landlord Admin</v-toolbar-title>
        <v-spacer></v-spacer>
        <v-menu>
          <template v-slot:activator="{ props }">
            <v-btn icon v-bind="props">
              <v-icon>mdi-account-circle</v-icon>
            </v-btn>
          </template>
          <v-list>
            <v-list-item>
              <v-list-item-title>{{ user?.name }}</v-list-item-title>
              <v-list-item-subtitle>{{ user?.email }}</v-list-item-subtitle>
            </v-list-item>
            <v-divider></v-divider>
            <v-list-item @click="logout">
              <template v-slot:prepend>
                <v-icon>mdi-logout</v-icon>
              </template>
              <v-list-item-title>Logout</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </v-app-bar>

      <v-navigation-drawer v-model="drawer" permanent>
        <v-list nav>
          <v-list-item
            v-for="item in menuItems"
            :key="item.title"
            :to="item.to"
            :prepend-icon="item.icon"
            :title="item.title"
          ></v-list-item>
        </v-list>
      </v-navigation-drawer>

      <v-main>
        <v-container fluid>
          <RouterView />
        </v-container>
      </v-main>
    </template>

    <!-- Show only router view for login/register pages -->
    <template v-else>
      <v-main>
        <RouterView />
      </v-main>
    </template>
  </v-app>
</template>

<style>
html, body {
  overflow-y: auto !important;
}
</style>
