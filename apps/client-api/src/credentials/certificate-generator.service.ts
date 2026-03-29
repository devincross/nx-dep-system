import { Injectable, Logger } from '@nestjs/common';
import { generateKeyPairSync, createHash, X509Certificate, randomBytes } from 'crypto';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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
  /** RSA key size in bits (default: 4096, NetSuite requires >= 4096) */
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
   * Uses Node.js native crypto + openssl for certificate creation.
   */
  generate(options?: GenerateCertificateOptions): GeneratedCertificate {
    const keySize = options?.keySize ?? 4096;
    const validityDays = options?.validityDays ?? 730;
    const commonName = options?.commonName ?? 'DEP Sync Integration';
    const organization = options?.organization ?? 'DEP';

    this.logger.log(`Generating ${keySize}-bit RSA key pair and certificate (valid ${validityDays} days)`);

    // Generate RSA key pair using Node.js native crypto
    const { privateKey: privateKeyPem, publicKey: publicKeyPem } = generateKeyPairSync('rsa', {
      modulusLength: keySize,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Use openssl to create a self-signed certificate
    const tmpDir = mkdtempSync(join(tmpdir(), 'cert-'));
    const keyPath = join(tmpDir, 'key.pem');
    const certPath = join(tmpDir, 'cert.pem');

    try {
      writeFileSync(keyPath, privateKeyPem);

      const subject = `/CN=${commonName}/O=${organization}`;
      execSync(
        `openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days ${validityDays} -sha256 -subj "${subject}" -addext "basicConstraints=CA:FALSE" -addext "keyUsage=digitalSignature,keyEncipherment" -addext "extendedKeyUsage=clientAuth"`,
        { stdio: 'pipe' }
      );

      const certificatePem = readFileSync(certPath, 'utf-8');

      // Parse the certificate to extract metadata
      const x509 = new X509Certificate(certificatePem);
      const fingerprint = x509.fingerprint256.replace(/:/g, ':');
      const serialNumber = x509.serialNumber;
      const validFrom = new Date(x509.validFrom).toISOString();
      const validTo = new Date(x509.validTo).toISOString();

      this.logger.log(`Certificate generated. Fingerprint: ${fingerprint}, Expires: ${validTo}`);

      return {
        privateKey: privateKeyPem,
        certificatePem,
        fingerprint,
        serialNumber,
        validFrom,
        validTo,
      };
    } finally {
      // Clean up temp files
      try { unlinkSync(keyPath); } catch { /* ignore */ }
      try { unlinkSync(certPath); } catch { /* ignore */ }
      try { execSync(`rmdir "${tmpDir}"`, { stdio: 'pipe' }); } catch { /* ignore */ }
    }
  }
}
