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
    sourceField: 'Product_Details',
    serialNumbers: 'Serial_Numbers',
    isDep: 'Is_DEP',
  },
  truthyValues: DEFAULT_TRUTHY_VALUES,
};

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
    this.accountCfg = { ...DEFAULT_CONFIG.account, ...config?.account };
    this.orderCfg = { ...DEFAULT_CONFIG.order, ...config?.order };
    this.itemsCfg = { ...DEFAULT_CONFIG.orderItems, ...config?.orderItems };
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

  private mapOrderItems(raw: RawOrderData): OrderItemEntity[] {
    const rawItems = resolveFieldPath(raw, this.itemsCfg.sourceField);

    if (!Array.isArray(rawItems)) {
      return [];
    }

    const items: OrderItemEntity[] = [];

    for (const rawItem of rawItems) {
      const item = rawItem as Record<string, unknown>;
      const serialNumbers = this.extractSerialNumbers(item);

      for (const serialNumber of serialNumbers) {
        items.push({
          serialNumber,
          isDep: this.parseTruthy(resolveFieldPath(item, this.itemsCfg.isDep)),
          depStatus: 'pending',
        });
      }
    }

    return items;
  }

  private extractSerialNumbers(item: Record<string, unknown>): string[] {
    const serialField = resolveFieldPath(item, this.itemsCfg.serialNumbers);

    if (!serialField) {
      return [];
    }

    return String(serialField)
      .split(/[,;\n\r]+/)
      .map((s) => s.trim())
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
