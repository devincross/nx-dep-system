import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';

export interface NetsuiteOAuthConfig {
  accountId: string;
  clientId: string;
  certificateId: string;
  privateKey: string;
}

export interface NetsuiteTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // Unix timestamp in ms
}

@Injectable()
export class NetsuiteOAuthService {
  private readonly logger = new Logger(NetsuiteOAuthService.name);
  
  // Cache tokens by a composite key of accountId + clientId
  private tokenCache = new Map<string, CachedToken>();
  
  // Buffer time before expiry to refresh (5 minutes)
  private readonly expiryBuffer = 5 * 60 * 1000;

  /**
   * Get a valid access token, fetching a new one if needed
   */
  async getAccessToken(config: NetsuiteOAuthConfig): Promise<string> {
    const cacheKey = `${config.accountId}:${config.clientId}`;
    const cached = this.tokenCache.get(cacheKey);
    
    // Check if we have a valid cached token
    if (cached && cached.expiresAt > Date.now() + this.expiryBuffer) {
      this.logger.debug('Using cached NetSuite access token');
      return cached.accessToken;
    }
    
    // Fetch a new token
    this.logger.log('Fetching new NetSuite access token');
    const tokenResponse = await this.fetchAccessToken(config);
    
    // Cache the token
    const expiresAt = Date.now() + (tokenResponse.expires_in * 1000);
    this.tokenCache.set(cacheKey, {
      accessToken: tokenResponse.access_token,
      expiresAt,
    });
    
    this.logger.log(`NetSuite token cached, expires in ${tokenResponse.expires_in} seconds`);
    return tokenResponse.access_token;
  }

  /**
   * Fetch a new access token from NetSuite
   */
  private async fetchAccessToken(config: NetsuiteOAuthConfig): Promise<NetsuiteTokenResponse> {
    const tokenUrl = this.getTokenUrl(config.accountId);
    const clientAssertion = this.createClientAssertion(config);
    
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: clientAssertion,
    });

    this.logger.debug(`Requesting token from: ${tokenUrl}`);
    
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`NetSuite token request failed: ${response.status} - ${errorText}`);
      throw new Error(`NetSuite OAuth token request failed: ${response.status} - ${errorText}`);
    }

    const tokenResponse = await response.json() as NetsuiteTokenResponse;
    return tokenResponse;
  }

  /**
   * Create a signed JWT client assertion
   */
  private createClientAssertion(config: NetsuiteOAuthConfig): string {
    const now = Math.floor(Date.now() / 1000);
    const tokenUrl = this.getTokenUrl(config.accountId);
    
    const payload = {
      iss: config.clientId,
      sub: config.clientId,
      aud: tokenUrl,
      iat: now,
      exp: now + 300, // 5 minutes expiry for the assertion
      scope: ['restlets', 'rest_webservices'],
    };

    // Sign the JWT with the private key
    const privateKey = this.normalizePrivateKey(config.privateKey);
    
    const token = jwt.sign(payload, privateKey, {
      algorithm: 'RS256',
      header: {
        alg: 'RS256',
        typ: 'JWT',
        kid: config.certificateId,
      },
    });

    return token;
  }

  /**
   * Get the NetSuite OAuth token endpoint URL
   */
  private getTokenUrl(accountId: string): string {
    // Convert account ID format: 4325477_SB1 -> 4325477-sb1
    const normalizedAccount = accountId.toLowerCase().replace('_', '-');
    return `https://${normalizedAccount}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;
  }

  /**
   * Normalize private key format (handle base64 encoded or PEM format)
   */
  private normalizePrivateKey(privateKey: string): string {
    // If it's base64 encoded (no BEGIN marker), decode it
    if (!privateKey.includes('-----BEGIN')) {
      const decoded = Buffer.from(privateKey, 'base64').toString('utf-8');
      if (decoded.includes('-----BEGIN')) {
        return decoded;
      }
      // Wrap in PEM format if still not valid
      return `-----BEGIN RSA PRIVATE KEY-----\n${privateKey}\n-----END RSA PRIVATE KEY-----`;
    }
    return privateKey;
  }

  /**
   * Clear cached token for a specific config
   */
  clearCache(config: NetsuiteOAuthConfig): void {
    const cacheKey = `${config.accountId}:${config.clientId}`;
    this.tokenCache.delete(cacheKey);
    this.logger.log('Cleared cached NetSuite token');
  }

  /**
   * Clear all cached tokens
   */
  clearAllCache(): void {
    this.tokenCache.clear();
    this.logger.log('Cleared all cached NetSuite tokens');
  }
}

