import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import {
  domains,
  getLandlordDb,
  getTenantConnection,
  hashPassword,
  tenants,
  users,
  type TenantDb,
  type User,
} from '@org/database';
import { CreateTenantUserDto, UpdateTenantUserDto } from './dto/index.js';

// Never return the password hash
export type SafeTenantUser = Omit<User, 'passwordHash'>;

function toSafeUser(user: User): SafeTenantUser {
  const { passwordHash, ...safe } = user;
  return safe;
}

/**
 * Manage the users inside a client's (tenant's) own database — the people who
 * sign in to that client's portal. Lives in admin-api because only the
 * landlord side knows each tenant's database connection.
 */
@Injectable()
export class TenantUsersService {
  /** Connect to a tenant's database via its primary (or first) domain */
  private async tenantDb(tenantId: string): Promise<TenantDb> {
    const landlord = getLandlordDb();
    const tenantRows = await landlord.select().from(tenants).where(eq(tenants.id, tenantId));
    if (tenantRows.length === 0) throw new NotFoundException(`Tenant "${tenantId}" not found`);

    const domainRows = await landlord.select().from(domains).where(eq(domains.tenantId, tenantId));
    const domain = domainRows.find((d) => d.isPrimary) ?? domainRows[0];
    if (!domain) {
      throw new BadRequestException('This client has no database configured yet. Add a domain first.');
    }

    return getTenantConnection(domain.domain, {
      host: domain.dbHost,
      port: domain.dbPort,
      database: domain.dbName,
      user: domain.dbUser,
      password: domain.dbPassword,
    });
  }

  async list(tenantId: string): Promise<SafeTenantUser[]> {
    const db = await this.tenantDb(tenantId);
    return (await db.select().from(users)).map(toSafeUser);
  }

  async create(tenantId: string, dto: CreateTenantUserDto): Promise<SafeTenantUser> {
    const db = await this.tenantDb(tenantId);
    const email = dto.email.trim().toLowerCase();

    const existing = await db.select().from(users).where(eq(users.email, email));
    if (existing.length > 0) {
      throw new ConflictException(`A user with email "${email}" already exists for this client`);
    }

    const id = uuidv4();
    const now = new Date();
    await db.insert(users).values({
      id,
      email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      passwordHash: hashPassword(dto.password),
      role: dto.role ?? 'user',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return this.get(db, id);
  }

  async update(tenantId: string, userId: string, dto: UpdateTenantUserDto): Promise<SafeTenantUser> {
    const db = await this.tenantDb(tenantId);
    const current = await this.get(db, userId);

    if (dto.email) {
      dto.email = dto.email.trim().toLowerCase();
      const clash = await db
        .select()
        .from(users)
        .where(and(eq(users.email, dto.email), ne(users.id, userId)));
      if (clash.length > 0) {
        throw new ConflictException(`A user with email "${dto.email}" already exists for this client`);
      }
    }

    // A client must always keep an active admin, or nobody can manage their users
    const demoting = current.role === 'admin' && dto.role === 'user';
    const deactivating = current.role === 'admin' && current.isActive && dto.isActive === false;
    if (demoting || deactivating) {
      const others = await db
        .select()
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true), ne(users.id, userId)));
      if (others.length === 0) {
        throw new BadRequestException(
          'This is the only active admin for this client. Make another user an admin first.',
        );
      }
    }

    const { password, ...fields } = dto;
    await db
      .update(users)
      .set({
        ...fields,
        ...(password ? { passwordHash: hashPassword(password) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return this.get(db, userId);
  }

  private async get(db: TenantDb, userId: string): Promise<SafeTenantUser> {
    const rows = await db.select().from(users).where(eq(users.id, userId));
    if (rows.length === 0) throw new NotFoundException(`User "${userId}" not found`);
    return toSafeUser(rows[0]);
  }
}
