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
    {
      path: '/users',
      name: 'users',
      component: () => import('../views/users/UsersListView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/users/create',
      name: 'users-create',
      component: () => import('../views/users/UserFormView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/users/:id/edit',
      name: 'users-edit',
      component: () => import('../views/users/UserFormView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/tenants',
      name: 'tenants',
      component: () => import('../views/tenants/TenantsListView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/tenants/create',
      name: 'tenants-create',
      component: () => import('../views/tenants/TenantFormView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/tenants/:id/edit',
      name: 'tenants-edit',
      component: () => import('../views/tenants/TenantFormView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/domains',
      name: 'domains',
      component: () => import('../views/domains/DomainsListView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/domains/create',
      name: 'domains-create',
      component: () => import('../views/domains/DomainFormView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/domains/:id/edit',
      name: 'domains-edit',
      component: () => import('../views/domains/DomainFormView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/reports',
      name: 'reports',
      component: () => import('../views/reports/UsageReportView.vue'),
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
