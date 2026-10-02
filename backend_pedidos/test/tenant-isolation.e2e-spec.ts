import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import {
  closeE2eApp,
  cookieFor,
  createE2eApp,
  productNameById,
  resetThrottle,
  seedCategory,
  seedOrder,
  seedProduct,
  seedSchedule,
  seedTenant,
  seedUser,
  signToken,
  truncateAll,
} from './e2e-app';

const SLUG_A = 'tenant-a';
const SLUG_B = 'tenant-b';
const SHARED_NAME = 'Producto compartido';

type Fixture = {
  tenantA: string;
  tenantB: string;
  userA: string;
  userB: string;
  productA: string;
  productB: string;
  orderA: string;
  orderB: string;
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
  const categoryB = await seedCategory(app, tenantB, 'Categoría B');

  const productA = await seedProduct(app, tenantA, categoryA, SHARED_NAME);
  const productB = await seedProduct(app, tenantB, categoryB, SHARED_NAME);

  await seedSchedule(app, tenantA, 1, '09:00', '18:00');
  await seedSchedule(app, tenantB, 2, '10:00', '20:00');

  const orderA = await seedOrder(app, tenantA, 'Cliente A');
  const orderB = await seedOrder(app, tenantB, 'Cliente B');

  return { tenantA, tenantB, userA, userB, productA, productB, orderA, orderB };
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

describe('Aislamiento entre tenants', () => {
  describe('resolución por slug (público)', () => {
    it('devuelve 404 cuando el slug no existe', async () => {
      const res = await request(app.getHttpServer()).get(
        `/tenant-inexistente/products`,
      );

      expect(res.status).toBe(404);
    });

    it('el listado público solo trae productos del slug pedido', async () => {
      const res = await request(app.getHttpServer()).get(`/${SLUG_A}/products`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(fixture.productA);
      expect(res.body.data.map((p: { id: string }) => p.id)).not.toContain(
        fixture.productB,
      );
    });
  });

  describe('el claim del JWT le gana al slug', () => {
    it('sin cookie, una ruta admin responde 401', async () => {
      const res = await request(app.getHttpServer()).get(
        `/${SLUG_A}/admin/schedule`,
      );

      expect(res.status).toBe(401);
    });

    it('control: cookie y slug del mismo tenant devuelven su propio horario', async () => {
      const token = signToken(app, fixture.userA, fixture.tenantA);

      const res = await request(app.getHttpServer())
        .get(`/${SLUG_A}/admin/schedule`)
        .set(auth(token));

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].dayOfWeek).toBe(1);
      expect(res.body[0].openingTime).toBe('09:00:00');
    });

    it('comportamiento actual: cookie de A contra slug de B devuelve los datos de A', async () => {
      const token = signToken(app, fixture.userA, fixture.tenantA);

      const res = await request(app.getHttpServer())
        .get(`/${SLUG_B}/admin/schedule`)
        .set(auth(token));

      expect(res.status).toBe(200);
      expect(res.body[0].dayOfWeek).toBe(1);
      expect(res.body[0].openingTime).toBe('09:00:00');
    });

    it('comportamiento actual: cookie de A contra slug de B escribe en A', async () => {
      const token = signToken(app, fixture.userA, fixture.tenantA);

      const res = await request(app.getHttpServer())
        .patch(`/${SLUG_B}/products/${fixture.productA}`)
        .set(auth(token))
        .send({ name: 'Renombrado por A' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Renombrado por A');
      expect(await productNameById(app, fixture.productA)).toBe(
        'Renombrado por A',
      );
      expect(await productNameById(app, fixture.productB)).toBe(SHARED_NAME);
    });

    it('el listado admin queda acotado al tenant del token', async () => {
      const token = signToken(app, fixture.userA, fixture.tenantA);

      const res = await request(app.getHttpServer())
        .get(`/${SLUG_A}/products/admin`)
        .set(auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(fixture.productA);
    });
  });

  describe('lecturas y escrituras sobre recursos ajenos', () => {
    it('no se puede leer un pedido de otro tenant', async () => {
      const token = signToken(app, fixture.userA, fixture.tenantA);

      const res = await request(app.getHttpServer())
        .get(`/${SLUG_A}/orders/${fixture.orderB}`)
        .set(auth(token));

      expect(res.status).toBe(404);
    });

    it('el listado de pedidos no incluye los de otro tenant', async () => {
      const token = signToken(app, fixture.userA, fixture.tenantA);

      const res = await request(app.getHttpServer())
        .get(`/${SLUG_A}/orders`)
        .set(auth(token));

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.data.map((o: { id: string }) => o.id)).toEqual([
        fixture.orderA,
      ]);
    });

    it('no se puede modificar un producto de otro tenant', async () => {
      const token = signToken(app, fixture.userA, fixture.tenantA);

      const res = await request(app.getHttpServer())
        .patch(`/${SLUG_A}/products/${fixture.productB}`)
        .set(auth(token))
        .send({ name: 'No debería escribirse' });

      expect(res.status).toBe(404);
      expect(await productNameById(app, fixture.productB)).toBe(SHARED_NAME);
    });
  });

  describe('frontera de confianza del token', () => {
    it('un token firmado con el tenantId de B opera sobre B', async () => {
      const token = signToken(app, fixture.userA, fixture.tenantB);

      const res = await request(app.getHttpServer())
        .get(`/${SLUG_B}/admin/schedule`)
        .set(auth(token));

      expect(res.status).toBe(200);
      expect(res.body[0].dayOfWeek).toBe(2);
      expect(res.body[0].openingTime).toBe('10:00:00');
    });

    it.todo(
      'JwtStrategy.validate no verifica que el usuario exista: un token válido 7 días después de borrar al dueño sigue operando. Ver PENDING.md [Media].',
    );
  });

  describe('integridad de la base de test', () => {
    it('la base efectiva es la de test y no la de desarrollo', async () => {
      const rows = await app
        .get(DataSource)
        .query(`SELECT current_database() AS db, inet_server_port() AS port`);

      expect(rows[0].db).toBe('pedidos_online_test');
      expect(rows[0].port).toBe(5432);
    });
  });
});
