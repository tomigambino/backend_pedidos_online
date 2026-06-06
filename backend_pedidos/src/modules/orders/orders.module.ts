import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { Order } from './entities/order.entity';
import { Customer } from './entities/customer.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { ProductsModule } from '../products/products.module';
import { OrdersSseService } from './orders-sse.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, Customer, Tenant]),
    ProductsModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersSseService],
})
export class OrdersModule {}