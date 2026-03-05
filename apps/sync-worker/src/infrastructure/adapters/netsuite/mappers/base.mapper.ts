import { Injectable } from '@nestjs/common';
import { MapperPort, RawAccountData, RawOrderData } from '../../../../domain/ports/data-source.port.js';
import { AccountEntity, OrderEntity, OrderItemEntity } from '../../../../domain/entities/index.js';
import { RegisterMapper } from '../../mapper-registry.js';

/**
 * Base NetSuite mapper - provides default mapping logic
 * Can be extended for tenant-specific customizations
 */
@Injectable()
@RegisterMapper('netsuite-default')
export class NetsuiteBaseMapper implements MapperPort {
  getIdentifier(): string {
    return 'netsuite-default';
  }

  /**
   * Map raw NetSuite customer data to AccountEntity
   * Override this method for custom field mappings
   */
  mapAccount(raw: RawAccountData): AccountEntity {
    return {
      externalAccountId: String(raw['id'] ?? raw['internalid'] ?? ''),
      name: String(raw['companyname'] ?? raw['name'] ?? raw['entityid'] ?? ''),
      depAccountId: raw['custentity_dep_account_id'] 
        ? String(raw['custentity_dep_account_id']) 
        : undefined,
    };
  }

  /**
   * Map raw NetSuite order data to OrderEntity
   * Override this method for custom field mappings
   */
  mapOrder(raw: RawOrderData): OrderEntity {
    const items = this.mapOrderItems(raw);
    
    return {
      externalOrderId: String(raw['id'] ?? raw['internalid'] ?? raw['tranid'] ?? ''),
      externalAccountId: String(
        raw['entity']?.['id'] ?? 
        raw['entity'] ?? 
        raw['customer']?.['id'] ?? 
        raw['customer'] ?? 
        ''
      ),
      externalOrderStatus: raw['status'] ? String(raw['status']) : undefined,
      isDep: this.determineIsDep(raw),
      po: raw['otherrefnum'] ? String(raw['otherrefnum']) : undefined,
      items,
      source: 'netsuite',
    };
  }

  /**
   * Map order items/lines from raw data
   * Override for custom item mapping
   */
  protected mapOrderItems(raw: RawOrderData): OrderItemEntity[] {
    const items: OrderItemEntity[] = [];
    
    // Try different possible item array locations
    const rawItems = (raw['item'] ?? raw['items'] ?? raw['line'] ?? raw['lines'] ?? []) as unknown[];
    
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
   * Extract serial numbers from an order item
   * Override for custom serial number extraction
   */
  protected extractSerialNumbers(item: Record<string, unknown>): string[] {
    // Try different possible serial number fields
    const serialField = item['serialnumber'] ?? item['serial_number'] ?? 
                       item['serialnumbers'] ?? item['serial_numbers'] ??
                       item['custcol_serial_numbers'] ?? '';
    
    if (!serialField) {
      return [];
    }

    const serialStr = String(serialField);
    
    // Split by common delimiters
    return serialStr
      .split(/[,;\n\r]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  /**
   * Determine if an order is DEP eligible
   * Override for custom DEP determination logic
   */
  protected determineIsDep(raw: RawOrderData): boolean {
    // Check common DEP indicator fields
    const depField = raw['custbody_is_dep'] ?? raw['is_dep'] ?? raw['isdep'] ?? false;
    
    if (typeof depField === 'boolean') {
      return depField;
    }
    
    if (typeof depField === 'string') {
      return depField.toLowerCase() === 'true' || depField === '1' || depField.toLowerCase() === 'yes';
    }
    
    return Boolean(depField);
  }

  /**
   * Determine if an order item is DEP eligible
   * Override for custom item-level DEP determination
   */
  protected determineItemIsDep(item: Record<string, unknown>): boolean {
    const depField = item['custcol_is_dep'] ?? item['is_dep'] ?? item['isdep'] ?? false;
    
    if (typeof depField === 'boolean') {
      return depField;
    }
    
    if (typeof depField === 'string') {
      return depField.toLowerCase() === 'true' || depField === '1' || depField.toLowerCase() === 'yes';
    }
    
    return Boolean(depField);
  }
}

