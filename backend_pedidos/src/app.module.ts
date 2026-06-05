import {
  Module,
  NestModule,
  MiddlewareConsumer,
  RequestMethod,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TenantsModule } from './modules/tenants/tenants.module';
import { AuthModule } from './modules/auth/auth.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ProductsModule } from './modules/products/products.module';
import { OrdersModule } from './modules/orders/orders.module';
import { TenantMiddleware } from './core/tenant/tenant.middleware';
import { Tenant } from './modules/tenants/entities/tenant.entity';

@Module({
  imports: [
    TenantsModule,
    AuthModule,
    CategoriesModule,
    ProductsModule,
    OrdersModule,
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: true,
    }),
    TypeOrmModule.forFeature([Tenant]),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      .forRoutes(
        { path: '/:tenant/menu', method: RequestMethod.GET },
        { path: '/:tenant/orders', method: RequestMethod.GET },
        { path: '/:tenant/orders', method: RequestMethod.POST },
        { path: '/:tenant/orders/:uuid/track', method: RequestMethod.GET },
        { path: '/:tenant/auth', method: RequestMethod.ALL },
        { path: '/:tenant/auth/*path', method: RequestMethod.ALL },
        { path: '/:tenant/categories', method: RequestMethod.ALL },
        { path: '/:tenant/products', method: RequestMethod.ALL },
        { path: '/:tenant/orders/:uuid/status-stream', method: RequestMethod.GET },
      );
  }
}
