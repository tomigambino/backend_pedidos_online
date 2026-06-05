import { OrderStatus } from '../../../common/enums/order-status.enum';
import { PaymentMethod } from '../../../common/enums/payment-method.enum';
import { CustomerResponseDto } from './customer-response.dto';
import { DeliveryResponseDto } from './delivery-response.dto';
import { OrderItemResponseDto } from './order-item-response.dto';

export class OrderResponseDto {
  id: string;
  tenantId: string;
  status: OrderStatus;
  trackingUuid: string;
  cancellationReason: string | null;
  total: number;
  paymentMethod: PaymentMethod;
  storePickup: boolean;
  customer: CustomerResponseDto;
  delivery: DeliveryResponseDto | null;
  items: OrderItemResponseDto[];
  createdAt: Date;
  updatedAt: Date;
}
