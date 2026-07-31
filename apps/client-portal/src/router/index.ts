import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: { requiresAuth: false },
    },
    {
      path: '/',
      name: 'dashboard',
      component: () => import('../views/DashboardView.vue'),
      meta: { requiresAuth: true },
    },
    // Orders routes
    {
      path: '/orders',
      name: 'orders',
      component: () => import('../views/orders/OrdersListView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/orders/create',
      name: 'orders-create',
      component: () => import('../views/orders/OrderFormView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/orders/historical-import',
      name: 'orders-historical-import',
      component: () => import('../views/orders/HistoricalImportView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/orders/:id',
      name: 'orders-detail',
      component: () => import('../views/orders/OrderDetailView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/orders/:id/edit',
      name: 'orders-edit',
      component: () => import('../views/orders/OrderFormView.vue'),
      meta: { requiresAuth: true },
    },
    // Accounts routes
    {
      path: '/accounts',
      name: 'accounts',
      component: () => import('../views/accounts/AccountsListView.vue'),
      meta: { requiresAuth: true },
    },
    // Credentials routes (admin only)
    {
      path: '/credentials',
      name: 'credentials',
      component: () => import('../views/credentials/CredentialsListView.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/credentials/create',
      name: 'credentials-create',
      component: () => import('../views/credentials/CredentialFormView.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/credentials/:id/edit',
      name: 'credentials-edit',
      component: () => import('../views/credentials/CredentialFormView.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    // Zoho OAuth callback (admin only)
    {
      path: '/zoho/callback',
      name: 'zoho-callback',
      component: () => import('../views/ZohoCallbackView.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    // NetSuite route (admin only)
    {
      path: '/netsuite',
      name: 'netsuite',
      component: () => import('../views/NetsuiteView.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    // User management (admin only)
    {
      path: '/users',
      name: 'users',
      component: () => import('../views/users/UsersListView.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    // Own profile (any authenticated user)
    {
      path: '/profile',
      name: 'profile',
      component: () => import('../views/ProfileView.vue'),
      meta: { requiresAuth: true },
    },
  ],
});

// Navigation guard
router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem('token');
  const requiresAuth = to.meta.requiresAuth !== false;

  let isAdmin = false;
  try {
    const stored = localStorage.getItem('user');
    isAdmin = stored ? JSON.parse(stored).role === 'admin' : false;
  } catch { /* treat as non-admin */ }

  if (requiresAuth && !token) {
    next('/login');
  } else if (!requiresAuth && token && to.name === 'login') {
    next('/');
  } else if (to.meta.requiresAdmin && !isAdmin) {
    next('/');
  } else {
    next();
  }
});

export default router;

