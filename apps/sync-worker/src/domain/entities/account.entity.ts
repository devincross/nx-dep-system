/**
 * Account domain entity
 * Represents a customer account from external systems (NetSuite/Zoho)
 */
export interface AccountEntity {
  /** External account ID from the source system */
  externalAccountId: string;
  
  /** Account name */
  name: string;
  
  /** DEP enrollment account ID (if enrolled) */
  depAccountId?: string;
}

/**
 * Account with internal ID after persistence
 */
export interface PersistedAccountEntity extends AccountEntity {
  /** Internal database ID */
  id: number;
  
  /** Created timestamp */
  createdAt: Date;
  
  /** Updated timestamp */
  updatedAt: Date;
}

