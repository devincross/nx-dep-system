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
    this.assertSerialFieldFetched(raw);
    const items = this.mapOrderItems(raw);

    return {
      externalOrderId: String(raw['id'] ?? raw['Id'] ?? raw['SO_Number'] ?? ''),
      externalAccountId: String(
        (raw['Account_Name'] as { id?: unknown })?.id ??
        raw['Account_Name'] ??
        raw['account_id'] ??
        ''
      ),
      externalOrderStatus: raw['Status'] ? String(raw['Status']) : undefined,
      isDep: this.determineIsDep(raw),
      po: raw['PO_Number'] ? String(raw['PO_Number']) : undefined,
      items,
      source: 'zoho',
      depOrderId: raw['DEP_Order_ID'] ? String(raw['DEP_Order_ID']) : undefined,
      depOrderedAt: raw['DEP_Ordered_At'] ? new Date(String(raw['DEP_Ordered_At'])) : undefined,
      depShippedAt: raw['DEP_Shipped_At'] ? new Date(String(raw['DEP_Shipped_At'])) : undefined,
    };
  }

  /**
   * Guard against an incomplete fetch silently wiping serials. Zoho returns
   * every requested field as a present key (null when empty), so a genuinely
   * empty or fully-returned order still carries a serial field; a record
   * missing every serial field was never fully fetched (lost field-read
   * scope, a field-list cap, a rename). Mapping it would read zero serials
   * and the reconciliation would soft-delete every serial as "removed", so
   * refuse it instead — the use case counts it errored and leaves the
   * stored serials intact.
   */
  protected assertSerialFieldFetched(raw: RawOrderData): void {
    const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(raw, key);
    if (has('Product_Details') || has('Ordered_Items') || has('Serial_Numbers') || has('Serials')) {
      return;
    }
    const orderId = String(raw['id'] ?? raw['Id'] ?? raw['SO_Number'] ?? '(unknown id)');
    throw new Error(
      `Zoho order ${orderId} returned without a serial field ` +
      `(none of Product_Details / Ordered_Items / Serial_Numbers / Serials present). ` +
      `Refusing to sync an incomplete record so its serials aren't wrongly removed — ` +
      `check the Zoho token's field-read scope.`,
    );
  }

  /**
   * Map order items/line items from raw data
   */
  protected mapOrderItems(raw: RawOrderData): OrderItemEntity[] {
    const items: OrderItemEntity[] = [];

    // Subform line items if present (Product_Details), otherwise the order
    // record itself — Zoho integrations store serials in a top-level, delimited
    // field (e.g. Apple_Serial_Number), not a line-item subform.
    const rawItems = raw['Product_Details'] ?? raw['Ordered_Items'];
    const containers = Array.isArray(rawItems)
      ? (rawItems as Record<string, unknown>[])
      : [raw as Record<string, unknown>];

    for (const container of containers) {
      for (const serialNumber of this.extractSerialNumbers(container)) {
        items.push({
          serialNumber,
          isDep: this.determineItemIsDep(container),
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
    
    // Split by common delimiters and strip leading 'S' prefix
    return serialStr
      .split(/[,;\n\r]+/)
      .map(s => s.trim())
      .map(s => s.startsWith('S') ? s.slice(1) : s)
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
    const depField = item['Is_DEP'] ?? item['DEP_Eligible'];

    // No DEP flag on the record → a listed serial is DEP-eligible by default.
    if (depField == null) {
      return true;
    }

    if (typeof depField === 'boolean') {
      return depField;
    }

    if (typeof depField === 'string') {
      return depField.toLowerCase() === 'true' || depField === '1' || depField.toLowerCase() === 'yes';
    }

    return Boolean(depField);
  }
}

