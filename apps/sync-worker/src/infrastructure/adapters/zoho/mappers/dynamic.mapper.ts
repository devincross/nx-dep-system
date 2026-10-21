import {
  MapperPort,
  RawAccountData,
  RawOrderData,
} from '../../../../domain/ports/data-source.port.js';
import {
  AccountEntity,
  OrderEntity,
  OrderItemEntity,
} from '../../../../domain/entities/index.js';
import { resolveFieldPath, resolveFieldPathAsString } from './field-path.util.js';

/**
 * Configuration for dynamic field mappings.
 * Each value is the Zoho field name (or dot-notation path) to read from.
 */
export interface FieldMappingsConfig {
  account?: {
    externalAccountId?: string;
    name?: string;
    depAccountId?: string;
  };
  order?: {
    externalOrderId?: string;
    externalAccountId?: string;
    externalOrderStatus?: string;
    isDep?: string;
    po?: string;
    depOrderId?: string;
    depOrderedAt?: string;
    depShippedAt?: string;
  };
  orderItems?: {
    /** Field on the order record that contains the line items array */
    sourceField?: string;
    /** Field on each line item that contains serial numbers (comma/newline delimited) */
    serialNumbers?: string;
    /** Field on each line item that indicates DEP eligibility */
    isDep?: string;
  };
  /** Custom truthy string values for boolean parsing (default: ['true', '1', 'yes']) */
  truthyValues?: string[];
}

const DEFAULT_TRUTHY_VALUES = ['true', '1', 'yes'];

const DEFAULT_CONFIG: Required<FieldMappingsConfig> = {
  account: {
    externalAccountId: 'id',
    name: 'Account_Name',
    depAccountId: 'DEP_Account_ID',
  },
  order: {
    externalOrderId: 'id',
    externalAccountId: 'Account_Name.id',
    externalOrderStatus: 'Status',
    isDep: 'Is_DEP',
    po: 'PO_Number',
    depOrderId: 'DEP_Order_ID',
    depOrderedAt: 'DEP_Ordered_At',
    depShippedAt: 'DEP_Shipped_At',
  },
  orderItems: {
    // Zoho integrations typically store serials in a top-level, delimited field
    // on the order (no line-item subform); mapOrderItems falls back to the
    // record root when sourceField isn't an array. The field NAME is
    // tenant-specific — set orderItems.serialNumbers in the tenant's
    // field_mappings (e.g. Duke uses 'Apple_Serial_Number').
    sourceField: 'Product_Details',
    serialNumbers: 'Serial_Numbers',
    isDep: 'Is_DEP',
  },
  truthyValues: DEFAULT_TRUTHY_VALUES,
};

const rootField = (p?: string): string => (p ? p.split('.')[0] : '');

/**
 * Top-level Zoho field api_names a Zoho ORDER mapper reads, for the Get Records
 * `fields` param. Dot-paths (e.g. Account_Name.id) are reduced to the root
 * field. Lets the fetch request exactly what the mapper needs so the 50-field
 * cap can't silently drop Status / Account_Name / the serial field / etc.
 */
export function zohoOrderFieldNames(config?: FieldMappingsConfig): string[] {
  const order = { ...DEFAULT_CONFIG.order, ...config?.order };
  const items = { ...DEFAULT_CONFIG.orderItems, ...config?.orderItems };
  return [
    ...new Set(
      [
        rootField(order.externalOrderId),
        rootField(order.externalAccountId),
        rootField(order.externalOrderStatus),
        rootField(order.isDep),
        rootField(order.po),
        rootField(order.depOrderId),
        rootField(order.depOrderedAt),
        rootField(order.depShippedAt),
        rootField(items.sourceField),
        rootField(items.serialNumbers),
      ].filter(Boolean),
    ),
  ];
}

/** Top-level Zoho field api_names a Zoho ACCOUNT mapper reads. */
export function zohoAccountFieldNames(config?: FieldMappingsConfig): string[] {
  const account = { ...DEFAULT_CONFIG.account, ...config?.account };
  return [
    ...new Set(
      [
        rootField(account.externalAccountId),
        rootField(account.name),
        rootField(account.depAccountId),
      ].filter(Boolean),
    ),
  ];
}

/**
 * Config-driven Zoho mapper.
 *
 * Instantiated at runtime with a tenant's field_mappings config.
 * With no config (or empty config), behaviour is identical to ZohoBaseMapper.
 */
export class DynamicZohoMapper implements MapperPort {
  private readonly accountCfg: Required<NonNullable<FieldMappingsConfig['account']>>;
  private readonly orderCfg: Required<NonNullable<FieldMappingsConfig['order']>>;
  private readonly itemsCfg: Required<NonNullable<FieldMappingsConfig['orderItems']>>;
  private readonly truthyValues: string[];

  constructor(config?: FieldMappingsConfig) {
    this.accountCfg = { ...DEFAULT_CONFIG.account, ...config?.account } as Required<NonNullable<FieldMappingsConfig['account']>>;
    this.orderCfg = { ...DEFAULT_CONFIG.order, ...config?.order } as Required<NonNullable<FieldMappingsConfig['order']>>;
    this.itemsCfg = { ...DEFAULT_CONFIG.orderItems, ...config?.orderItems } as Required<NonNullable<FieldMappingsConfig['orderItems']>>;
    this.truthyValues = config?.truthyValues ?? DEFAULT_CONFIG.truthyValues;
  }

  getIdentifier(): string {
    return 'zoho-dynamic';
  }

