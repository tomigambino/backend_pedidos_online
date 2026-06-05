import { OrderStatus } from '../../../common/enums/order-status.enum';

export const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDIENTE]: [OrderStatus.EN_PREPARACION, OrderStatus.CANCELADO],
  [OrderStatus.EN_PREPARACION]: [OrderStatus.LISTO, OrderStatus.CANCELADO],
  [OrderStatus.LISTO]: [OrderStatus.ENTREGADO, OrderStatus.NO_RETIRADO],
  [OrderStatus.ENTREGADO]: [],
  [OrderStatus.CANCELADO]: [],
  [OrderStatus.NO_RETIRADO]: [],
};

export const TERMINAL_STATES = [
  OrderStatus.ENTREGADO,
  OrderStatus.CANCELADO,
  OrderStatus.NO_RETIRADO,
];
