import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import {
  closeE2eApp,
  cookieFor,
  createE2eApp,
  resetThrottle,
  seedCategory,
  seedException,
  seedProduct,
  seedSchedule,
  seedTenant,
  seedUser,
  signToken,
  truncateAll,
} from './e2e-app';

const SLUG = 'tenant-scheduled';
const AR_TZ = 'America/Argentina/Buenos_Aires';

let app: INestApplication;
let tenantId: string;
let userId: string;
let categoryId: string;
let productId: string;
let token: string;

function auth(t: string) {
  return { Cookie: cookieFor(t) };
}

function buildOrder(
  overrides: { desiredDeliveryTime?: string; deliveryType?: string } = {},
) {
  const payload: Record<string, unknown> = {
    items: [{ productId, quantity: 1 }],
    customer: { name: 'Cliente', phone: '1133334444' },
    paymentMethod: 'EFECTIVO',
    deliveryType: overrides.deliveryType ?? 'RETIRO_LOCAL',
  };
  if (overrides.desiredDeliveryTime !== undefined) {
    payload.desiredDeliveryTime = overrides.desiredDeliveryTime;
  }
  return payload;
}

function getDateInAR(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: AR_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getDayOfWeekInAR(date: Date): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: AR_TZ,
    weekday: 'short',
  }).format(date);
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return map[weekday] ?? 1;
}

function nextDateWithDayOfWeek(
  desiredDayOfWeek: number,
  hourAR: number,
  minuteAR: number,
  minDaysAhead: number,
): Date {
  const candidate = new Date(Date.now() + minDaysAhead * 24 * 60 * 60 * 1000);
  for (let i = 0; i < 14; i++) {
    const check = new Date(
      Date.now() + (minDaysAhead + i) * 24 * 60 * 60 * 1000,
    );
    if (getDayOfWeekInAR(check) === desiredDayOfWeek) {
      const dateStr = getDateInAR(check);
      return new Date(
        `${dateStr}T${String(hourAR).padStart(2, '0')}:${String(minuteAR).padStart(2, '0')}:00-03:00`,
      );
    }
  }
  throw new Error('No day found');
}

function normalizeHHmm(value: string): string {
  return value.length >= 5 ? value.slice(0, 5) : value;
}

async function seedBase(): Promise<void> {
  tenantId = await seedTenant(app, SLUG, 'Tenant Scheduled', {
    minimumDeliveryTime: 30,
  });
  userId = await seedUser(app, tenantId, 'owner@scheduled.test');
  categoryId = await seedCategory(app, tenantId, 'Cat');
  productId = await seedProduct(app, tenantId, categoryId, 'Producto', 1000);
  token = signToken(app, userId, tenantId);
}

beforeAll(async () => {
  app = await createE2eApp();
});

beforeEach(async () => {
  await truncateAll(app);
  resetThrottle(app);
  await seedBase();
});

afterAll(async () => {
  await truncateAll(app);
  await closeE2eApp(app);
});

describe('Horario de entrega deseado (sin schedules)', () => {
  it('crea pedido sin desiredDeliveryTime y devuelve null', async () => {
    const res = await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(buildOrder())
      .expect(201);

    expect(res.body.desiredDeliveryTime).toBeNull();
  });

  it('rechaza desiredDeliveryTime cuando el tenant no tiene schedules', async () => {
    const desired = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(buildOrder({ desiredDeliveryTime: desired.toISOString() }))
      .expect(400)
      .expect((res) => {
        expect(res.body.message).toMatch(/cerrado ese día/);
      });
  });

  it('rechaza desiredDeliveryTime antes del tiempo minimo (30 min)', async () => {
    const desired = new Date(Date.now() + 5 * 60 * 1000);

    await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(buildOrder({ desiredDeliveryTime: desired.toISOString() }))
      .expect(400)
      .expect((res) => {
        expect(res.body.message).toMatch(/al menos 30 minutos/);
      });
  });

  it('rechaza formato date-only sin hora', async () => {
    await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(buildOrder({ desiredDeliveryTime: '2026-10-05' }))
      .expect(400);
  });
});

