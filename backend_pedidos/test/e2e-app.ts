import { resolve } from 'path';
import * as dotenv from 'dotenv';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import helmet from 'helmet';
import cookieParser = require('cookie-parser');

dotenv.config({
  path: resolve(__dirname, '..', '.env.test'),
  override: true,
  quiet: true,
});

const EXPECTED_PORT = '5434';

const dbName = process.env.DB_NAME ?? '';
if (!/_test$/.test(dbName)) {
  throw new Error(
    `ABORT: los e2e nunca corren contra la base "${dbName}". Se esperaba un nombre terminado en _test.`,
  );
}
if (process.env.DB_PORT !== EXPECTED_PORT) {
  throw new Error(
    `ABORT: puerto de base inesperado "${process.env.DB_PORT}". Se esperaba ${EXPECTED_PORT}.`,
  );
}

const TABLES = [
  'order_items',
  'orders',
  'customers',
  'deliveries',
  'products',
  'categories',
  'availability_exceptions',
  'regular_schedules',
  'users',
  'tenants',
];

export async function createE2eApp(): Promise<INestApplication> {
  // require perezoso a proposito: AppModule lee process.env.DB_* al importarse, asi que
  // tiene que cargarse despues de que dotenv haya inyectado .env.test.
  const { AppModule } =
    require('../src/app.module') as typeof import('../src/app.module');

  const app = await NestFactory.create(AppModule, { logger: false });

  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? '*',
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.init();
  return app;
}

export function closeE2eApp(app: INestApplication): Promise<void> {
  return app.close();
}

export async function truncateAll(app: INestApplication): Promise<void> {
  await app
    .get(DataSource)
    .query(`TRUNCATE TABLE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

export function resetThrottle(app: INestApplication): void {
  app.get<ThrottlerStorageService>(getStorageToken()).storage.clear();
}

export function signToken(
  app: INestApplication,
  userId: string,
  tenantId: string,
): string {
  return app.get(JwtService).sign({ userId, tenantId });
}

export function cookieFor(token: string): string {
  return `access_token=${token}`;
}

export async function seedTenant(
  app: INestApplication,
  slug: string,
  name: string,
  overrides?: {
    minimumDeliveryTime?: number;
  },
): Promise<string> {
  const id = randomUUID();
  const minimumDeliveryTime = overrides?.minimumDeliveryTime ?? 0;
  await app.get(DataSource).query(
    `INSERT INTO tenants (id, slug, name, is_open, minimum_delivery_time)
     VALUES ($1, $2, $3, true, $4)`,
    [id, slug, name, minimumDeliveryTime],
  );
  return id;
}

export async function seedUser(
  app: INestApplication,
  tenantId: string,
  email: string,
): Promise<string> {
  const id = randomUUID();
  await app
    .get(DataSource)
    .query(
      `INSERT INTO users (id, tenant_id, email, password) VALUES ($1, $2, $3, 'no-se-usa-en-e2e')`,
      [id, tenantId, email],
    );
  return id;
}

export async function seedCategory(
  app: INestApplication,
  tenantId: string,
  name: string,
): Promise<string> {
  const id = randomUUID();
  await app
    .get(DataSource)
    .query(
      `INSERT INTO categories (id, tenant_id, name, is_active) VALUES ($1, $2, $3, true)`,
      [id, tenantId, name],
    );
  return id;
}

export async function seedProduct(
  app: INestApplication,
  tenantId: string,
  categoryId: string,
  name: string,
  price = 1000,
): Promise<string> {
  const id = randomUUID();
  await app.get(DataSource).query(
    `INSERT INTO products (id, tenant_id, category_id, name, price, is_active)
     VALUES ($1, $2, $3, $4, $5, true)`,
    [id, tenantId, categoryId, name, price],
  );
  return id;
}

export async function seedSchedule(
  app: INestApplication,
  tenantId: string,
  dayOfWeek: number,
  openingTime: string,
  closingTime: string,
  maxOrderTime?: string | null,
): Promise<string> {
  const id = randomUUID();
  await app.get(DataSource).query(
    `INSERT INTO regular_schedules (id, tenant_id, day_of_week, opening_time, closing_time, max_order_time)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, tenantId, dayOfWeek, openingTime, closingTime, maxOrderTime ?? null],
  );
  return id;
}

export async function seedException(
  app: INestApplication,
  tenantId: string,
  date: string,
  isOpen: boolean,
  openingTime?: string,
  closingTime?: string,
  maxOrderTime?: string | null,
): Promise<string> {
  const id = randomUUID();
  await app.get(DataSource).query(
    `INSERT INTO availability_exceptions (id, tenant_id, date, is_open, opening_time, closing_time, max_order_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      tenantId,
      date,
      isOpen,
      isOpen ? openingTime : null,
      isOpen ? closingTime : null,
      isOpen ? maxOrderTime ?? null : null,
    ],
  );
  return id;
}

export async function seedOrder(
  app: INestApplication,
  tenantId: string,
  customerName: string,
  total = 1000,
): Promise<string> {
  const ds = app.get(DataSource);
  const orderId = randomUUID();
  const customerId = randomUUID();

  await ds.query(
    `INSERT INTO customers (id, name, phone) VALUES ($1, $2, '1133334444')`,
    [customerId, customerName],
  );
  await ds.query(
    `INSERT INTO orders (id, tenant_id, status, tracking_uuid, total, "paymentMethod",
                         delivery_type, customer_id)
     VALUES ($1, $2, 'PENDIENTE', $3, $4, 'EFECTIVO', 'RETIRO_LOCAL', $5)`,
    [orderId, tenantId, randomUUID(), total, customerId],
  );
  return orderId;
}

export async function productNameById(
  app: INestApplication,
  productId: string,
): Promise<string> {
  const rows = await app
    .get(DataSource)
    .query(`SELECT name FROM products WHERE id = $1`, [productId]);
  return rows[0].name;
}
