import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { Order } from './entities/order.entity';
import { Delivery } from './entities/delivery.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { ProductsService } from '../products/products.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { TERMINAL_STATES, VALID_TRANSITIONS } from './constants/order-transitions';
import { OrderStatus } from '../../common/enums/order-status.enum';
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
    private readonly productsService: ProductsService,
    private readonly sseService: OrdersSseService,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateOrderDto, tenantId: string): Promise<OrderResponseDto> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

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
      customer.phone = dto.customer.phone ?? null;
      customer.address = dto.customer.address ?? null;

      let delivery: Delivery | null = null;
      if (!dto.storePickup) {
        if (!dto.delivery) {
          throw new BadRequestException('Delivery requerido cuando no es retiro en tienda');
        }
        delivery = new Delivery();
        delivery.address = dto.delivery.address;
        delivery.notes = dto.delivery.notes ?? null;
        // Snapshot del costo del tenant al momento del pedido
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
      order.storePickup = dto.storePickup;
      order.customer = customer;
      order.delivery = delivery;
      order.items = items;

      const saved = await manager.getRepository(Order).save(order);
      return this.toResponse(saved);
    });
  }

  async findAll(tenantId: string): Promise<OrderResponseDto[]> {
    const orders = await this.orderRepo.find({
      where: { tenantId },
      relations: { items: true, customer: true, delivery: true },
      order: { createdAt: 'DESC' },
    });
    return orders.map(o => this.toResponse(o));
  }

  async findOne(id: string, tenantId: string): Promise<OrderResponseDto> {
    const order = await this.orderRepo.findOne({
      where: { id, tenantId },
      relations: { items: true, customer: true, delivery: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
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
    const order = await this.orderRepo.findOne({ where: { id, tenantId }, relations: { items: true, customer: true, delivery: true } });
    if (!order) throw new NotFoundException('Pedido no encontrado');

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

  private toResponse(order: Order): OrderResponseDto {
    return {
      id: order.id,
      tenantId: order.tenantId,
      status: order.status,
      trackingUuid: order.trackingUuid,
      cancellationReason: order.cancellationReason ?? null,
      total: Number(order.total),
      paymentMethod: order.paymentMethod,
      storePickup: order.storePickup,
      customer: {
        id: order.customer?.id,
        name: order.customer?.name,
        phone: order.customer?.phone ?? null,
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