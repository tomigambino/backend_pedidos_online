import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import {
  closeE2eApp,
  createE2eApp,
  resetThrottle,
  truncateAll,
} from './e2e-app';

const PASSWORD = 'secreto123';
const EMAIL = 'duenio@negocio.test';
const SLUG = 'negocio-test';

let app: INestApplication;

function registerBody(
  overrides: Partial<{
    email: string;
    password: string;
    tenantName: string;
    tenantSlug: string;
  }> = {},
) {
  return {
    email: EMAIL,
    password: PASSWORD,
    tenantName: 'Negocio Test',
    tenantSlug: SLUG,
    ...overrides,
  };
}

function accessCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as
    | string[]
    | string
    | undefined;
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const found = cookies.find((c) => c.startsWith('access_token='));
  if (!found) throw new Error('No se seteó la cookie access_token');
  return found.split(';')[0];
}

beforeAll(async () => {
  app = await createE2eApp();
});

beforeEach(async () => {
  await truncateAll(app);
  resetThrottle(app);
});

afterAll(async () => {
  await truncateAll(app);
  await closeE2eApp(app);
});

describe('Autenticación', () => {
  describe('POST /auth/register', () => {
    it('registra negocio y dueño, y setea la cookie HttpOnly', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerBody());

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true });
      expect(res.body.accessToken).toBeUndefined();

      const cookie = accessCookie(res);
      expect(cookie).toMatch(/^access_token=eyJ/);

      const setCookie = (
        res.headers['set-cookie'] as unknown as string[]
      ).join(';');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
    });

    it('persiste el dueño con rol OWNER y la contraseña hasheada', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerBody())
        .expect(201);

      const users = await app
        .get(DataSource)
        .query('SELECT email, password, role FROM users WHERE email = $1', [
          EMAIL,
        ]);

      expect(users).toHaveLength(1);
      expect(users[0].role).toBe('OWNER');
      expect(users[0].password).not.toBe(PASSWORD);
      expect(users[0].password).toMatch(/^\$2[aby]\$/);

      const tenants = await app
        .get(DataSource)
        .query('SELECT name FROM tenants WHERE slug = $1', [SLUG]);

      expect(tenants).toHaveLength(1);
      expect(tenants[0].name).toBe('Negocio Test');
    });

    it('rechaza un email ya registrado → 400', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerBody())
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerBody({ tenantSlug: 'otro-slug' }));

      expect(res.status).toBe(400);
    });

    it('rechaza un slug de negocio ya tomado → 400', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerBody())
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerBody({ email: 'otro@negocio.test' }));

      expect(res.status).toBe(400);
    });

    it('valida el payload: contraseña corta, email inválido o slug inválido → 400', async () => {
      const shortPassword = await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerBody({ password: 'corta' }));
      expect(shortPassword.status).toBe(400);

      const badEmail = await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerBody({ email: 'no-es-un-email' }));
      expect(badEmail.status).toBe(400);

      const badSlug = await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerBody({ tenantSlug: 'Slug Inválido' }));
      expect(badSlug.status).toBe(400);
    });

    it('deja el slug registrado navegable en el menú público', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerBody())
        .expect(201);

      const res = await request(app.getHttpServer()).get(`/${SLUG}/products`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerBody())
        .expect(201);
    });

    it('devuelve la cookie con credenciales válidas', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: EMAIL, password: PASSWORD });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true });
      expect(accessCookie(res)).toMatch(/^access_token=eyJ/);
    });

    it('rechaza la contraseña incorrecta → 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: EMAIL, password: 'incorrecta123' });

      expect(res.status).toBe(401);
    });

    it('no revela si el email existe: mismo mensaje para usuario inexistente y password mala', async () => {
      const unknown = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'no-existe@negocio.test', password: PASSWORD });
      const wrongPassword = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: EMAIL, password: 'incorrecta123' });

      expect(unknown.status).toBe(401);
      expect(wrongPassword.status).toBe(401);
      expect(unknown.body.message).toBe(wrongPassword.body.message);
    });

    it('valida el payload: falta la contraseña → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: EMAIL });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /auth/me', () => {
    it('devuelve el perfil del usuario autenticado', async () => {
      const registered = await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerBody())
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', accessCookie(registered));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        email: EMAIL,
        tenantSlug: SLUG,
        tenantName: 'Negocio Test',
      });
    });

    it('401 sin cookie', async () => {
      const res = await request(app.getHttpServer()).get('/auth/me');

      expect(res.status).toBe(401);
    });

    it('la cookie de login habilita una ruta admin protegida', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerBody())
        .expect(201);

      const logged = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/${SLUG}/admin/schedule`)
        .set('Cookie', accessCookie(logged));

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});
