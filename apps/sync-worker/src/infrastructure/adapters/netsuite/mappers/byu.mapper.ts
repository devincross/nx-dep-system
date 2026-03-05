import { Injectable } from '@nestjs/common';
import { RawAccountData, RawOrderData } from '../../../../domain/ports/data-source.port.js';
import { AccountEntity, OrderEntity } from '../../../../domain/entities/index.js';
import { RegisterMapper } from '../../mapper-registry.js';
import { NetsuiteBaseMapper } from './base.mapper.js';

/**
 * BYU-specific NetSuite mapper
 * Extends base mapper with custom field mappings for BYU's NetSuite configuration
 */
@Injectable()
@RegisterMapper('byu')
export class ByuNetsuiteMapper extends NetsuiteBaseMapper {
  override getIdentifier(): string {
    return 'byu';
  }

  /**
   * BYU-specific account mapping
   * Uses custom fields specific to BYU's NetSuite setup
   */
  override mapAccount(raw: RawAccountData): AccountEntity {
    return {
      externalAccountId: String(raw['id'] ?? raw['internalid'] ?? ''),
      name: String(raw['companyname'] ?? raw['altname'] ?? raw['entityid'] ?? ''),
      depAccountId: raw['custentity_byu_dep_id'] 
        ? String(raw['custentity_byu_dep_id']) 
        : undefined,
    };
  }

  /**
   * BYU-specific order mapping
   */
  override mapOrder(raw: RawOrderData): OrderEntity {
    const baseOrder = super.mapOrder(raw);
    
    // Override with BYU-specific fields if present
    return {
      ...baseOrder,
      // BYU uses a custom field for DEP eligibility
      isDep: this.determineIsDep(raw),
      // BYU-specific PO field
      po: raw['custbody_byu_po_number'] 
        ? String(raw['custbody_byu_po_number']) 
        : baseOrder.po,
    };
  }

  /**
   * BYU-specific DEP determination
   */
  protected override determineIsDep(raw: RawOrderData): boolean {
    // BYU uses a custom checkbox field
    const depField = raw['custbody_byu_is_dep'] ?? raw['custbody_is_dep'] ?? false;
    
    if (typeof depField === 'boolean') {
      return depField;
    }
    
    if (typeof depField === 'string') {
      return depField.toLowerCase() === 'true' || depField === 'T' || depField === '1';
    }
    
    return Boolean(depField);
  }

  /**
   * BYU-specific serial number extraction
   */
  protected override extractSerialNumbers(item: Record<string, unknown>): string[] {
    // BYU uses a custom column for serial numbers
    const serialField = item['custcol_byu_serial_numbers'] ?? 
                       item['serialnumber'] ?? 
                       '';
    
    if (!serialField) {
      return [];
    }

    const serialStr = String(serialField);
    
    // BYU uses semicolon as delimiter
    return serialStr
      .split(/[;\n\r]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }
}