describe('Horario de entrega deseado (con regular_schedules)', () => {
  beforeEach(async () => {
    // Schedule de 09:00 a 22:00 con maxOrderTime explícito en 21:30
    await seedSchedule(app, tenantId, 1, '09:00', '22:00', '21:30:00');
    await seedSchedule(app, tenantId, 2, '09:00', '22:00', '21:30:00');
    await seedSchedule(app, tenantId, 3, '09:00', '22:00', '21:30:00');
    await seedSchedule(app, tenantId, 4, '09:00', '22:00', '21:30:00');
    await seedSchedule(app, tenantId, 5, '09:00', '22:00', '21:30:00');
    await seedSchedule(app, tenantId, 6, '09:00', '22:00', '21:30:00');
  });

  it('crea pedido con desiredDeliveryTime válido dentro del horario', async () => {
    // Buscar próximo día con schedule (lunes-sábado)
    const now = new Date();
    let target = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    while (getDayOfWeekInAR(target) === 7 || getDayOfWeekInAR(target) === 0) {
      target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
    }
    target.setHours(14, 0, 0, 0);
    // Asegurar que es > now + minDeliveryTime
    if (target.getTime() < Date.now() + 31 * 60 * 1000) {
      target.setDate(target.getDate() + 1);
    }

    const res = await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(buildOrder({ desiredDeliveryTime: target.toISOString() }))
      .expect(201);

    expect(res.body.desiredDeliveryTime).toBe(target.toISOString());
  });

  it('rechaza desiredDeliveryTime después de maxOrderTime (21:30)', async () => {
    const target = nextDateWithDayOfWeek(1, 22, 0, 1);

    await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(buildOrder({ desiredDeliveryTime: target.toISOString() }))
      .expect(400)
      .expect((res) => {
        expect(res.body.message).toMatch(/entre 09:00 y 21:30/);
      });
  });

  it('rechaza desiredDeliveryTime antes de openingTime', async () => {
    const target = nextDateWithDayOfWeek(1, 7, 0, 1);

    await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(buildOrder({ desiredDeliveryTime: target.toISOString() }))
      .expect(400)
      .expect((res) => {
        expect(res.body.message).toMatch(/entre 09:00 y 21:30/);
      });
  });

  it('rechaza desiredDeliveryTime en domingo (sin schedule)', async () => {
    const target = nextDateWithDayOfWeek(7, 14, 0, 1);

    await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(buildOrder({ desiredDeliveryTime: target.toISOString() }))
      .expect(400)
      .expect((res) => {
        expect(res.body.message).toMatch(/cerrado ese día/);
      });
  });
});

describe('Horario de entrega deseado (default maxOrderTime = closingTime - minDeliveryTime)', () => {
  beforeEach(async () => {
    // Schedule sin maxOrderTime explícito → default = 22:00 - 0:30 = 21:30
    await seedSchedule(app, tenantId, 1, '09:00', '22:00');
    await seedSchedule(app, tenantId, 2, '09:00', '22:00');
    await seedSchedule(app, tenantId, 3, '09:00', '22:00');
    await seedSchedule(app, tenantId, 4, '09:00', '22:00');
    await seedSchedule(app, tenantId, 5, '09:00', '22:00');
    await seedSchedule(app, tenantId, 6, '09:00', '22:00');
  });

  it('acepta desiredDeliveryTime a las 21:30 (default calculado)', async () => {
    const target = nextDateWithDayOfWeek(1, 21, 30, 1);

    await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(buildOrder({ desiredDeliveryTime: target.toISOString() }))
      .expect(201);
  });

  it('rechaza desiredDeliveryTime a las 21:45 (después del default)', async () => {
    const target = nextDateWithDayOfWeek(1, 21, 45, 1);

    await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(buildOrder({ desiredDeliveryTime: target.toISOString() }))
      .expect(400);
  });
});

describe('Horario de entrega deseado (dos schedules por día)', () => {
  beforeEach(async () => {
    // Lunes: mediodía 12-15 y noche 20-23:30
    await seedSchedule(app, tenantId, 1, '12:00', '15:00', '14:30:00');
    await seedSchedule(app, tenantId, 1, '20:00', '23:30', '23:00:00');
    // Martes a sábado: 09-22
    for (let d = 2; d <= 6; d++) {
      await seedSchedule(app, tenantId, d, '09:00', '22:00', '21:30:00');
    }
  });

  it('acepta desiredDeliveryTime en el primer turno', async () => {
    const target = nextDateWithDayOfWeek(1, 13, 0, 1);

    await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(buildOrder({ desiredDeliveryTime: target.toISOString() }))
      .expect(201);
  });

  it('acepta desiredDeliveryTime en el segundo turno', async () => {
    const target = nextDateWithDayOfWeek(1, 21, 0, 1);

    await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(buildOrder({ desiredDeliveryTime: target.toISOString() }))
      .expect(201);
  });

  it('rechaza desiredDeliveryTime en el gap entre turnos (16:00)', async () => {
    const target = nextDateWithDayOfWeek(1, 16, 0, 1);

    await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(buildOrder({ desiredDeliveryTime: target.toISOString() }))
      .expect(400);
  });
});

