import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { NetsuiteApiClient } from 'netsuite-api-client';
import { TenantDb } from '@org/database';
import { CredentialsService, DecryptedCredential } from '../credentials/credentials.service.js';

/**
 * NetSuite connection data interface matching the DTO fields
 */
export interface NetsuiteConnectionData {
  netsuite_restlet_host: string;
  netsuite_account: string;
  client_id: string;
  client_secret: string;
  netsuite_realm: string;
  netsuite_consumer_key: string;
  netsuite_consumer_secret: string;
  netsuite_token: string;
  netsuite_token_secret: string;
  netsuite_signature_algorithm: string;
  netsuite_deploy_id: number;
  netsuite_order_script_id: string;
  netsuite_account_script_id: string;
  mapping_class: string;
}

/**
 * Response from NetSuite RESTlet calls
 */
export interface NetsuiteResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

@Injectable()
export class NetsuiteService {
  private readonly logger = new Logger(NetsuiteService.name);

  constructor(private readonly credentialsService: CredentialsService) {}

  /**
   * Get the newest active NetSuite credential for the tenant
   */
  async getNetsuiteCredential(db: TenantDb): Promise<DecryptedCredential> {
    const credential = await this.credentialsService.findNewestActiveByType(db, 'netsuite');

    if (!credential) {
      throw new NotFoundException('No active NetSuite credentials found');
    }

    return credential;
  }

  /**
   * Create NetsuiteApiClient instance for the given connection data
   */
  private createClient(connectionData: NetsuiteConnectionData): NetsuiteApiClient {
    return new NetsuiteApiClient({
      consumer_key: connectionData.netsuite_consumer_key,
      consumer_secret_key: connectionData.netsuite_consumer_secret,
      token: connectionData.netsuite_token,
      token_secret: connectionData.netsuite_token_secret,
      realm: connectionData.netsuite_realm,
      base_url: connectionData.netsuite_restlet_host.replace(/\/$/, ''),
    });
  }

  /**
   * Build full RESTlet URL with script and deploy parameters
   */
  private buildRestletUrl(
    connectionData: NetsuiteConnectionData,
    scriptId: string
  ): string {
    const baseUrl = connectionData.netsuite_restlet_host.replace(/\/$/, '');
    return `${baseUrl}?script=${scriptId}&deploy=${connectionData.netsuite_deploy_id}`;
  }

  /**
   * Make an authenticated request to NetSuite RESTlet
   */
  async makeRequest<T = unknown>(
    db: TenantDb,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    scriptId: string,
    data?: Record<string, unknown>
  ): Promise<NetsuiteResponse<T>> {
    const credential = await this.getNetsuiteCredential(db);
    const connectionData = credential.connectionData as unknown as NetsuiteConnectionData;

    const client = this.createClient(connectionData);
    let restletUrl = this.buildRestletUrl(connectionData, scriptId);

    // For GET requests, append data as query parameters instead of body
    if (method === 'GET' && data && Object.keys(data).length > 0) {
      const queryParams = new URLSearchParams();
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null) {
          queryParams.append(key, String(value));
        }
      }
      restletUrl += `&${queryParams.toString()}`;
    }

    try {
      const requestOptions: { method: string; restletUrl: string; body?: string } = {
        method,
        restletUrl,
      };

      // Only add body for non-GET requests
      if (method !== 'GET' && data) {
        requestOptions.body = JSON.stringify(data);
      }

      const response = await client.request(requestOptions);

      return {
        success: true,
        data: response.data as T,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`NetSuite request error: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Call the NetSuite order script
   * Automatically includes: script, deploy, realm, type='orders'
   */
  async callOrderScript<T = unknown>(
    db: TenantDb,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    data?: Record<string, unknown>
  ): Promise<NetsuiteResponse<T>> {
    const credential = await this.getNetsuiteCredential(db);
    const connectionData = credential.connectionData as unknown as NetsuiteConnectionData;

    // Add required parameters from credentials
    const enrichedData: Record<string, unknown> = {
      ...data,
      script: connectionData.netsuite_order_script_id,
      deploy: connectionData.netsuite_deploy_id,
      realm: connectionData.netsuite_account,
      type: 'orders',
    };

    return this.makeRequest<T>(db, method, connectionData.netsuite_order_script_id, enrichedData);
  }

  /**
   * Call the NetSuite account script
   * Automatically includes: script, deploy, realm, type='customers'
   */
  async callAccountScript<T = unknown>(
    db: TenantDb,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    data?: Record<string, unknown>
  ): Promise<NetsuiteResponse<T>> {
    const credential = await this.getNetsuiteCredential(db);
    const connectionData = credential.connectionData as unknown as NetsuiteConnectionData;

    // Add required parameters from credentials
    const enrichedData: Record<string, unknown> = {
      ...data,
      script: connectionData.netsuite_account_script_id,
      deploy: connectionData.netsuite_deploy_id,
      realm: connectionData.netsuite_account,
      type: 'customers',
    };

    return this.makeRequest<T>(db, method, connectionData.netsuite_account_script_id, enrichedData);
  }
}

