import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from './jwt-auth.guard';

jest.mock('@org/database', () => ({
  getLandlordDb: jest.fn(),
  getTenantConnection: jest.fn(),
  hashPassword: jest.fn(),
  tenants: {}, domains: {}, users: {}, orders: {}, orderItems: {}, landlordUsers: {},
  migrateLandlordDb: jest.fn(), migrateTenantDb: jest.fn(),
}));

/**
 * Every admin-api route must require a JWT, except an explicit allowlist.
 * Adding a new controller or route without a guard fails this test.
 */
const PUBLIC_ROUTES = new Set([
  'AppController.getData', // GET /api — static greeting
  'AppController.health', // GET /api/health — container/uptime checks
  'AuthController.login', // POST /users/login
  'AuthController.register', // POST /users/register — closed once the first admin exists
]);

// Discover every controller under src/ so a new one can't slip in unchecked
function controllerFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(full);
    return entry.name.endsWith('.controller.ts') ? [full] : [];
  });
}

const CONTROLLERS: { name: string; prototype: any }[] = controllerFiles(path.join(__dirname, '..')).flatMap((file) =>
  Object.values(require(file) as Record<string, any>).filter(
    (exported) => typeof exported === 'function' && Reflect.getMetadata('path', exported) !== undefined,
  ),
);

function guardsOf(target: object): unknown[] {
  return Reflect.getMetadata('__guards__', target) ?? [];
}

describe('admin-api route protection', () => {
  const routes = CONTROLLERS.flatMap((controller) =>
    Object.getOwnPropertyNames(controller.prototype)
      .filter((name) => name !== 'constructor' && Reflect.getMetadata('method', controller.prototype[name]) !== undefined)
      .map((name) => ({
        id: `${controller.name}.${name}`,
        guarded: [...guardsOf(controller), ...guardsOf(controller.prototype[name])].includes(JwtAuthGuard),
      })),
  );

  it('found the routes it is meant to check', () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  it('guards every route except the explicit public allowlist', () => {
    const unguarded = routes.filter((r) => !r.guarded).map((r) => r.id).sort();
    expect(unguarded).toEqual([...PUBLIC_ROUTES].sort());
  });
});