describe('Horario de entrega deseado (availability_exceptions)', () => {
  beforeEach(async () => {
    await seedSchedule(app, tenantId, 1, '09:00', '22:00', '21:30:00');
    await seedSchedule(app, tenantId, 2, '09:00', '22:00', '21:30:00');
    await seedSchedule(app, tenantId, 3, '09:00', '22:00', '21:30:00');
    await seedSchedule(app, tenantId, 4, '09:00', '22:00', '21:30:00');
    await seedSchedule(app, tenantId, 5, '09:00', '22:00', '21:30:00');
    await seedSchedule(app, tenantId, 6, '09:00', '22:00', '21:30:00');
  });

  it('rechaza desiredDeliveryTime en excepción cerrada', async () => {
    const closedDate = getDateInAR(
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    );
    await seedException(app, tenantId, closedDate, false);

    const target = new Date(`${closedDate}T14:00:00-03:00`);

    await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(buildOrder({ desiredDeliveryTime: target.toISOString() }))
      .expect(400)
      .expect((res) => {
        expect(res.body.message).toMatch(/cerrado ese día/);
      });
  });

  it('acepta desiredDeliveryTime dentro de ventana de excepción abierta', async () => {
    const openDate = getDateInAR(
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    );
    await seedException(
      app,
      tenantId,
      openDate,
      true,
      '10:00',
      '15:00',
      '14:30:00',
    );

    const target = new Date(`${openDate}T13:00:00-03:00`);

    const res = await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(buildOrder({ desiredDeliveryTime: target.toISOString() }))
      .expect(201);

    expect(res.body.desiredDeliveryTime).toBe(target.toISOString());
  });

  it('rechaza desiredDeliveryTime fuera de ventana de excepción abierta', async () => {
    const openDate = getDateInAR(
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    );
    await seedException(
      app,
      tenantId,
      openDate,
      true,
      '10:00',
      '15:00',
      '14:30:00',
    );

    const target = new Date(`${openDate}T16:00:00-03:00`);

    await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(buildOrder({ desiredDeliveryTime: target.toISOString() }))
      .expect(400)
      .expect((res) => {
        expect(res.body.message).toMatch(/entre 10:00 y 14:30/);
      });
  });
});

