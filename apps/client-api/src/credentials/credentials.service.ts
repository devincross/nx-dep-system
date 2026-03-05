import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { eq, isNull, and, desc } from 'drizzle-orm';
import { TenantDb, credentials, Credential, ConnectionData } from '@org/database';
import { CreateCredentialDto, UpdateCredentialDto } from './dto/index.js';
import { EncryptionService } from '../encryption/encryption.service.js';
import { CertificateParserService } from './certificate-parser.service.js';

// Credential with decrypted connectionData
export interface DecryptedCredential extends Omit<Credential, 'connectionData'> {
  connectionData: ConnectionData;
}

// NetSuite connection data with certificate fields
interface NetsuiteConnectionData {
  auth_type?: 'oauth1' | 'oauth2';
  certificate_pem?: string;
  certificate_expires_at?: string;
  [key: string]: unknown;
}

@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(
    private readonly encryptionService: EncryptionService,
    private readonly certificateParserService: CertificateParserService
  ) {}

  /**
   * Decrypt a credential's connectionData
   */
  private decryptCredential(credential: Credential): DecryptedCredential {
    return {
      ...credential,
      connectionData: this.encryptionService.decryptJson<ConnectionData>(
        credential.connectionData
      ),
    };
  }

  /**
   * Process connection data to extract certificate expiration for NetSuite OAuth2
   */
  private processConnectionData(
    type: string,
    connectionData: ConnectionData
  ): ConnectionData {
    if (type !== 'netsuite') {
      return connectionData;
    }

    const nsData = connectionData as NetsuiteConnectionData;

    // Only process for OAuth2 with certificate
    if (nsData.auth_type !== 'oauth2' || !nsData.certificate_pem) {
      return connectionData;
    }

    // Parse certificate to get expiration date
    const expirationDate = this.certificateParserService.getExpirationDate(
      nsData.certificate_pem
    );

    if (expirationDate) {
      this.logger.log(`Certificate expires at: ${expirationDate.toISOString()}`);
      return {
        ...connectionData,
        certificate_expires_at: expirationDate.toISOString(),
      };
    }

    return connectionData;
  }

  /**
   * Find all credentials (excluding soft-deleted)
   */
  async findAll(db: TenantDb): Promise<DecryptedCredential[]> {
    const results = await db
      .select()
      .from(credentials)
      .where(isNull(credentials.deletedAt));

    return results.map((c) => this.decryptCredential(c));
  }

  /**
   * Find a single credential by ID (excluding soft-deleted)
   */
  async findOne(db: TenantDb, id: number): Promise<DecryptedCredential> {
    const result = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.id, id), isNull(credentials.deletedAt)));

    if (result.length === 0) {
      throw new NotFoundException(`Credential with ID "${id}" not found`);
    }

    return this.decryptCredential(result[0]);
  }

  /**
   * Find credentials by type (excluding soft-deleted)
   */
  async findByType(
    db: TenantDb,
    type: 'dep' | 'zoho' | 'netsuite' | 'database' | 'ssl'
  ): Promise<DecryptedCredential[]> {
    const results = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.type, type), isNull(credentials.deletedAt)));

    return results.map((c) => this.decryptCredential(c));
  }

  /**
   * Find the newest active credential by type
   * Returns the most recently created credential of the specified type with status 'current'
   */
  async findNewestActiveByType(
    db: TenantDb,
    type: 'dep' | 'zoho' | 'netsuite' | 'database' | 'ssl'
  ): Promise<DecryptedCredential | null> {
    const results = await db
      .select()
      .from(credentials)
      .where(
        and(
          eq(credentials.type, type),
          eq(credentials.status, 'current'),
          isNull(credentials.deletedAt)
        )
      )
      .orderBy(desc(credentials.createdAt))
      .limit(1);

    if (results.length === 0) {
      return null;
    }

    return this.decryptCredential(results[0]);
  }

  /**
   * Create a new credential
   */
  async create(
    db: TenantDb,
    createCredentialDto: CreateCredentialDto
  ): Promise<DecryptedCredential> {
    const now = new Date();

    // Process connection data (e.g., extract certificate expiration)
    const processedConnectionData = this.processConnectionData(
      createCredentialDto.type,
      createCredentialDto.connectionData
    );

    // Encrypt the connectionData before storing
    const encryptedData = this.encryptionService.encryptJson(processedConnectionData);

    const result = await db.insert(credentials).values({
      type: createCredentialDto.type,
      status: createCredentialDto.status || 'current',
      connectionData: encryptedData,
      createdAt: now,
      updatedAt: now,
    });

    // Get the inserted ID from the result
    const insertId = Number(result[0].insertId);

    return this.findOne(db, insertId);
  }

  /**
   * Update an existing credential
   */
  async update(
    db: TenantDb,
    id: number,
    updateCredentialDto: UpdateCredentialDto
  ): Promise<DecryptedCredential> {
    // Ensure credential exists and get current data
    const existing = await this.findOne(db, id);

    // Build update object, encrypting connectionData if provided
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    const credType = updateCredentialDto.type ?? existing.type;

    if (updateCredentialDto.type !== undefined) {
      updateData['type'] = updateCredentialDto.type;
    }
    if (updateCredentialDto.status !== undefined) {
      updateData['status'] = updateCredentialDto.status;
    }
    if (updateCredentialDto.connectionData !== undefined) {
      // Process connection data (e.g., extract certificate expiration)
      const processedConnectionData = this.processConnectionData(
        credType,
        updateCredentialDto.connectionData
      );
      updateData['connectionData'] = this.encryptionService.encryptJson(
        processedConnectionData
      );
    }

    await db
      .update(credentials)
      .set(updateData)
      .where(eq(credentials.id, id));

    return this.findOne(db, id);
  }

  /**
   * Soft delete a credential
   */
  async remove(db: TenantDb, id: number): Promise<void> {
    // Ensure credential exists
    await this.findOne(db, id);

    await db
      .update(credentials)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(credentials.id, id));
  }

  /**
   * Hard delete a credential (permanent)
   */
  async hardDelete(db: TenantDb, id: number): Promise<void> {
    // Ensure credential exists (including soft-deleted)
    const result = await db
      .select()
      .from(credentials)
      .where(eq(credentials.id, id));

    if (result.length === 0) {
      throw new NotFoundException(`Credential with ID "${id}" not found`);
    }

    await db.delete(credentials).where(eq(credentials.id, id));
  }

  /**
   * Restore a soft-deleted credential
   */
  async restore(db: TenantDb, id: number): Promise<DecryptedCredential> {
    const result = await db
      .select()
      .from(credentials)
      .where(eq(credentials.id, id));

    if (result.length === 0) {
      throw new NotFoundException(`Credential with ID "${id}" not found`);
    }

    await db
      .update(credentials)
      .set({
        deletedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(credentials.id, id));

    return this.findOne(db, id);
  }
}

