/**
 * Zoho Get Records `fields` helpers. The API caps `fields` at 50, so blindly
 * taking the first 50 a module returns can drop a field the mapper needs
 * (e.g. Status). These compute the fields the mapper actually reads and build a
 * request that always includes them.
 */

export interface ZohoFieldMappings {
  account?: Record<string, string>;
  order?: Record<string, string>;
  orderItems?: Record<string, string>;
}

const MAX_FIELDS = 50;
const root = (p?: string): string => (p ? p.split('.')[0] : '');
const uniq = (xs: string[]): string[] => [...new Set(xs.filter(Boolean))];

/** Top-level field api_names an order mapper reads (dot-paths reduced to root). */
export function zohoOrderFieldNames(fm?: ZohoFieldMappings): string[] {
  const order = {
    externalOrderId: 'id',
    externalAccountId: 'Account_Name.id',
    externalOrderStatus: 'Status',
    isDep: 'Is_DEP',
    po: 'PO_Number',
    depOrderId: 'DEP_Order_ID',
    depOrderedAt: 'DEP_Ordered_At',
    depShippedAt: 'DEP_Shipped_At',
    ...fm?.order,
  };
  const items = { sourceField: 'Product_Details', serialNumbers: 'Serial_Numbers', ...fm?.orderItems };
  return uniq(
    [
      order.externalOrderId,
      order.externalAccountId,
      order.externalOrderStatus,
      order.isDep,
      order.po,
      order.depOrderId,
      order.depOrderedAt,
      order.depShippedAt,
      items.sourceField,
      items.serialNumbers,
    ].map(root),
  );
}

/** Top-level field api_names an account mapper reads. */
export function zohoAccountFieldNames(fm?: ZohoFieldMappings): string[] {
  const account = { externalAccountId: 'id', name: 'Account_Name', depAccountId: 'DEP_Account_ID', ...fm?.account };
  return uniq([account.externalAccountId, account.name, account.depAccountId].map(root));
}

/**
 * Build the `fields` value: the needed fields that exist on the module come
 * first (so the 50-cap can never drop them), then the rest of the module's
 * fields fill the remaining slots (keeps the test portal's full-ish view and
 * future field discovery). Falls back to 'id' when metadata is unavailable.
 */
export function pickFields(needed: string[], existing: Set<string>, max = MAX_FIELDS): string {
  if (existing.size === 0) return 'id';
  const result: string[] = [];
  const add = (n: string) => {
    if (existing.has(n) && !result.includes(n) && result.length < max) result.push(n);
  };
  add('id');
  for (const n of needed) add(n);
  for (const n of existing) add(n); // fill remaining slots
  return result.length ? result.join(',') : 'id';
}
