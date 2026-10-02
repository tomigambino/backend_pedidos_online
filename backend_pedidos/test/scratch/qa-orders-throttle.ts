/* eslint-disable */
/**
 * QA — Límite dedicado de POST /:tenant/orders (PENDING.md [Alta] orders.controller.ts:35).
 *
 * Uso:  npx ts-node -T --project tsconfig.json test/scratch/qa-orders-throttle.ts
 *
 * Levanta la app real contra la BD de .env, siembra dos tenants descartables, verifica el
 * límite y borra todo lo que creó (incluidos customers/deliveries huérfanos). No queda
 * nada en la base. Los datos QA se identifican por el slug `qa-throttle-*`.
 *
 * Dejé este archivo en test/scratch/ a propósito: es la base para convertirlo en un
 * e2e permanente (migrar a test/orders-throttle.e2e-spec.ts con la config de
 * test/jest-e2e.json, que matchea `.e2e-spec.ts`).
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';

const LIMIT = 10; // @Throttle({ default: { limit: 10, ttl: 60000 } })

const results: string[] = [];
function check(name: string, ok: boolean, detail: string) {
  results.push(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`);
}

/**
 * customers/deliveries se referencian desde orders (FK sin ON DELETE CASCADE), así que hay que
 * capturar los ids y borrar orders antes que ellos, o el purge revienta por FK.
 */
async function purge(ds: DataSource, tenantIds: string[]) {
  const rows = await ds.query(
    `SELECT id, customer_id, delivery_id FROM orders WHERE tenant_id = ANY($1)`,
    [tenantIds],
  );
  const pick = (key: 'customer_id' | 'delivery_id') =>
    rows.map((r) => r[key]).filter(Boolean);

  await ds.query(`DELETE FROM order_items WHERE order_id = ANY($1)`, [
    rows.map((r) => r.id),
  ]);
  await ds.query(`DELETE FROM orders WHERE tenant_id = ANY($1)`, [tenantIds]);
  await ds.query(`DELETE FROM customers WHERE id = ANY($1)`, [
    pick('customer_id'),
  ]);
  await ds.query(`DELETE FROM deliveries WHERE id = ANY($1)`, [
    pick('delivery_id'),
  ]);
  await ds.query(`DELETE FROM products WHERE tenant_id = ANY($1)`, [tenantIds]);
  await ds.query(`DELETE FROM categories WHERE tenant_id = ANY($1)`, [
    tenantIds,
  ]);
  await ds.query(`DELETE FROM tenants WHERE id = ANY($1)`, [tenantIds]);
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();

  const ds = app.get(DataSource);
  const server = app.getHttpServer();

  const stamp = Date.now();
  const slugA = `qa-throttle-a-${stamp}`;
  const slugB = `qa-throttle-b-${stamp}`;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const catA = randomUUID();
  const catB = randomUUID();
  const prodA = randomUUID();
  const prodB = randomUUID();

  const body = (productId: string) => ({
    items: [{ productId, quantity: 1 }],
    customer: { name: 'QA Throttle', phone: '1133334444' },
    paymentMethod: 'EFECTIVO',
    deliveryType: 'RETIRO_LOCAL',
  });

  try {
    // Autosanado: si una corrida anterior quedó a medias, sus tenants/customer siguen ahí.
    const stale = await ds.query(
      `SELECT id FROM tenants WHERE slug LIKE 'qa-throttle-%'`,
    );
    if (stale.length)
      await purge(
        ds,
        stale.map((r) => r.id),
      );

    await ds.query(
      `INSERT INTO tenants (id, slug, name, delivery_cost_enabled, is_open)
       VALUES ($1,$2,'QA Throttle A',false,true), ($3,$4,'QA Throttle B',false,true)`,
      [tenantA, slugA, tenantB, slugB],
    );
    await ds.query(
      `INSERT INTO categories (id, tenant_id, name, is_active) VALUES ($1,$2,'QA Cat',true), ($3,$4,'QA Cat B',true)`,
      [catA, tenantA, catB, tenantB],
    );
    await ds.query(
      `INSERT INTO products (id, tenant_id, category_id, name, price, is_active) VALUES
        ($1,$2,$3,'QA Producto A',1000,true), ($4,$5,$6,'QA Producto B',1000,true)`,
      [prodA, tenantA, catA, prodB, tenantB, catB],
    );

    const statuses: number[] = [];
    let firstHeaders: Record<string, string> = {};
    for (let i = 0; i < LIMIT; i++) {
      const res = await request(server)
        .post(`/${slugA}/orders`)
        .send(body(prodA));
      statuses.push(res.status);
      if (i === 0) firstHeaders = res.headers as Record<string, string>;
    }
    check(
      `pedidos 1..${LIMIT} -> 201`,
      statuses.every((s) => s === 201),
      `statuses=${JSON.stringify(statuses)}`,
    );
    check(
      'el 201 expone X-RateLimit-*',
      !!firstHeaders['x-ratelimit-limit'] &&
        firstHeaders['x-ratelimit-limit'] === String(LIMIT),
      `x-ratelimit-limit=${firstHeaders['x-ratelimit-limit']} x-ratelimit-remaining=${firstHeaders['x-ratelimit-remaining']} x-ratelimit-reset=${firstHeaders['x-ratelimit-reset']}`,
    );

    const over = await request(server)
      .post(`/${slugA}/orders`)
      .send(body(prodA));
    check(
      `pedido ${LIMIT + 1} -> 429`,
      over.status === 429,
      `status=${over.status} msg=${over.body?.message}`,
    );
    // Ojo: en un 429 Nest solo setea Retry-After y corta; los X-RateLimit-* no llegan
    // (throttler.guard.js:118-123 lanza antes de los headers de la línea 135).
    check(
      '429 trae Retry-After',
      !!over.headers['retry-after'],
      `retry-after=${over.headers['retry-after']}`,
    );

    const other = await request(server)
      .post(`/${slugB}/orders`)
      .send(body(prodB));
    check(
      'otro tenant con la misma IP también recibe 429 (bucket compartido por IP)',
      other.status === 429,
      `status=${other.status}`,
    );

    const cats = await request(server).get(`/${slugA}/categories`);
    const prods = await request(server).get(`/${slugA}/products`);
    check(
      'otras rutas sin @Throttle propio siguen en 200',
      cats.status === 200 && prods.status === 200,
      `categories=${cats.status} products=${prods.status}`,
    );

    const registerStatuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(server)
        .post('/auth/register')
        .send({ email: 'no-es-un-email' }); // inválido a propósito: el guard corre antes que el ValidationPipe, así que no crea nada
      registerStatuses.push(res.status);
    }
    // 5/min reales: AuthController ya no duplica el ThrottlerGuard (el guard global de
    // app.module.ts alcanza), así que 5 requests pasan y el 6º corta.
    check(
      'POST /auth/register tiene 5/min reales (5×400 y el 6º -> 429)',
      registerStatuses.slice(0, 5).every((s) => s === 400) &&
        registerStatuses[5] === 429,
      `statuses=${JSON.stringify(registerStatuses)} (400 = payload inválido, 429 = throttle)`,
    );
  } finally {
    await purge(ds, [tenantA, tenantB]);
    await app.close();
  }

  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`\n${results.length - failed.length}/${results.length} OK`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
