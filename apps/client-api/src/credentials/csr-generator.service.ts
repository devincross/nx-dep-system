import { Injectable, Logger } from '@nestjs/common';
import { generateKeyPairSync } from 'crypto';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface CsrSubject {
  /** 2-letter country code (e.g. US) */
  country: string;
  /** State or province (e.g. Utah) */
  state: string;
  /** City (e.g. Salt Lake City) */
  city: string;
  /** Organization name (e.g. Acme Corp) */
  organization: string;
  /** Organizational unit (e.g. IT) */
  organizationalUnit?: string;
  /** Common name — for DEP: GRX-<10DigitSoldTo>.ACC1914.Prod.AppleCare */
  commonName: string;
}

export interface GeneratedCsr {
  /** PEM-encoded RSA private key (store this securely) */
  privateKey: string;
  /** PEM-encoded Certificate Signing Request (send this to Apple) */
  csrPem: string;
  /** The subject/DN used in the CSR */
  subject: CsrSubject;
}

@Injectable()
export class CsrGeneratorService {
  private readonly logger = new Logger(CsrGeneratorService.name);

  /**
   * Generate an RSA key pair and CSR for Apple DEP.
   *
   * The CN follows the pattern: GRX-<10DigitSoldTo>.ACC1914.Prod.AppleCare
   * No password is set on the key.
   */
  generate(subject: CsrSubject, keySize = 2048): GeneratedCsr {
    this.logger.log(`Generating ${keySize}-bit RSA key and CSR for CN=${subject.commonName}`);

    // Generate RSA key pair
    const { privateKey: privateKeyPem } = generateKeyPairSync('rsa', {
      modulusLength: keySize,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Build the subject string for openssl
    const subjectParts = [
      `/C=${subject.country}`,
      `/ST=${subject.state}`,
      `/L=${subject.city}`,
      `/O=${subject.organization}`,
    ];
    if (subject.organizationalUnit) {
      subjectParts.push(`/OU=${subject.organizationalUnit}`);
    }
    subjectParts.push(`/CN=${subject.commonName}`);
    const subjectStr = subjectParts.join('');

    // Generate CSR using openssl
    const tmpDir = mkdtempSync(join(tmpdir(), 'csr-'));
    const keyPath = join(tmpDir, 'key.pem');
    const csrPath = join(tmpDir, 'csr.pem');

    try {
      writeFileSync(keyPath, privateKeyPem);

      execSync(
        `openssl req -new -key "${keyPath}" -out "${csrPath}" -sha256 -subj "${subjectStr}" -nodes`,
        { stdio: 'pipe' },
      );

      const csrPem = readFileSync(csrPath, 'utf-8');

      this.logger.log(`CSR generated for ${subject.commonName}`);

      return { privateKey: privateKeyPem, csrPem, subject };
    } finally {
      try { unlinkSync(keyPath); } catch { /* */ }
      try { unlinkSync(csrPath); } catch { /* */ }
      try { execSync(`rmdir "${tmpDir}"`, { stdio: 'pipe' }); } catch { /* */ }
    }
  }

  /**
   * Build the Apple DEP Common Name from a SoldTo number.
   * Pattern: GRX-<10DigitSoldTo>.ACC1914.Prod.AppleCare
   */
  buildDepCommonName(soldTo: string): string {
    const padded = soldTo.replace(/\D/g, '').padStart(10, '0');
    return `GRX-${padded}.ACC1914.Prod.AppleCare`;
  }
}
