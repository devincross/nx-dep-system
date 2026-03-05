import { Injectable } from '@nestjs/common';
import { MapperPort, RawAccountData, RawOrderData } from '../../../../domain/ports/data-source.port.js';
import { AccountEntity, OrderEntity, OrderItemEntity } from '../../../../domain/entities/index.js';
import { RegisterMapper } from '../../mapper-registry.js';

/**
 * Base Zoho mapper - provides default mapping logic for Zoho CRM data
 * Can be extended for tenant-specific customizations
 */
@Injectable()
@RegisterMapper('zoho-default')
export class ZohoBaseMapper implements MapperPort {
  getIdentifier(): string {
    return 'zoho-default';
  }

  /**
   * Map raw Zoho account data to AccountEntity
   */
  mapAccount(raw: RawAccountData): AccountEntity {
    return {
      externalAccountId: String(raw['id'] ?? raw['Id'] ?? ''),
      name: String(raw['Account_Name'] ?? raw['name'] ?? ''),
      depAccountId: raw['DEP_Account_ID'] 
        ? String(raw['DEP_Account_ID']) 
        : undefined,
    };
  }

  /**
   * Map raw Zoho sales order data to OrderEntity
   */
  mapOrder(raw: RawOrderData): OrderEntity {
    const items = this.mapOrderItems(raw);
    
    return {
      externalOrderId: String(raw['id'] ?? raw['Id'] ?? raw['SO_Number'] ?? ''),
      externalAccountId: String(
        raw['Account_Name']?.['id'] ?? 
        raw['Account_Name'] ?? 
        raw['account_id'] ?? 
        ''
      ),
      externalOrderStatus: raw['Status'] ? String(raw['Status']) : undefined,
      isDep: this.determineIsDep(raw),
      po: raw['PO_Number'] ? String(raw['PO_Number']) : undefined,
      items,
      source: 'zoho',
    };
  }

  /**
   * Map order items/line items from raw data
   */
  protected mapOrderItems(raw: RawOrderData): OrderItemEntity[] {
    const items: OrderItemEntity[] = [];
    
    // Zoho uses Product_Details for line items
    const rawItems = (raw['Product_Details'] ?? raw['Ordered_Items'] ?? []) as unknown[];
    
    if (!Array.isArray(rawItems)) {
      return items;
    }

    for (const rawItem of rawItems) {
      const item = rawItem as Record<string, unknown>;
      const serialNumbers = this.extractSerialNumbers(item);
      
      for (const serialNumber of serialNumbers) {
        items.push({
          serialNumber,
          isDep: this.determineItemIsDep(item),
          depStatus: 'pending',
        });
      }
    }

    return items;
  }

  /**
   * Extract serial numbers from a line item
   */
  protected extractSerialNumbers(item: Record<string, unknown>): string[] {
    const serialField = item['Serial_Numbers'] ?? item['Serials'] ?? '';
    
    if (!serialField) {
      return [];
    }

    const serialStr = String(serialField);
    
    return serialStr
      .split(/[,;\n\r]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  /**
   * Determine if an order is DEP eligible
   */
  protected determineIsDep(raw: RawOrderData): boolean {
    const depField = raw['Is_DEP'] ?? raw['DEP_Eligible'] ?? false;
    
    if (typeof depField === 'boolean') {
      return depField;
    }
    
    if (typeof depField === 'string') {
      return depField.toLowerCase() === 'true' || depField === '1' || depField.toLowerCase() === 'yes';
    }
    
    return Boolean(depField);
  }

  /**
   * Determine if an item is DEP eligible
   */
  protected determineItemIsDep(item: Record<string, unknown>): boolean {
    const depField = item['Is_DEP'] ?? item['DEP_Eligible'] ?? false;
    
    if (typeof depField === 'boolean') {
      return depField;
    }
    
    if (typeof depField === 'string') {
      return depField.toLowerCase() === 'true' || depField === '1' || depField.toLowerCase() === 'yes';
    }
    
    return Boolean(depField);
  }
}

