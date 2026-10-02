/* eslint-disable */
/**
 * QA de los límites de upload en logo/banner del tenant (PATCH /:tenant/admin/tenants).
 *
 * Un solo POST /auth/register por corrida y se reutiliza su cookie. Los archivos son
 * basura no-imagen, así que Cloudinary no recibe nada válido ni quedan assets.
 * El caso de tamaño usa node:http crudo porque superagent aborta el upload cuando el
 * server responde antes de que termine de enviar el body (el cliente ve ECONNRESET).
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser = require('cookie-parser');
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
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
  await ds.query(`DELETE FROM products WHERE tenant_id = ANY($1)`, [tenantIds]);
  await ds.query(`DELETE FROM categories WHERE tenant_id = ANY($1)`, [
    tenantIds,
  ]);
  await ds.query(`DELETE FROM users WHERE tenant_id = ANY($1)`, [tenantIds]);
  await ds.query(`DELETE FROM tenants WHERE id = ANY($1)`, [tenantIds]);
}

const BOUNDARY = '----qatenantlimits';

function rawMultipart(
  port: number,
  path: string,
  cookie: string,
  files: {
    name: string;
    fileName: string;
    contentType: string;
    size: number;
  }[],
): Promise<{ status: number; body: string }> {
  const parts = files.map((f) =>
    Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.fileName}"\r\n` +
          `Content-Type: ${f.contentType}\r\n\r\n`,
      ),
      Buffer.alloc(f.size),
      Buffer.from('\r\n'),
    ]),
  );
  const body = Buffer.concat([...parts, Buffer.from(`--${BOUNDARY}--\r\n`)]);
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'PATCH',
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
  const slug = `qa-tenant-${stamp}`;

  const stale = await ds.query(
    `SELECT id FROM tenants WHERE slug LIKE 'qa-tenant-%'`,
  );
  if (stale.length)
    await purge(
      ds,
      stale.map((r) => r.id),
    );

  try {
    const reg = await request(server)
      .post('/auth/register')
      .send({
        email: `qa-tenant-${stamp}@example.com`,
        password: 'qa-tenant-password',
        tenantName: 'QA Tenant',
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
    const cookie = `access_token=${jwt}`;

    const badLogo = await rawMultipart(port, `/${slug}/admin/tenants`, cookie, [
      {
        name: 'logo',
        fileName: 'logo.txt',
        contentType: 'text/plain',
        size: 32,
      },
    ]);
    check(
      'logo con MIME no permitido -> 400',
      badLogo.status === 400 && badLogo.body.includes('text/plain'),
      `status=${badLogo.status} body=${badLogo.body}`,
    );

    const badBanner = await rawMultipart(
      port,
      `/${slug}/admin/tenants`,
      cookie,
      [
        {
          name: 'banner',
          fileName: 'banner.gif',
          contentType: 'image/gif',
          size: 32,
        },
      ],
    );
    check(
      'banner con image/gif -> 400',
      badBanner.status === 400 && badBanner.body.includes('image/gif'),
      `status=${badBanner.status} body=${badBanner.body}`,
    );

    const bigLogo = await rawMultipart(port, `/${slug}/admin/tenants`, cookie, [
      {
        name: 'logo',
        fileName: 'logo.png',
        contentType: 'image/png',
        size: MAX_IMAGE_BYTES + 1,
      },
    ]);
    check(
      `logo de ${MAX_IMAGE_BYTES + 1} bytes -> 413`,
      bigLogo.status === 413 && bigLogo.body.includes('File too large'),
      `status=${bigLogo.status} body=${bigLogo.body}`,
    );

    const bigBoth = await rawMultipart(port, `/${slug}/admin/tenants`, cookie, [
      {
        name: 'logo',
        fileName: 'logo.png',
        contentType: 'image/png',
        size: MAX_IMAGE_BYTES + 1,
      },
      {
        name: 'banner',
        fileName: 'banner.png',
        contentType: 'image/png',
        size: MAX_IMAGE_BYTES + 1,
      },
    ]);
    check(
      'logo y banner oversize (2 archivos) -> 413, no se procesa el segundo',
      bigBoth.status === 413,
      `status=${bigBoth.status} body=${bigBoth.body}`,
    );

    const atLimit = await rawMultipart(port, `/${slug}/admin/tenants`, cookie, [
      {
        name: 'logo',
        fileName: 'logo.png',
        contentType: 'image/png',
        size: MAX_IMAGE_BYTES,
      },
      {
        name: 'banner',
        fileName: 'banner.png',
        contentType: 'image/png',
        size: MAX_IMAGE_BYTES,
      },
    ]);
    check(
      'logo y banner de exactamente 5 MB cada uno pasan el filtro de tamaño',
      atLimit.status !== 413 && atLimit.status !== 400,
      `status=${atLimit.status} (llegan a Cloudinary y los rechaza por no ser imagen: esperado)`,
    );

    const noAuth = await rawMultipart(port, `/${slug}/admin/tenants`, '', [
      {
        name: 'logo',
        fileName: 'logo.txt',
        contentType: 'text/plain',
        size: 32,
      },
    ]);
    check(
      'sin token sigue cortando en 401 antes del filtro',
      noAuth.status === 401,
      `status=${noAuth.status} body=${noAuth.body}`,
    );

    const tenant = await ds.query(
      `SELECT logo, banner FROM tenants WHERE slug = $1`,
      [slug],
    );
    check(
      'el tenant no quedó con logo ni banner',
      !tenant[0].logo && !tenant[0].banner,
      `logo=${tenant[0].logo} banner=${tenant[0].banner}`,
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
