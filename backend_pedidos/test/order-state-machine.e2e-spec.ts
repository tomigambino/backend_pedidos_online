import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import {
  closeE2eApp,
  cookieFor,
  createE2eApp,
  resetThrottle,
  seedCategory,
  seedProduct,
  seedTenant,
  seedUser,
  signToken,
  truncateAll,
} from './e2e-app';

const SLUG_A = 'tenant-a';
const SLUG_B = 'tenant-b';
const CUSTOMER_NAME = 'Cliente Estado';

type Fixture = {
  tenantA: string;
  userA: string;
  productA: string;
  categoryA: string;
  tenantB: string;
  userB: string;
};

let app: INestApplication;
let fixture: Fixture;

function auth(token: string) {
  return { Cookie: cookieFor(token) };
}

async function seed(): Promise<Fixture> {
  const tenantA = await seedTenant(app, SLUG_A, 'Tenant A');
  const tenantB = await seedTenant(app, SLUG_B, 'Tenant B');

  const userA = await seedUser(app, tenantA, 'dueño-a@tenant.test');
  const userB = await seedUser(app, tenantB, 'dueño-b@tenant.test');

  const categoryA = await seedCategory(app, tenantA, 'Categoría A');
  const productA = await seedProduct(
    app,
    tenantA,
    categoryA,
    'Producto Original',
    1000,
  );

  return { tenantA, userA, productA, categoryA, tenantB, userB };
}

async function setOrderStatus(
  app: INestApplication,
  orderId: string,
  status: string,
): Promise<void> {
  await app
    .get(DataSource)
    .query('UPDATE orders SET status = $1::orders_status_enum WHERE id = $2', [
      status,
      orderId,
    ]);
}

beforeAll(async () => {
  app = await createE2eApp();
});

beforeEach(async () => {
  await truncateAll(app);
  resetThrottle(app);
  fixture = await seed();
});

afterAll(async () => {
  await truncateAll(app);
  await closeE2eApp(app);
});

describe('Máquina de estados de pedidos', () => {
  const createOrder = async () => {
    const res = await request(app.getHttpServer())
      .post(`/${SLUG_A}/orders`)
      .send({
        items: [{ productId: fixture.productA, quantity: 1 }],
        customer: { name: CUSTOMER_NAME, phone: '1133334444' },
        paymentMethod: 'EFECTIVO',
        deliveryType: 'RETIRO_LOCAL',
      });

    expect(res.status).toBe(201);
    return res.body as {
      id: string;
      trackingUuid: string;
      items: any[];
      total: number;
    };
  };

  describe('5.1 Camino completo hasta ENTREGADO', () => {
    it('transita PENDIENTE → EN_PREPARACION → LISTO → ENTREGADO', async () => {
      const order = await createOrder();
      const token = signToken(app, fixture.userA, fixture.tenantA);

      let res = await request(app.getHttpServer())
        .patch(`/${SLUG_A}/orders/${order.id}/status`)
        .set(auth(token))
        .send({ status: 'EN_PREPARACION' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('EN_PREPARACION');

      res = await request(app.getHttpServer())
        .patch(`/${SLUG_A}/orders/${order.id}/status`)
        .set(auth(token))
        .send({ status: 'LISTO' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('LISTO');

      res = await request(app.getHttpServer())
        .patch(`/${SLUG_A}/orders/${order.id}/status`)
        .set(auth(token))
        .send({ status: 'ENTREGADO' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ENTREGADO');
    });
  });
});
