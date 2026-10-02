/* eslint-disable */
/**
 * QA de los límites de upload: 5 MB por archivo y MIME jpeg/png/webp.
 *
 * Un solo POST /auth/register por corrida (crea tenant + owner y deja la cookie
 * access_token) y se reutiliza ese token en todos los casos. Lo que se sube es
 * basura no-imagen (nunca un PNG real), así que Cloudinary no recibe nada válido ni
 * quedan assets: todo se rechaza en multer, antes del service.
 *
 * El caso de tamaño usa node:http crudo y no supertest porque superagent aborta el
 * upload cuando el server responde antes de que termine de enviar el body y el
 * cliente ve ECONNRESET en vez del 413 (verificado: un cliente que finishes de
 * enviar recibe {"statusCode":413,"message":"File too large"}).
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser = require('cookie-parser');
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import * as http from 'node:http';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
} from '../../src/common/utils/upload-limits.util';

const results: string[] = [];
function check(name: string, ok: boolean, detail: string) {
  results.push(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`);
}

async function purge(ds: DataSource, tenantIds: string[]) {
  await ds.query(
    `DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE tenant_id = ANY($1))`,
    [tenantIds],
  );
  await ds.query(`DELETE FROM orders WHERE tenant_id = ANY($1)`, [tenantIds]);
  await ds.query(`DELETE FROM products WHERE tenant_id = ANY($1)`, [tenantIds]);
  await ds.query(`DELETE FROM categories WHERE tenant_id = ANY($1)`, [
    tenantIds,
  ]);
  await ds.query(`DELETE FROM users WHERE tenant_id = ANY($1)`, [tenantIds]);
  await ds.query(`DELETE FROM tenants WHERE id = ANY($1)`, [tenantIds]);
}

const BOUNDARY = '----qauploadlimits';

function rawMultipart(
  port: number,
  path: string,
  cookie: string,
  categoryId: string,
  fileName: string,
  contentType: string,
  buf: Buffer,
): Promise<{ status: number; body: string }> {
  const head = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="name"\r\n\r\nQA Producto\r\n` +
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="price"\r\n\r\n100\r\n` +
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="categoryId"\r\n\r\n${categoryId}\r\n` +
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="image"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const body = Buffer.concat([
    head,
    buf,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
          'content-length': body.length,
          cookie,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString().slice(0, 300),
          }),
        );
      },
    );
    req.on('error', (err) =>
      resolve({ status: 0, body: `socket error: ${err.message}` }),
    );
    req.end(body);
  });
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(0, '127.0.0.1');

  const ds = app.get(DataSource);
  const server = app.getHttpServer();
  const port = (server.address() as { port: number }).port;
  const stamp = Date.now();
  const slug = `qa-upload-${stamp}`;
  const email = `qa-upload-${stamp}@example.com`;
  const categoryId = randomUUID();

  // Autosanado de una corrida anterior a medias.
  const stale = await ds.query(
    `SELECT id FROM tenants WHERE slug LIKE 'qa-upload-%'`,
  );
  if (stale.length)
    await purge(
      ds,
      stale.map((r) => r.id),
    );

  try {
    const reg = await request(server).post('/auth/register').send({
      email,
      password: 'qa-upload-password',
      tenantName: 'QA Upload',
      tenantSlug: slug,
    });
    check(
      'registro del tenant temporal',
      reg.status === 201,
      `status=${reg.status}`,
    );
    const cookies: string[] = reg.headers['set-cookie'] ?? [];
    const jwt = /access_token=([^;]+)/.exec(cookies.join(';') ?? '')?.[1];
    if (!jwt) throw new Error('register no devolvió cookie access_token');

    const tenant = await ds.query(`SELECT id FROM tenants WHERE slug = $1`, [
      slug,
    ]);
    const tenantId = tenant[0].id;
    await ds.query(
      `INSERT INTO categories (id, tenant_id, name) VALUES ($1,$2,$3)`,
      [categoryId, tenantId, 'QA Upload Cat'],
    );

    const notImage = Buffer.from('esto no es una imagen');
    const oversize = Buffer.alloc(MAX_IMAGE_BYTES + 1); // ceros: ni siquiera es un PNG

    const asText = await request(server)
      .post(`/${slug}/products`)
      .set('Cookie', `access_token=${jwt}`)
      .field('name', 'QA Producto')
      .field('price', '100')
      .field('categoryId', categoryId)
      .attach('image', Readable.from(notImage), {
        filename: 'not-image.txt',
        contentType: 'text/plain',
      });
    check(
      'MIME no permitido (text/plain) -> 400',
      asText.status === 400,
      `status=${asText.status} msg=${asText.body?.message}`,
    );

    const asGif = await rawMultipart(
      port,
      `/${slug}/products`,
      `access_token=${jwt}`,
      categoryId,
      'not-image.gif',
      'image/gif',
      notImage,
    );
    check(
      'image/gif fuera de la lista -> 400',
      asGif.status === 400 && asGif.body.includes('image/gif'),
      `status=${asGif.status} body=${asGif.body}`,
    );

    const tooBig = await rawMultipart(
      port,
      `/${slug}/products`,
      `access_token=${jwt}`,
      categoryId,
      'grande.png',
      'image/png',
      oversize,
    );
    const tooBigJson = (() => {
      try {
        return JSON.parse(tooBig.body);
      } catch {
        return {};
      }
    })();
    check(
      `archivo de ${MAX_IMAGE_BYTES + 1} bytes -> 413`,
      tooBig.status === 413,
      `status=${tooBig.status} body=${tooBig.body}`,
    );
    check(
      'el 413 sale en inglés',
      tooBig.status === 413 &&
        typeof tooBigJson.message === 'string' &&
        /^[\x20-\x7E]*$/.test(tooBigJson.message),
      `status=${tooBig.status} message=${JSON.stringify(tooBigJson.message)} error=${JSON.stringify(tooBigJson.error)}`,
    );
    check(
      'el 413 de tamaño prueba que image/png pasa el filtro (si fuera 400 sería el MIME)',
      tooBig.status === 413,
      `status=${tooBig.status} (buffer de ceros: ${MAX_IMAGE_BYTES + 1} bytes, no es un PNG real, Cloudinary lo rechazaría)`,
    );

    const atLimit = await rawMultipart(
      port,
      `/${slug}/products`,
      `access_token=${jwt}`,
      categoryId,
      'justo.png',
      'image/png',
      Buffer.alloc(MAX_IMAGE_BYTES),
    );
    check(
      `archivo de exactamente ${MAX_IMAGE_BYTES} bytes no lo rechaza el filtro`,
      atLimit.status !== 413 && atLimit.status !== 400,
      `status=${atLimit.status} (llegaría a Cloudinary y lo rechazaría por no ser imagen: esperado)`,
    );

    check(
      'lista de MIME exportada',
      ALLOWED_IMAGE_MIME_TYPES.join(', ') ===
        'image/jpeg, image/png, image/webp',
      `ALLOWED_IMAGE_MIME_TYPES=${ALLOWED_IMAGE_MIME_TYPES.join(', ')}`,
    );
    check(
      'MAX_IMAGE_BYTES = 5 MB',
      MAX_IMAGE_BYTES === 5 * 1024 * 1024,
      `MAX_IMAGE_BYTES=${MAX_IMAGE_BYTES}`,
    );

    const noAuth = await rawMultipart(
      port,
      `/${slug}/products`,
      '',
      categoryId,
      'not-image.txt',
      'text/plain',
      notImage,
    );
    check(
      'sin token sigue cortando en 401 antes del filtro',
      noAuth.status === 401,
      `status=${noAuth.status} body=${noAuth.body}`,
    );

    const created = await ds.query(
      `SELECT count(*)::int AS n FROM products WHERE tenant_id = $1`,
      [tenantId],
    );
    check(
      'ningún producto creado',
      created[0].n === 0,
      `productos=${created[0].n}`,
    );
  } finally {
    const leftovers = await ds.query(`SELECT id FROM tenants WHERE slug = $1`, [
      slug,
    ]);
    await purge(
      ds,
      leftovers.map((r) => r.id),
    );
    await app.close();
  }

  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  results.forEach((r) => console.log(r));
  console.log(`${results.length - failed}/${results.length} OK`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  results.forEach((r) => console.log(r));
  console.error('QA ABORTADO:', err);
  process.exit(1);
});