  mapAccount(raw: RawAccountData): AccountEntity {
    const depAccountId = resolveFieldPath(raw, this.accountCfg.depAccountId);

    return {
      externalAccountId: resolveFieldPathAsString(raw, this.accountCfg.externalAccountId),
      name: resolveFieldPathAsString(raw, this.accountCfg.name),
      depAccountId: depAccountId ? String(depAccountId) : undefined,
    };
  }

  mapOrder(raw: RawOrderData): OrderEntity {
    this.assertSerialFieldFetched(raw);
    return {
      externalOrderId: resolveFieldPathAsString(raw, this.orderCfg.externalOrderId),
      externalAccountId: resolveFieldPathAsString(raw, this.orderCfg.externalAccountId),
      externalOrderStatus: resolveFieldPath(raw, this.orderCfg.externalOrderStatus)
        ? resolveFieldPathAsString(raw, this.orderCfg.externalOrderStatus)
        : undefined,
      isDep: this.parseTruthy(resolveFieldPath(raw, this.orderCfg.isDep)),
      po: resolveFieldPath(raw, this.orderCfg.po)
        ? resolveFieldPathAsString(raw, this.orderCfg.po)
        : undefined,
      items: this.mapOrderItems(raw),
      source: 'zoho',
      depOrderId: resolveFieldPath(raw, this.orderCfg.depOrderId)
        ? resolveFieldPathAsString(raw, this.orderCfg.depOrderId)
        : undefined,
      depOrderedAt: resolveFieldPath(raw, this.orderCfg.depOrderedAt)
        ? new Date(resolveFieldPathAsString(raw, this.orderCfg.depOrderedAt))
        : undefined,
      depShippedAt: resolveFieldPath(raw, this.orderCfg.depShippedAt)
        ? new Date(resolveFieldPathAsString(raw, this.orderCfg.depShippedAt))
        : undefined,
    };
  }

  // ------- private helpers -------

  /**
   * Guard against an incomplete fetch silently wiping serials.
   *
   * Zoho's Get Records returns every requested field as a present key (null
   * when the order has no value), so a genuinely empty or fully-returned
   * order still carries the serial field key — only a fetch that never
   * returned the field at all (lost ZohoCRM.settings.fields.READ scope, a
   * field-list cap, a renamed field) omits it. If we mapped such a record
   * we'd read zero serials and the order-item reconciliation would
   * soft-delete every serial on the order as "removed". Refuse the record
   * instead: the use case counts it errored (so the run is marked failed and
   * the incremental watermark doesn't advance) and the stored serials are
   * left untouched. A present-but-empty serial field still maps normally,
   * so legitimate full/partial returns continue to remove serials.
   */
  private assertSerialFieldFetched(raw: RawOrderData): void {
    const present = (path: string): boolean =>
      Object.prototype.hasOwnProperty.call(raw, rootField(path));

    // Serials live either in the subform (sourceField) or a scalar field
    // (serialNumbers); a healthy record carries whichever the tenant uses.
    if (present(this.itemsCfg.sourceField) || present(this.itemsCfg.serialNumbers)) {
      return;
    }

    const orderId = resolveFieldPathAsString(raw, this.orderCfg.externalOrderId) || '(unknown id)';
    throw new Error(
      `Zoho order ${orderId} returned without its serial field ` +
      `(neither '${this.itemsCfg.sourceField}' nor '${this.itemsCfg.serialNumbers}' was present). ` +
      `Refusing to sync an incomplete record so its serials aren't wrongly removed — ` +
      `check the Zoho token's field-read scope and the order field mappings.`,
    );
  }

  private mapOrderItems(raw: RawOrderData): OrderItemEntity[] {
    const rawItems = resolveFieldPath(raw, this.itemsCfg.sourceField);

    // Subform line items: an array of rows under sourceField.
    if (Array.isArray(rawItems)) {
      const items: OrderItemEntity[] = [];
      for (const rawItem of rawItems) {
        const item = rawItem as Record<string, unknown>;
        for (const serialNumber of this.extractSerialNumbers(item)) {
          items.push({
            serialNumber,
            isDep: this.resolveItemIsDep(item),
            depStatus: 'pending',
          });
        }
      }
      return items;
    }

    // No subform: the serial(s) live in a scalar field on the order record
    // itself (e.g. Duke's top-level Apple_Serial_Number). Read them from the
    // record root — one order, one (or a few delimited) serial(s).
    return this.extractSerialNumbers(raw).map((serialNumber) => ({
      serialNumber,
      isDep: this.resolveItemIsDep(raw),
      depStatus: 'pending',
    }));
  }

  /**
   * A serial that's present is DEP-eligible by default. Respect an explicit
   * DEP flag when the record actually carries one; otherwise default to true —
   * Zoho integrations generally have no per-item DEP field, and a listed Apple
   * serial is a device to enroll.
   */
  private resolveItemIsDep(container: Record<string, unknown>): boolean {
    const val = resolveFieldPath(container, this.itemsCfg.isDep);
    return val == null ? true : this.parseTruthy(val);
  }

  private extractSerialNumbers(item: Record<string, unknown>): string[] {
    const serialField = resolveFieldPath(item, this.itemsCfg.serialNumbers);

    if (!serialField) {
      return [];
    }

    // Split by common delimiters and strip leading 'S' prefix
    return String(serialField)
      .split(/[,;\n\r]+/)
      .map((s) => s.trim())
      .map((s) => s.startsWith('S') ? s.slice(1) : s)
      .filter((s) => s.length > 0);
  }

  private parseTruthy(value: unknown): boolean {
    if (typeof value === 'boolean') return value;

    if (typeof value === 'string') {
      return this.truthyValues.some(
        (tv) => tv.toLowerCase() === value.toLowerCase(),
      );
    }

    return Boolean(value);
  }
}
