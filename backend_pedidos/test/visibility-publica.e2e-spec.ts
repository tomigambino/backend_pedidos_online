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

type Fixture = {
  tenantA: string;
  userA: string;
  catVisibleA: string;
  prodVisibleA: string;
  catHiddenA: string;
  prodInCatHiddenA: string;
  catActiveWithInactiveProdA: string;
  prodInactiveA: string;
  catDeletedA: string;
  prodInCatDeletedA: string;
  catExtraA: string;
  prodExtraA: string;
  prodSoftDeletedA: string;
  tenantB: string;
  catB: string;
  prodB: string;
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

  const catVisibleA = await seedCategory(app, tenantA, 'Visible A');
  const prodVisibleA = await seedProduct(
    app,
    tenantA,
    catVisibleA,
    'Producto Visible',
    1000,
  );
  const catHiddenA = await seedCategory(app, tenantA, 'Oculta A');
  const prodInCatHiddenA = await seedProduct(
    app,
    tenantA,
    catHiddenA,
    'Producto En Categoría Oculta',
    1000,
  );
  const catActiveWithInactiveProdA = await seedCategory(
    app,
    tenantA,
    'Activa Con Inactivo',
  );
  const prodInactiveA = await seedProduct(
    app,
    tenantA,
    catActiveWithInactiveProdA,
    'Producto Inactivo',
    1000,
  );
  const catDeletedA = await seedCategory(app, tenantA, 'Borrada A');
  const prodInCatDeletedA = await seedProduct(
    app,
    tenantA,
    catDeletedA,
    'Producto En Categoría Borrada',
    1000,
  );
  const catExtraA = await seedCategory(app, tenantA, 'Extra A');
  const prodExtraA = await seedProduct(
    app,
    tenantA,
    catExtraA,
    'Producto Extra',
    1000,
  );
  const prodSoftDeletedA = await seedProduct(
    app,
    tenantA,
    catVisibleA,
    'Producto Soft Deleted',
    1000,
  );
  const catB = await seedCategory(app, tenantB, 'Categoría B');
  const prodB = await seedProduct(app, tenantB, catB, 'Producto B', 1000);

  await app
    .get(DataSource)
    .query('UPDATE categories SET is_active=false WHERE id=$1', [catHiddenA]);
  await app
    .get(DataSource)
    .query('UPDATE products SET is_active=false WHERE id=$1', [prodInactiveA]);
  await app
    .get(DataSource)
    .query('UPDATE categories SET deleted_at=NOW() WHERE id=$1', [catDeletedA]);
  await app
    .get(DataSource)
    .query('UPDATE products SET deleted_at=NOW() WHERE id=$1', [
      prodSoftDeletedA,
    ]);

  return {
    tenantA,
    userA,
    catVisibleA,
    prodVisibleA,
    catHiddenA,
    prodInCatHiddenA,
    catActiveWithInactiveProdA,
    prodInactiveA,
    catDeletedA,
    prodInCatDeletedA,
    catExtraA,
    prodExtraA,
    prodSoftDeletedA,
    tenantB,
    catB,
    prodB,
  };
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

describe('Visibilidad pública', () => {
  const countOrders = async () =>
    (
      await app.get(DataSource).query('SELECT COUNT(*)::int AS c FROM orders')
    )[0]?.c ?? 0;
  const createOrder = async (pid: string, status: number) => {
    const r = await request(app.getHttpServer())
      .post(`/${SLUG_A}/orders`)
      .send({
        items: [{ productId: pid, quantity: 1 }],
        customer: { name: 'Cliente', phone: '1133334444' },
        paymentMethod: 'EFECTIVO',
        deliveryType: 'RETIRO_LOCAL',
      });
    expect(r.status).toBe(status);
    return r;
  };

  describe('POST /:tenant/orders', () => {
    it('rechaza producto en categoría oculta → 400', async () => {
      const b = await countOrders();
      await createOrder(fixture.prodInCatHiddenA, 400);
      expect(await countOrders()).toBe(b);
    });
    it('rechaza producto en categoría borrada → 400', async () => {
      const b = await countOrders();
      await createOrder(fixture.prodInCatDeletedA, 400);
      expect(await countOrders()).toBe(b);
    });
    it('rechaza producto de otro tenant → 400', async () => {
      const b = await countOrders();
      await createOrder(fixture.prodB, 400);
      expect(await countOrders()).toBe(b);
    });
    it('rechaza producto inactivo → 400', async () => {
      const b = await countOrders();
      await createOrder(fixture.prodInactiveA, 400);
      expect(await countOrders()).toBe(b);
    });
    it('rechaza producto soft-deleted → 400', async () => {
      const b = await countOrders();
      await createOrder(fixture.prodSoftDeletedA, 400);
      expect(await countOrders()).toBe(b);
    });
    it('acepta producto visible → 201', async () => {
      const b = await countOrders();
      await createOrder(fixture.prodVisibleA, 201);
      expect(await countOrders()).toBe(b + 1);
    });
  });
});
