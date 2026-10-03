import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TenantUsersService } from './tenant-users.service';

const mockLandlordDb: any = { select: jest.fn() };
const mockTenantDb: any = { select: jest.fn(), insert: jest.fn(), update: jest.fn() };

jest.mock('@org/database', () => ({
  tenants: { id: 'tenants.id' },
  domains: { tenantId: 'domains.tenantId' },
  users: { id: 'users.id', email: 'users.email', role: 'users.role', isActive: 'users.isActive' },
  getLandlordDb: () => mockLandlordDb,
  getTenantConnection: jest.fn(async () => mockTenantDb),
  hashPassword: (p: string) => `hash(${p})`,
}));

const sel = (rows: any[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });
const selAll = (rows: any[]) => ({ from: () => Promise.resolve(rows) });

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1', email: 'a@client.com', firstName: 'A', lastName: 'B', passwordHash: 'secret-hash',
  role: 'user', isActive: true, lastLoginAt: null, createdAt: new Date(), updatedAt: new Date(), ...over,
});

describe('TenantUsersService', () => {
  const service = new TenantUsersService();
  let inserted: any[];
  let updated: any[];

  /** Landlord lookups: the tenant, then its domains */
  const withTenant = (domainRows: any[] = [{ domain: 'acme.example.com', isPrimary: true, dbHost: 'h', dbPort: 3306, dbName: 'd', dbUser: 'u', dbPassword: 'p' }]) => {
    mockLandlordDb.select
      .mockReturnValueOnce(sel([{ id: 't1' }]))
      .mockReturnValueOnce(sel(domainRows));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLandlordDb.select.mockReset();
    mockTenantDb.select.mockReset();
    inserted = [];
    updated = [];
    mockTenantDb.insert.mockReturnValue({ values: (v: any) => { inserted.push(v); return Promise.resolve(); } });
    mockTenantDb.update.mockReturnValue({ set: (v: any) => ({ where: () => { updated.push(v); return Promise.resolve(); } }) });
  });

  it('lists a client\'s users without exposing password hashes', async () => {
    withTenant();
    mockTenantDb.select.mockReturnValueOnce(selAll([user()]));
    const result = await service.list('t1');
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('passwordHash');
  });

  it('404s for an unknown client', async () => {
    mockLandlordDb.select.mockReturnValueOnce(sel([]));
    await expect(service.list('nope')).rejects.toThrow(NotFoundException);
  });

  it('explains when a client has no database yet', async () => {
    withTenant([]);
    await expect(service.list('t1')).rejects.toThrow(BadRequestException);
  });

  describe('create', () => {
    it('stores a lowercased email and a hashed password', async () => {
      withTenant();
      mockTenantDb.select
        .mockReturnValueOnce(sel([])) // no existing email
        .mockReturnValueOnce(sel([user({ id: 'new', email: 'new@client.com', role: 'admin' })])); // read back
      const created = await service.create('t1', { email: ' New@Client.com ', password: 'password1', role: 'admin' });
      expect(inserted[0]).toMatchObject({ email: 'new@client.com', passwordHash: 'hash(password1)', role: 'admin', isActive: true });
      expect(created).not.toHaveProperty('passwordHash');
    });

    it('rejects a duplicate email', async () => {
      withTenant();
      mockTenantDb.select.mockReturnValueOnce(sel([user()]));
      await expect(service.create('t1', { email: 'a@client.com', password: 'password1' })).rejects.toThrow(ConflictException);
      expect(inserted).toEqual([]);
    });
  });

  describe('update', () => {
    it('resets a password by hashing the new one', async () => {
      withTenant();
      mockTenantDb.select
        .mockReturnValueOnce(sel([user()])) // current
        .mockReturnValueOnce(sel([user()])); // read back
      await service.update('t1', 'u1', { password: 'newpassword1' });
      expect(updated[0]).toMatchObject({ passwordHash: 'hash(newpassword1)' });
      expect(updated[0]).not.toHaveProperty('password');
    });

    it('rejects an email already used by another user', async () => {
      withTenant();
      mockTenantDb.select
        .mockReturnValueOnce(sel([user()])) // current
        .mockReturnValueOnce(sel([user({ id: 'other' })])); // clash
      await expect(service.update('t1', 'u1', { email: 'taken@client.com' })).rejects.toThrow(ConflictException);
    });

    it('refuses to demote or deactivate the last active admin', async () => {
      for (const dto of [{ role: 'user' as const }, { isActive: false }]) {
        withTenant();
        mockTenantDb.select
          .mockReturnValueOnce(sel([user({ role: 'admin' })])) // current
          .mockReturnValueOnce(sel([])); // no other active admins
        await expect(service.update('t1', 'u1', dto)).rejects.toThrow('only active admin');
      }
      expect(updated).toEqual([]);
    });

    it('allows demoting an admin when another active admin exists', async () => {
      withTenant();
      mockTenantDb.select
        .mockReturnValueOnce(sel([user({ role: 'admin' })]))
        .mockReturnValueOnce(sel([user({ id: 'other', role: 'admin' })])) // another admin
        .mockReturnValueOnce(sel([user({ role: 'user' })])); // read back
      await service.update('t1', 'u1', { role: 'user' });
      expect(updated[0]).toMatchObject({ role: 'user' });
    });

    it('404s for a user that does not exist', async () => {
      withTenant();
      mockTenantDb.select.mockReturnValueOnce(sel([]));
      await expect(service.update('t1', 'missing', { firstName: 'X' })).rejects.toThrow(NotFoundException);
    });
  });
});
