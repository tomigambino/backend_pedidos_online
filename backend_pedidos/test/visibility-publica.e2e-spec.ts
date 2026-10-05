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

  describe('listados públicos', () => {
    it('GET /products devuelve exactamente los productos visibles', async () => {
      const res = await request(app.getHttpServer()).get(`/${SLUG_A}/products`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.data.map((p: { id: string }) => p.id).sort()).toEqual(
        [fixture.prodVisibleA, fixture.prodExtraA].sort(),
      );
    });

    it('GET /products no filtra datos del tenant B', async () => {
      const res = await request(app.getHttpServer()).get(`/${SLUG_A}/products`);

      expect(res.status).toBe(200);
      expect(res.body.data.map((p: { id: string }) => p.id)).not.toContain(
        fixture.prodB,
      );
    });

    it('GET /categories devuelve exactamente las categorías activas', async () => {
      const res = await request(app.getHttpServer()).get(
        `/${SLUG_A}/categories`,
      );

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(
        res.body.data.map((c: { id: string }) => c.id).sort(),
      ).toEqual(
        [
          fixture.catVisibleA,
          fixture.catActiveWithInactiveProdA,
          fixture.catExtraA,
        ].sort(),
      );
    });

    it('GET /categories expone productCount solo de productos públicos', async () => {
      const res = await request(app.getHttpServer()).get(
        `/${SLUG_A}/categories`,
      );

      const byId = Object.fromEntries(
        res.body.data.map((c: { id: string; productCount: number }) => [
          c.id,
          c.productCount,
        ]),
      );
      expect(byId[fixture.catVisibleA]).toBe(1);
      expect(byId[fixture.catActiveWithInactiveProdA]).toBe(0);
      expect(byId[fixture.catExtraA]).toBe(1);
    });

    it('GET /categories no filtra datos del tenant B', async () => {
      const res = await request(app.getHttpServer()).get(
        `/${SLUG_A}/categories`,
      );

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.data.map((c: { id: string }) => c.id)).not.toContain(
        fixture.catB,
      );
    });
  });

  describe('paginación pública', () => {
    const categoryPage = async (page: number) => {
      const res = await request(app.getHttpServer()).get(
        `/${SLUG_A}/categories?page=${page}&limit=1`,
      );
      expect(res.status).toBe(200);
      return res.body;
    };

    it('categorías limit=1: total, totalPages y una por página en orden ASC', async () => {
      const p1 = await categoryPage(1);
      expect(p1.total).toBe(3);
      expect(p1.limit).toBe(1);
      expect(p1.totalPages).toBe(3);
      expect(p1.data).toHaveLength(1);

      const p2 = await categoryPage(2);
      const p3 = await categoryPage(3);

      expect(p1.data[0].name).toBe('Activa Con Inactivo');
      expect(p2.data[0].name).toBe('Extra A');
      expect(p3.data[0].name).toBe('Visible A');

      expect(p1.data[0].id).not.toBe(p2.data[0].id);
      expect(p2.data[0].id).not.toBe(p3.data[0].id);
      expect(p1.data[0].id).not.toBe(p3.data[0].id);
    });

    it('categorías page=4&limit=1: data vacío y total 3', async () => {
      const res = await request(app.getHttpServer()).get(
        `/${SLUG_A}/categories?page=4&limit=1`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.total).toBe(3);
      expect(res.body.totalPages).toBe(3);
    });

    it('productos limit=1: dos páginas en orden ASC', async () => {
      const page = async (p: number) => {
        const res = await request(app.getHttpServer()).get(
          `/${SLUG_A}/products?page=${p}&limit=1`,
        );
        expect(res.status).toBe(200);
        return res.body;
      };

      const p1 = await page(1);
      expect(p1.total).toBe(2);
      expect(p1.totalPages).toBe(2);
      expect(p1.data).toHaveLength(1);

      const p2 = await page(2);

      expect(p1.data[0].id).toBe(fixture.prodExtraA);
      expect(p2.data[0].id).toBe(fixture.prodVisibleA);
    });
  });

  describe('admin de categorías', () => {
    const admin = (query = '') =>
      request(app.getHttpServer())
        .get(`/${SLUG_A}/categories/admin${query}`)
        .set(auth(signToken(app, fixture.userA, fixture.tenantA)));

    it('exige autenticación: sin token → 401', async () => {
      const res = await request(app.getHttpServer()).get(
        `/${SLUG_A}/categories/admin`,
      );

      expect(res.status).toBe(401);
    });

    it('devuelve las 4 categorías (incluye la oculta, excluye la borrada)', async () => {
      const res = await admin();

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(4);
      expect(res.body.data.map((c: { id: string }) => c.id).sort()).toEqual(
        [
          fixture.catVisibleA,
          fixture.catHiddenA,
          fixture.catActiveWithInactiveProdA,
          fixture.catExtraA,
        ].sort(),
      );
      expect(res.body.data.map((c: { id: string }) => c.id)).not.toContain(
        fixture.catDeletedA,
      );
    });

    it('productCount cuenta el producto inactivo en admin y no en público', async () => {
      const adminRes = await admin();
      const adminCount = adminRes.body.data.find(
        (c: { id: string }) => c.id === fixture.catActiveWithInactiveProdA,
      ).productCount;

      const publicRes = await request(app.getHttpServer()).get(
        `/${SLUG_A}/categories`,
      );
      const publicCount = publicRes.body.data.find(
        (c: { id: string }) => c.id === fixture.catActiveWithInactiveProdA,
      ).productCount;

      expect(adminCount).toBe(1);
      expect(publicCount).toBe(0);
    });

    it('paginación limit=1: total 4, totalPages 4, orden ASC y páginas distintas', async () => {
      const page = async (p: number) => {
        const res = await admin(`?page=${p}&limit=1`);
        expect(res.status).toBe(200);
        return res.body;
      };

      const p1 = await page(1);
      expect(p1.total).toBe(4);
      expect(p1.limit).toBe(1);
      expect(p1.totalPages).toBe(4);
      expect(p1.data).toHaveLength(1);

      const p2 = await page(2);
      const p3 = await page(3);
      const p4 = await page(4);

      expect(p1.data[0].name).toBe('Activa Con Inactivo');
      expect(p2.data[0].name).toBe('Extra A');
      expect(p3.data[0].name).toBe('Oculta A');
      expect(p4.data[0].name).toBe('Visible A');

      expect(new Set([p1, p2, p3, p4].map((p) => p.data[0].id)).size).toBe(4);
    });
  });
});
