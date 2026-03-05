import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

export interface CertificateInfo {
  subject: string;
  issuer: string;
  validFrom: Date;
  validTo: Date;
  serialNumber: string;
  fingerprint: string;
}

@Injectable()
export class CertificateParserService {
  private readonly logger = new Logger(CertificateParserService.name);

  /**
   * Parse a PEM-encoded X.509 certificate and extract its details
   */
  parseCertificate(pemCertificate: string): CertificateInfo | null {
    try {
      // Normalize the PEM format
      const normalizedPem = this.normalizePem(pemCertificate);
      
      // Create X509Certificate object
      const cert = new crypto.X509Certificate(normalizedPem);
      
      return {
        subject: cert.subject,
        issuer: cert.issuer,
        validFrom: new Date(cert.validFrom),
        validTo: new Date(cert.validTo),
        serialNumber: cert.serialNumber,
        fingerprint: cert.fingerprint256,
      };
    } catch (error) {
      this.logger.error(`Failed to parse certificate: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }

  /**
   * Get just the expiration date from a certificate
   */
  getExpirationDate(pemCertificate: string): Date | null {
    const info = this.parseCertificate(pemCertificate);
    return info?.validTo || null;
  }

  /**
   * Check if a certificate is expired
   */
  isExpired(pemCertificate: string): boolean {
    const expirationDate = this.getExpirationDate(pemCertificate);
    if (!expirationDate) return true;
    return expirationDate < new Date();
  }

  /**
   * Check if a certificate will expire within the given number of days
   */
  willExpireSoon(pemCertificate: string, days: number = 30): boolean {
    const expirationDate = this.getExpirationDate(pemCertificate);
    if (!expirationDate) return true;
    
    const warningDate = new Date();
    warningDate.setDate(warningDate.getDate() + days);
    
    return expirationDate < warningDate;
  }

  /**
   * Normalize PEM certificate format
   */
  private normalizePem(pem: string): string {
    // If it doesn't have BEGIN marker, try to decode from base64
    if (!pem.includes('-----BEGIN')) {
      try {
        const decoded = Buffer.from(pem, 'base64').toString('utf-8');
        if (decoded.includes('-----BEGIN')) {
          return decoded;
        }
      } catch {
        // Not base64 encoded
      }
      
      // Wrap in certificate headers
      return `-----BEGIN CERTIFICATE-----\n${pem}\n-----END CERTIFICATE-----`;
    }
    
    return pem;
  }
}

