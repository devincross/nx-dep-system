import { Injectable } from '@nestjs/common';
import { MapperPort, RawAccountData, RawOrderData } from '../../../../domain/ports/data-source.port.js';
import { AccountEntity, OrderEntity, OrderItemEntity } from '../../../../domain/entities/index.js';
import { RegisterMapper } from '../../mapper-registry.js';

/**
 * BYU-specific mapper
 * Maps BYU's custom API response format to domain entities
 */
@Injectable()
@RegisterMapper('byu')
export class ByuMapper implements MapperPort {
  getIdentifier(): string {
    return 'byu';
  }

  mapAccount(raw: RawAccountData): AccountEntity {
    return {
      externalAccountId: String(raw['account_id'] ?? ''),
      name: String(raw['name'] ?? ''),
      depAccountId: raw['dep_id']
        ? String(raw['dep_id'])
        : undefined,
    };
  }

  mapOrder(raw: RawOrderData): OrderEntity {
    const products = (raw['products'] ?? []) as Array<Record<string, unknown>>;
    const items = this.mapOrderItems(products);
    const isDep = products.some((p) => Boolean(p['is_dep']));

    return {
      externalOrderId: String(raw['order_id'] ?? ''),
      externalAccountId: String(raw['account_id'] ?? ''),
      externalOrderStatus: raw['transaction_type']
        ? String(raw['transaction_type'])
        : undefined,
      isDep,
      po: raw['po'] ? String(raw['po']) : undefined,
      items,
      source: 'byu',
      depOrderId: String(raw['order_id'] ?? ''),
      depOrderedAt: raw['date_created']
        ? new Date(String(raw['date_created']))
        : undefined,
    };
  }

  private mapOrderItems(
    products: Array<Record<string, unknown>>,
  ): OrderItemEntity[] {
    const items: OrderItemEntity[] = [];

    for (const product of products) {
      const serial = product['serial'] ? String(product['serial']).trim() : '';

      if (!serial) {
        continue;
      }

      items.push({
        serialNumber: serial,
        isDep: Boolean(product['is_dep']),
        depStatus: 'pending',
      });
    }

    return items;
  }
}
