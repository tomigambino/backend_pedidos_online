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

  describe('Bloque A: máquina de estados', () => {
    const STATES = [
      'PENDIENTE',
      'EN_PREPARACION',
      'LISTO',
      'ENTREGADO',
      'NO_RETIRADO',
      'CANCELADO',
    ] as const;

    const INVALID_FROM_PENDIENTE = [
      ['LISTO'],
      ['ENTREGADO'],
      ['NO_RETIRADO'],
      ['PENDIENTE'],
    ];
    const INVALID_FROM_EN_PREPARACION = [
      ['PENDIENTE'],
      ['ENTREGADO'],
      ['NO_RETIRADO'],
      ['EN_PREPARACION'],
    ];
    const INVALID_FROM_LISTO = [
      ['PENDIENTE'],
      ['EN_PREPARACION'],
      ['LISTO'],
      ['CANCELADO'],
    ];
    const INVALID_FROM_ENTREGADO = STATES.map((s) => [s]);
    const INVALID_FROM_NO_RETIRADO = STATES.map((s) => [s]);
    const INVALID_FROM_CANCELADO = STATES.map((s) => [s]);

    it.each(INVALID_FROM_PENDIENTE)(
      'PENDIENTE → %s es inválido (400)',
      async (dest) => {
        const order = await createOrder();
        const token = signToken(app, fixture.userA, fixture.tenantA);
        await setOrderStatus(app, order.id, 'PENDIENTE');

        const res = await request(app.getHttpServer())
          .patch(`/${SLUG_A}/orders/${order.id}/status`)
          .set(auth(token))
          .send({ status: dest });

        expect(res.status).toBe(400);
      },
    );

    it.each(INVALID_FROM_EN_PREPARACION)(
      'EN_PREPARACION → %s es inválido (400)',
      async (dest) => {
        const order = await createOrder();
        const token = signToken(app, fixture.userA, fixture.tenantA);
        await setOrderStatus(app, order.id, 'EN_PREPARACION');

        const res = await request(app.getHttpServer())
          .patch(`/${SLUG_A}/orders/${order.id}/status`)
          .set(auth(token))
          .send({ status: dest });

        expect(res.status).toBe(400);
      },
    );

    it.each(INVALID_FROM_LISTO)(
      'LISTO → %s es inválido (400)',
      async (dest) => {
        const order = await createOrder();
        const token = signToken(app, fixture.userA, fixture.tenantA);
        await setOrderStatus(app, order.id, 'LISTO');

        const res = await request(app.getHttpServer())
          .patch(`/${SLUG_A}/orders/${order.id}/status`)
          .set(auth(token))
          .send({ status: dest });

        expect(res.status).toBe(400);
      },
    );

    it.each(INVALID_FROM_ENTREGADO)(
      'ENTREGADO → %s es inválido (400)',
      async (dest) => {
        const order = await createOrder();
        const token = signToken(app, fixture.userA, fixture.tenantA);
        await setOrderStatus(app, order.id, 'ENTREGADO');

        const res = await request(app.getHttpServer())
          .patch(`/${SLUG_A}/orders/${order.id}/status`)
          .set(auth(token))
          .send({ status: dest });

        expect(res.status).toBe(400);
      },
    );

    it.each(INVALID_FROM_NO_RETIRADO)(
      'NO_RETIRADO → %s es inválido (400)',
      async (dest) => {
        const order = await createOrder();
        const token = signToken(app, fixture.userA, fixture.tenantA);
        await setOrderStatus(app, order.id, 'NO_RETIRADO');

        const res = await request(app.getHttpServer())
          .patch(`/${SLUG_A}/orders/${order.id}/status`)
          .set(auth(token))
          .send({ status: dest });

        expect(res.status).toBe(400);
      },
    );

    it.each(INVALID_FROM_CANCELADO)(
      'CANCELADO → %s es inválido (400)',
      async (dest) => {
        const order = await createOrder();
        const token = signToken(app, fixture.userA, fixture.tenantA);
        await setOrderStatus(app, order.id, 'CANCELADO');

        const res = await request(app.getHttpServer())
          .patch(`/${SLUG_A}/orders/${order.id}/status`)
          .set(auth(token))
          .send({ status: dest });

        expect(res.status).toBe(400);
      },
    );

    it('CANCELADO solo desde PENDIENTE y EN_PREPARACION', async () => {
      const token = signToken(app, fixture.userA, fixture.tenantA);

      const o1 = await createOrder();
      await setOrderStatus(app, o1.id, 'PENDIENTE');
      let res = await request(app.getHttpServer())
        .patch(`/${SLUG_A}/orders/${o1.id}/status`)
        .set(auth(token))
        .send({ status: 'CANCELADO', cancellationReason: 'Cliente canceló' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELADO');

      const o2 = await createOrder();
      await setOrderStatus(app, o2.id, 'EN_PREPARACION');
      res = await request(app.getHttpServer())
        .patch(`/${SLUG_A}/orders/${o2.id}/status`)
        .set(auth(token))
        .send({ status: 'CANCELADO', cancellationReason: 'Cliente canceló' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELADO');

      const o3 = await createOrder();
      await setOrderStatus(app, o3.id, 'LISTO');
      res = await request(app.getHttpServer())
        .patch(`/${SLUG_A}/orders/${o3.id}/status`)
        .set(auth(token))
        .send({ status: 'CANCELADO', cancellationReason: 'Cliente canceló' });
      expect(res.status).toBe(400);
    });

    it('NO_RETIRADO solo desde LISTO', async () => {
      const token = signToken(app, fixture.userA, fixture.tenantA);

      const o1 = await createOrder();
      await setOrderStatus(app, o1.id, 'PENDIENTE');
      let res = await request(app.getHttpServer())
        .patch(`/${SLUG_A}/orders/${o1.id}/status`)
        .set(auth(token))
        .send({ status: 'NO_RETIRADO' });
      expect(res.status).toBe(400);

      const o2 = await createOrder();
      await setOrderStatus(app, o2.id, 'EN_PREPARACION');
      res = await request(app.getHttpServer())
        .patch(`/${SLUG_A}/orders/${o2.id}/status`)
        .set(auth(token))
        .send({ status: 'NO_RETIRADO' });
      expect(res.status).toBe(400);

      const o3 = await createOrder();
      await setOrderStatus(app, o3.id, 'LISTO');
      res = await request(app.getHttpServer())
        .patch(`/${SLUG_A}/orders/${o3.id}/status`)
        .set(auth(token))
        .send({ status: 'NO_RETIRADO' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('NO_RETIRADO');
    });

    it('cancellationReason persistido solo en CANCELADO (enviar en transición a EN_PREPARACION y afirmar null)', async () => {
      const order = await createOrder();
      const token = signToken(app, fixture.userA, fixture.tenantA);
      await setOrderStatus(app, order.id, 'PENDIENTE');

      const res = await request(app.getHttpServer())
        .patch(`/${SLUG_A}/orders/${order.id}/status`)
        .set(auth(token))
        .send({
          status: 'EN_PREPARACION',
          cancellationReason: 'No debería persistir',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('EN_PREPARACION');
      expect(res.body.cancellationReason).toBeNull();
    });
  });

  describe('Bloque B: autorización, aislamiento y snapshot de order_items', () => {
    it('401 sin token al intentar cambiar estado', async () => {
      const order = await createOrder();

      const res = await request(app.getHttpServer())
        .patch(`/${SLUG_A}/orders/${order.id}/status`)
        .send({ status: 'EN_PREPARACION' });

      expect(res.status).toBe(401);
    });

    it('token de B sobre pedido de A → 404 (comportamiento actual: claim gana sobre slug; el pedido no se encuentra por tenantId del token)', async () => {
      const order = await createOrder();
      const token = signToken(app, fixture.userB, fixture.tenantB);

      const res = await request(app.getHttpServer())
        .patch(`/${SLUG_A}/orders/${order.id}/status`)
        .set(auth(token))
        .send({ status: 'EN_PREPARACION' });

      expect(res.status).toBe(404);
    });

    it('snapshot de order_items (precio, nombre, cantidad, productId y total sin cambios tras modificar el producto)', async () => {
      const order = await createOrder();
      const token = signToken(app, fixture.userA, fixture.tenantA);

      const before = await request(app.getHttpServer())
        .get(`/${SLUG_A}/orders/${order.id}`)
        .set(auth(token));

      expect(before.status).toBe(200);
      const itemBefore = before.body.items[0];
      const totalBefore = before.body.total;

      await app
        .get(DataSource)
        .query('UPDATE products SET price = 2500, name = $1 WHERE id = $2', [
          'Producto Modificado',
          fixture.productA,
        ]);

      const after = await request(app.getHttpServer())
        .get(`/${SLUG_A}/orders/${order.id}`)
        .set(auth(token));

      expect(after.status).toBe(200);
      const itemAfter = after.body.items[0];
      const totalAfter = after.body.total;

      expect(itemAfter.productId).toBe(itemBefore.productId);
      expect(itemAfter.quantity).toBe(itemBefore.quantity);
      expect(itemAfter.price).toBe(itemBefore.price);
      expect(itemAfter.name).toBe(itemBefore.name);
      expect(totalAfter).toBe(totalBefore);
    });

    it('snapshot de order_items repetido con el producto soft-deleted', async () => {
      const order = await createOrder();
      const token = signToken(app, fixture.userA, fixture.tenantA);

      const before = await request(app.getHttpServer())
        .get(`/${SLUG_A}/orders/${order.id}`)
        .set(auth(token));

      expect(before.status).toBe(200);
      const itemBefore = before.body.items[0];
      const totalBefore = before.body.total;

      await app
        .get(DataSource)
        .query('UPDATE products SET deleted_at = NOW() WHERE id = $1', [
          fixture.productA,
        ]);

      const after = await request(app.getHttpServer())
        .get(`/${SLUG_A}/orders/${order.id}`)
        .set(auth(token));

      expect(after.status).toBe(200);
      const itemAfter = after.body.items[0];
      const totalAfter = after.body.total;

      expect(itemAfter.productId).toBe(itemBefore.productId);
      expect(itemAfter.quantity).toBe(itemBefore.quantity);
      expect(itemAfter.price).toBe(itemBefore.price);
      expect(itemAfter.name).toBe(itemBefore.name);
      expect(totalAfter).toBe(totalBefore);
    });

    it.todo('el SSE cierra automáticamente al llegar a un estado terminal');
  });
});