describe('Horario de entrega deseado (delivery types y tracking)', () => {
  beforeEach(async () => {
    await seedSchedule(app, tenantId, 1, '09:00', '22:00', '21:30:00');
    await seedSchedule(app, tenantId, 2, '09:00', '22:00', '21:30:00');
    await seedSchedule(app, tenantId, 3, '09:00', '22:00', '21:30:00');
    await seedSchedule(app, tenantId, 4, '09:00', '22:00', '21:30:00');
    await seedSchedule(app, tenantId, 5, '09:00', '22:00', '21:30:00');
    await seedSchedule(app, tenantId, 6, '09:00', '22:00', '21:30:00');
  });

  it('crea pedido con RETIRO_LOCAL y desiredDeliveryTime válido', async () => {
    const target = nextDateWithDayOfWeek(1, 14, 0, 1);

    await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(
        buildOrder({
          desiredDeliveryTime: target.toISOString(),
          deliveryType: 'RETIRO_LOCAL',
        }),
      )
      .expect(201);
  });

  it('crea pedido con ENVIO_DOMICILIO y desiredDeliveryTime válido', async () => {
    const target = nextDateWithDayOfWeek(1, 14, 0, 1);

    await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send({
        ...buildOrder({
          desiredDeliveryTime: target.toISOString(),
          deliveryType: 'ENVIO_DOMICILIO',
        }),
        address: 'Calle Falsa 123',
      })
      .expect(201);
  });

  it('GET track devuelve desiredDeliveryTime', async () => {
    const target = nextDateWithDayOfWeek(1, 14, 0, 1);
    const iso = target.toISOString();

    const created = await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(buildOrder({ desiredDeliveryTime: iso }))
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/${SLUG}/orders/${created.body.trackingUuid}/track`)
      .expect(200);

    expect(res.body.desiredDeliveryTime).toBe(iso);
  });

  it('whatsapp-link incluye línea programada para RETIRO_LOCAL', async () => {
    const target = nextDateWithDayOfWeek(1, 14, 0, 1);

    const created = await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send(buildOrder({ desiredDeliveryTime: target.toISOString() }))
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/${SLUG}/orders/${created.body.id}/whatsapp-link`)
      .set(auth(token))
      .expect(200);

    expect(res.body.message).toMatch(/Horario de retiro programado:/);
  });

  it('whatsapp-link incluye "entrega" para ENVIO_DOMICILIO', async () => {
    const target = nextDateWithDayOfWeek(1, 14, 0, 1);

    const created = await request(app.getHttpServer())
      .post(`/${SLUG}/orders`)
      .send({
        ...buildOrder({
          desiredDeliveryTime: target.toISOString(),
          deliveryType: 'ENVIO_DOMICILIO',
        }),
        address: 'Calle Falsa 123',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/${SLUG}/orders/${created.body.id}/whatsapp-link`)
      .set(auth(token))
      .expect(200);

    expect(res.body.message).toMatch(/Horario de entrega programado:/);
  });
});

describe('Schedule CRUD con maxOrderTime', () => {
  it('POST admin/schedule persiste maxOrderTime', async () => {
    const res = await request(app.getHttpServer())
      .post(`/${SLUG}/admin/schedule`)
      .set(auth(token))
      .send({
        dayOfWeek: 1,
        openingTime: '09:00',
        closingTime: '22:00',
        maxOrderTime: '21:00',
      })
      .expect(201);

    expect(normalizeHHmm(res.body.maxOrderTime)).toBe('21:00');

    const list = await request(app.getHttpServer())
      .get(`/${SLUG}/admin/schedule`)
      .set(auth(token))
      .expect(200);

    expect(normalizeHHmm(list.body[0].maxOrderTime)).toBe('21:00');
  });

  it('PATCH admin/schedule/:id actualiza maxOrderTime', async () => {
    const created = await request(app.getHttpServer())
      .post(`/${SLUG}/admin/schedule`)
      .set(auth(token))
      .send({
        dayOfWeek: 1,
        openingTime: '09:00',
        closingTime: '22:00',
      })
      .expect(201);

    expect(created.body.maxOrderTime).toBeNull();

    const res = await request(app.getHttpServer())
      .patch(`/${SLUG}/admin/schedule/${created.body.id}`)
      .set(auth(token))
      .send({ maxOrderTime: '20:30' })
      .expect(200);

    expect(normalizeHHmm(res.body.maxOrderTime)).toBe('20:30');
  });

  it('PATCH admin/tenants persiste minimumDeliveryTime', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/${SLUG}/admin/tenants`)
      .set(auth(token))
      .send({ minimumDeliveryTime: 45 })
      .expect(200);

    expect(res.body.minimumDeliveryTime).toBe(45);

    const config = await request(app.getHttpServer())
      .get(`/${SLUG}/availability`)
      .expect(200);

    expect(config.body.minimumDeliveryTime).toBe(45);
    expect(config.body.maxOrderTime).toBeUndefined();
  });

  it('PATCH admin/tenants con maxOrderTime no lo acepta (validación DTO)', async () => {
    await request(app.getHttpServer())
      .patch(`/${SLUG}/admin/tenants`)
      .set(auth(token))
      .send({ maxOrderTime: '22:00' })
      .expect(400);
  });
});

describe('Exception CRUD con maxOrderTime', () => {
  it('POST admin/exceptions con isOpen=true requiere maxOrderTime', async () => {
    await request(app.getHttpServer())
      .post(`/${SLUG}/admin/exceptions`)
      .set(auth(token))
      .send({
        date: '2030-12-25',
        isOpen: true,
        openingTime: '10:00',
        closingTime: '15:00',
      })
      .expect(400);
  });

  it('POST admin/exceptions con isOpen=true persiste maxOrderTime', async () => {
    const res = await request(app.getHttpServer())
      .post(`/${SLUG}/admin/exceptions`)
      .set(auth(token))
      .send({
        date: '2030-12-25',
        isOpen: true,
        openingTime: '10:00',
        closingTime: '15:00',
        maxOrderTime: '14:30',
      })
      .expect(201);

    expect(normalizeHHmm(res.body.maxOrderTime)).toBe('14:30');
  });

  it('POST admin/exceptions con isOpen=false persiste maxOrderTime=null', async () => {
    const res = await request(app.getHttpServer())
      .post(`/${SLUG}/admin/exceptions`)
      .set(auth(token))
      .send({
        date: '2030-12-25',
        isOpen: false,
      })
      .expect(201);

    expect(res.body.maxOrderTime).toBeNull();
  });
});
