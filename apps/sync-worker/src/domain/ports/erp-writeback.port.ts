/**
 * Minimal surface for pushing a resolved DEP outcome back to the source ERP
 * (NetSuite or Zoho). Both adapters implement it, so the schedulers can route
 * the write-back to whichever ERP a tenant is connected to.
 */
export interface ErpOrderWriteback {
  updateOrderDepStatus(
    externalOrderId: string,
    depResponse: string,
    depStatus: string,
  ): Promise<void>;
}
