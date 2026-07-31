import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, Between, Not } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { Order } from './entities/order.entity';
import { Delivery } from './entities/delivery.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { ProductsService } from '../products/products.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { StatsResponseDto } from './dto/stats-response.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { TERMINAL_STATES, VALID_TRANSITIONS } from './constants/order-transitions';
import { OrderStatus } from '../../common/enums/order-status.enum';
import { DeliveryType } from '../../common/enums/delivery-type.enum';
import { PaymentMethod } from '../../common/enums/payment-method.enum';
import { OrderItem } from './entities/order-item.entity';
import { Customer } from './entities/customer.entity';
import { OrdersSseService } from './orders-sse.service';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    private readonly productsService: ProductsService,
    private readonly sseService: OrdersSseService,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateOrderDto, tenantId: string): Promise<OrderResponseDto> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    if (
      dto.deliveryType === DeliveryType.ENVIO_DOMICILIO &&
      dto.paymentMethod === PaymentMethod.TARJETA_DEBITO
    ) {
      throw new BadRequestException(
        'No se puede pagar con tarjeta de débito en envío a domicilio. Elegí efectivo o transferencia.',
      );
    }

    return this.dataSource.transaction(async manager => {
      // Snapshot de productos
      const items = await Promise.all(
        dto.items.map(async itemDto => {
          // Delega a ProductsService — centraliza lógica y resuelve el isActive
          const product = await this.productsService.findOneForOrder(itemDto.productId, tenantId);
          const item = new OrderItem();
          item.productId = product.id;
          item.name = product.name;
          item.price = product.price;
          item.quantity = itemDto.quantity;
          return item;
        }),
      );

      const customer = new Customer();
      customer.name = dto.customer.name;
      customer.phone = dto.customer.phone;
      customer.address = dto.customer.address ?? null;

      let delivery: Delivery | null = null;
      if (dto.deliveryType === DeliveryType.ENVIO_DOMICILIO) {
        delivery = new Delivery();
        delivery.address = dto.address!;
        delivery.notes = dto.deliveryNotes ?? null;
        delivery.deliveryFee = tenant.deliveryCostEnabled
          ? Number(tenant.deliveryCost)
          : null;
      }

      const total = items.reduce(
        (sum, item) => sum + Number(item.price) * item.quantity,
        0,
      );

      const order = new Order();
      order.tenantId = tenantId;
      order.status = OrderStatus.PENDIENTE;
      order.trackingUuid = uuid();
      order.cancellationReason = null;
      order.total = total;
      order.paymentMethod = dto.paymentMethod;
      order.deliveryType = dto.deliveryType;
      order.customer = customer;
      order.delivery = delivery;
      order.items = items;
      order.notes = dto.notes ?? null;

      const saved = await manager.getRepository(Order).save(order);
      return this.toResponse(saved);
    });
  }

  async findAll(tenantId: string, pagination?: PaginationDto): Promise<PaginatedResult<OrderResponseDto>> {
    const { page = 1, limit = 10 } = pagination ?? {};
    const [orders, total] = await this.orderRepo.findAndCount({
      where: { tenantId },
      relations: { items: true, customer: true, delivery: true },
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return {
      data: orders.map(o => this.toResponse(o)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, tenantId: string): Promise<OrderResponseDto> {
    const order = await this.findOneOrFail(id, tenantId, {
      items: true, customer: true, delivery: true,
    });
    return this.toResponse(order);
  }

  async findByTracking(trackingUuid: string, tenantId: string): Promise<OrderResponseDto> {
    const order = await this.orderRepo.findOne({
      where: { trackingUuid, tenantId },
      relations: { items: true, customer: true, delivery: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return this.toResponse(order);
  }

  async updateStatus(
    id: string,
    tenantId: string,
    newStatus: OrderStatus,
    cancellationReason?: string,
  ): Promise<OrderResponseDto> {
    const order = await this.findOneOrFail(id, tenantId, {
      items: true, customer: true, delivery: true,
    });

    const allowed = VALID_TRANSITIONS[order.status];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(`Transición inválida: ${order.status} → ${newStatus}`);
    }

    order.status = newStatus;
    order.cancellationReason =
      newStatus === OrderStatus.CANCELADO ? (cancellationReason ?? null) : null;

    const saved = await this.orderRepo.save(order);

    this.sseService.emit(saved.trackingUuid, saved.status);
    if (TERMINAL_STATES.includes(saved.status)) {
      this.sseService.close(saved.trackingUuid);
    }

    return this.toResponse(saved);
  }

  async getWhatsAppLink(
    id: string,
    tenantId: string,
  ): Promise<{ url: string; message: string }> {
    const order = await this.findOneOrFail(id, tenantId, {
      customer: true,
    });

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const customerPhone = order.customer?.phone;
    if (!customerPhone) {
      throw new BadRequestException('El cliente no tiene teléfono registrado');
    }

    const statusLabels: Record<string, string> = {
      PENDIENTE: 'pendiente',
      EN_PREPARACION: 'en preparación',
      LISTO: 'listo para retirar',
      ENTREGADO: 'entregado',
      CANCELADO: 'cancelado',
      NO_RETIRADO: 'no retirado',
    };

    const message = `¡Hola! Tu pedido en ${tenant?.name ?? 'el local'} está ${statusLabels[order.status] ?? order.status}. Seguilo acá: https://tuapp.com/${tenant?.slug ?? ''}/pedido/${order.trackingUuid}`;
    const encoded = encodeURIComponent(message);
    const phone = customerPhone.replace(/[^\d]/g, '');
    return { url: `https://wa.me/${phone}?text=${encoded}`, message };
  }

  async updateCustomerPhone(
    trackingUuid: string,
    tenantId: string,
    phone: string,
  ): Promise<{ phone: string }> {
    const order = await this.orderRepo.findOne({
      where: { trackingUuid, tenantId },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');

    const customer = await this.customerRepo.findOne({
      where: { id: order.customerId },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');

    customer.phone = phone;
    await this.customerRepo.save(customer);
    return { phone };
  }

  async getStats(tenantId: string): Promise<StatsResponseDto> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [ordersToday, pendingOrders, todayOrders] = await Promise.all([
      this.orderRepo.count({
        where: { tenantId, createdAt: Between(todayStart, todayEnd) },
      }),
      this.orderRepo.count({
        where: { tenantId, status: OrderStatus.PENDIENTE },
      }),
      this.orderRepo.find({
        where: {
          tenantId,
          createdAt: Between(todayStart, todayEnd),
          status: Not(OrderStatus.CANCELADO),
        },
      }),
    ]);

    const revenueToday = todayOrders.reduce(
      (sum, o) => sum + Number(o.total),
      0,
    );

    return { ordersToday, revenueToday, pendingOrders };
  }

  private async findOneOrFail(
    id: string,
    tenantId: string,
    relations: Record<string, boolean> = {},
  ): Promise<Order> {
    const order = await this.orderRepo.findOne({
      where: { id, tenantId },
      relations,
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return order;
  }

  private toResponse(order: Order): OrderResponseDto {
    return {
      id: order.id,
      tenantId: order.tenantId,
      status: order.status,
      trackingUuid: order.trackingUuid,
      cancellationReason: order.cancellationReason ?? null,
      total: Number(order.total),
      paymentMethod: order.paymentMethod,
      deliveryType: order.deliveryType,
      notes: order.notes ?? null,
      customer: {
        id: order.customer?.id,
        name: order.customer?.name,
        phone: order.customer.phone,
        address: order.customer?.address ?? null,
      },
      delivery: order.delivery ? {
        id: order.delivery.id,
        address: order.delivery.address,
        notes: order.delivery.notes ?? null,
        deliveryFee: order.delivery.deliveryFee !== null
          ? Number(order.delivery.deliveryFee)
          : null,
      } : null,
      items: (order.items ?? []).map(item => ({
        id: item.id,
        productId: item.productId,
        name: item.name,
        price: Number(item.price),
        quantity: item.quantity,
      })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}