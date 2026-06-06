import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable, concat, defer } from 'rxjs';
import { map, takeWhile } from 'rxjs/operators';
import { OrdersService } from './orders.service';
import { OrdersSseService } from './orders-sse.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateCustomerPhoneDto } from './dto/update-customer-phone.dto';
import { TERMINAL_STATES } from './constants/order-transitions';
import { OrderStatus } from '../../common/enums/order-status.enum';

@Controller(':tenant/orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly sseService: OrdersSseService,
  ) {}

  @Post()
  create(@Body() dto: CreateOrderDto, @TenantId() tenantId: string) {
    return this.ordersService.create(dto, tenantId);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@TenantId() tenantId: string) {
    return this.ordersService.findAll(tenantId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.ordersService.findOne(id, tenantId);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(
      id,
      tenantId,
      dto.status,
      dto.cancellationReason,
    );
  }

  @Get(':uuid/track')
  track(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @TenantId() tenantId: string,
  ) {
    return this.ordersService.findByTracking(uuid, tenantId);
  }

  @Get('admin/stats')
  @UseGuards(JwtAuthGuard)
  stats(@TenantId() tenantId: string) {
    return this.ordersService.getStats(tenantId);
  }

  @Get(':id/whatsapp-link')
  @UseGuards(JwtAuthGuard)
  whatsappLink(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.ordersService.getWhatsAppLink(id, tenantId);
  }

  @Patch(':uuid/customer/phone')
  updatePhone(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @TenantId() tenantId: string,
    @Body() dto: UpdateCustomerPhoneDto,
  ) {
    return this.ordersService.updateCustomerPhone(uuid, tenantId, dto.phone);
  }

  // Público — sin JwtAuthGuard
  @Sse(':uuid/status-stream')
  statusStream(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @TenantId() tenantId: string,
  ): Observable<MessageEvent> {
    // defer para que la consulta ocurra en el momento de suscripción
    const initial$ = defer(async () => {
      const order = await this.ordersService.findByTracking(uuid, tenantId);
      return order.status;
    });

    const updates$ = this.sseService.getOrCreate(uuid).asObservable();

    return concat(initial$, updates$).pipe(
      map(status => ({ data: status }) as MessageEvent),
      // Completa automáticamente al llegar a estado terminal
      takeWhile(event => !TERMINAL_STATES.includes(event.data as OrderStatus), true),
    );
  }
}