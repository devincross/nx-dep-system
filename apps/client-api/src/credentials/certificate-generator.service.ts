import { Injectable, Logger } from '@nestjs/common';
import * as forge from 'node-forge';

export interface GeneratedCertificate {
  /** RSA private key in PEM format */
  privateKey: string;
  /** X.509 self-signed certificate in PEM format (upload this to NetSuite) */
  certificatePem: string;
  /** SHA-256 fingerprint of the certificate */
  fingerprint: string;
  /** Certificate serial number */
  serialNumber: string;
  /** Certificate validity start */
  validFrom: string;
  /** Certificate validity end */
  validTo: string;
}

export interface GenerateCertificateOptions {
  /** RSA key size in bits (default: 2048) */
  keySize?: number;
  /** Certificate validity in days (default: 730 = 2 years) */
  validityDays?: number;
  /** Common Name for the certificate subject (default: 'DEP Sync Integration') */
  commonName?: string;
  /** Organization name (default: 'DEP') */
  organization?: string;
}

@Injectable()
export class CertificateGeneratorService {
  private readonly logger = new Logger(CertificateGeneratorService.name);

  /**
   * Generate an RSA key pair and self-signed X.509 certificate
   * suitable for NetSuite OAuth 2.0 M2M authentication.
   */
  generate(options?: GenerateCertificateOptions): GeneratedCertificate {
    const keySize = options?.keySize ?? 2048;
    const validityDays = options?.validityDays ?? 730;
    const commonName = options?.commonName ?? 'DEP Sync Integration';
    const organization = options?.organization ?? 'DEP';

    this.logger.log(`Generating ${keySize}-bit RSA key pair and certificate (valid ${validityDays} days)`);

    // Generate RSA key pair
    const keys = forge.pki.rsa.generateKeyPair({ bits: keySize, e: 0x10001 });

    // Create the certificate
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = this.generateSerialNumber();

    const now = new Date();
    const expiry = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);
    cert.validity.notBefore = now;
    cert.validity.notAfter = expiry;

    const attrs = [
      { name: 'commonName', value: commonName },
      { name: 'organizationName', value: organization },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs); // self-signed

    // Extensions
    cert.setExtensions([
      { name: 'basicConstraints', cA: false },
      {
        name: 'keyUsage',
        digitalSignature: true,
        keyEncipherment: true,
      },
      {
        name: 'extKeyUsage',
        clientAuth: true,
      },
    ]);

    // Self-sign with the private key (SHA-256)
    cert.sign(keys.privateKey, forge.md.sha256.create());

    const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
    const certificatePem = forge.pki.certificateToPem(cert);

    // Calculate fingerprint
    const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const md = forge.md.sha256.create();
    md.update(derBytes);
    const fingerprint = md.digest()
      .toHex()
      .match(/.{2}/g)!
      .join(':')
      .toUpperCase();

    this.logger.log(`Certificate generated. Fingerprint: ${fingerprint}, Expires: ${expiry.toISOString()}`);

    return {
      privateKey: privateKeyPem,
      certificatePem,
      fingerprint,
      serialNumber: cert.serialNumber,
      validFrom: now.toISOString(),
      validTo: expiry.toISOString(),
    };
  }

  private generateSerialNumber(): string {
    // Generate a random 16-byte serial number as hex
    const bytes = forge.random.getBytesSync(16);
    return forge.util.bytesToHex(bytes);
  }
}
