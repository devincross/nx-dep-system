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
      path: '/register',
      name: 'register',
      component: () => import('../views/RegisterView.vue'),
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
    // Credentials routes
    {
      path: '/credentials',
      name: 'credentials',
      component: () => import('../views/credentials/CredentialsListView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/credentials/create',
      name: 'credentials-create',
      component: () => import('../views/credentials/CredentialFormView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/credentials/:id/edit',
      name: 'credentials-edit',
      component: () => import('../views/credentials/CredentialFormView.vue'),
      meta: { requiresAuth: true },
    },
    // NetSuite route
    {
      path: '/netsuite',
      name: 'netsuite',
      component: () => import('../views/NetsuiteView.vue'),
      meta: { requiresAuth: true },
    },
  ],
});

// Navigation guard
router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem('token');
  const requiresAuth = to.meta.requiresAuth !== false;

  if (requiresAuth && !token) {
    next('/login');
  } else if (!requiresAuth && token && (to.name === 'login' || to.name === 'register')) {
    next('/');
  } else {
    next();
  }
});

export default router;

