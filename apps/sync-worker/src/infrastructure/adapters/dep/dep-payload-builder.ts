/**
 * Builds Apple DEP API request payloads from our internal order data.
 */

export type DepOrderType = 'OR' | 'RE' | 'VD' | 'OV';

export interface DepRequestContext {
  shipTo: string;
  timeZone: string;
  langCode: string;
}

export interface DepDevice {
  deviceId: string;
  assetTag?: string;
}

export interface DepDelivery {
  deliveryNumber: string;
  shipDate: string;
  devices: DepDevice[];
}

export interface DepOrder {
  orderNumber: string;
  orderDate: string;
  orderType: DepOrderType;
  customerId: string;
  poNumber?: string;
  deliveries?: DepDelivery[];
}

export interface BulkEnrollRequest {
  requestContext: DepRequestContext;
  transactionId: string;
  depResellerId: string;
  orders: DepOrder[];
}

export interface CheckTransactionStatusRequest {
  requestContext: DepRequestContext;
  depResellerId: string;
  deviceEnrollmentTransactionId: string;
}

export interface ShowOrderDetailsRequest {
  requestContext: DepRequestContext;
  depResellerId: string;
  orderNumbers: string[];
}

export interface DepConfig {
  shipTo: string;
  depResellerId: string;
  apiUrl: string;
  timeZone?: string;
  langCode?: string;
}

export interface OrderEnrollmentData {
  orderNumber: string;
  orderDate: string;
  orderType: DepOrderType;
  customerId: string;
  poNumber?: string;
  deliveries: {
    deliveryNumber: string;
    shipDate: string;
    devices: { serialNumber: string; assetTag?: string }[];
  }[];
}

/**
 * Builds Apple DEP API request payloads.
 */
export class DepPayloadBuilder {
  private readonly config: DepConfig;

  constructor(config: DepConfig) {
    this.config = config;
  }

  private buildContext(): DepRequestContext {
    return {
      shipTo: this.config.shipTo,
      timeZone: this.config.timeZone || '420',
      langCode: this.config.langCode || 'en',
    };
  }

  /**
   * Build a Bulk Enroll Devices request for enrolling (OR), returning (RE), or overriding (OV).
   */
  buildBulkEnrollRequest(
    transactionId: string,
    orders: OrderEnrollmentData[],
  ): BulkEnrollRequest {
    return {
      requestContext: this.buildContext(),
      transactionId,
      depResellerId: this.config.depResellerId,
      orders: orders.map((order) => {
        const depOrder: DepOrder = {
          orderNumber: order.orderNumber,
          orderDate: order.orderDate,
          orderType: order.orderType,
          customerId: order.customerId,
          poNumber: order.poNumber,
        };

        // VD (void) must NOT have deliveries
        if (order.orderType !== 'VD') {
          depOrder.deliveries = order.deliveries.map((del) => ({
            deliveryNumber: del.deliveryNumber,
            shipDate: del.shipDate,
            devices: del.devices.map((d) => ({
              deviceId: d.serialNumber,
              assetTag: d.assetTag,
            })),
          }));
        }

        return depOrder;
      }),
    };
  }

  /**
   * Build a Void (VD) request for an order.
   */
  buildVoidRequest(
    transactionId: string,
    orderNumber: string,
    orderDate: string,
    customerId: string,
    poNumber?: string,
  ): BulkEnrollRequest {
    return {
      requestContext: this.buildContext(),
      transactionId,
      depResellerId: this.config.depResellerId,
      orders: [
        {
          orderNumber,
          orderDate,
          orderType: 'VD',
          customerId,
          poNumber,
        },
      ],
    };
  }

  /**
   * Build a Check Transaction Status request.
   */
  buildCheckStatusRequest(
    deviceEnrollmentTransactionId: string,
  ): CheckTransactionStatusRequest {
    return {
      requestContext: this.buildContext(),
      depResellerId: this.config.depResellerId,
      deviceEnrollmentTransactionId,
    };
  }

  /**
   * Build a Show Order Details request.
   */
  buildShowOrderDetailsRequest(
    orderNumbers: string[],
  ): ShowOrderDetailsRequest {
    return {
      requestContext: this.buildContext(),
      depResellerId: this.config.depResellerId,
      orderNumbers,
    };
  }
}
