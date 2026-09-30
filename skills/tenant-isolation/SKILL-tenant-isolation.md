# SKILL: Tenant Isolation (NestJS + TypeORM)

## Objetivo
Garantizar que cada operación de base de datos esté filtrada por `tenantId`, de modo que los datos de un negocio nunca sean visibles ni modificables por otro.

---

## 1. Fuentes del tenantId según contexto

**En el código TypeScript se usa `tenantId`.** `tenant_id` es solo el nombre de la columna en la base de datos (`@Column({ name: 'tenant_id' }) tenantId: string`).

**Todas** las rutas llevan el slug `/:tenant` en la URL. Únicas excepciones: `GET /`, `POST /auth/register`, `POST /auth/login` y `GET /auth/me`.

### Rutas públicas (sin autenticación)
El `tenantId` se obtiene desde el slug de la URL. Un middleware de NestJS extrae el slug, busca el tenant en la BD y adjunta el `tenantId` al objeto `request`. Si el slug no existe, corta con `NotFoundException`.

```typescript
// src/core/tenant/tenant.middleware.ts
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const slug = req.params.tenant as string;
    if (!slug) {
      return next();
    }
    const tenant = await this.tenantRepo.findOne({ where: { slug } });
    if (!tenant) {
      throw new NotFoundException('Tenant no encontrado');
    }
    req['tenantId'] = tenant.id;
    next();
  }
}
```

El middleware se aplica de forma **explícita por ruta** en `app.module.ts` (`consumer.apply(TenantMiddleware).forRoutes(...)`): menú, pedidos (alta, listado, tracking, SSE, teléfono del cliente), categorías, productos, disponibilidad y todo `/:tenant/admin/*path`. Las rutas protegidas de detalle (`:id`, `:id/status`, etc.) no lo necesitan porque el `tenantId` sale del JWT.

### Rutas privadas (con JWT)
El `tenantId` se extrae **exclusivamente** del payload del JWT. Nunca del body, query params ni headers manuales — aunque el slug siga presente en la URL. El JWT puede llegar por header `Authorization: Bearer <token>` o por cookie HttpOnly `access_token`; ambos los resuelve `JwtStrategy`.

```typescript
// src/common/decorators/tenant-id.decorator.ts
export const TenantId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return user?.tenantId ?? request['tenantId'];
  },
);
```

El decorador prioriza `request.user.tenantId` (JWT) sobre `request['tenantId']` (middleware): en rutas protegidas manda siempre el token.

---

## 2. Patrón de uso en controladores

```typescript
// Ruta pública — tenantId desde middleware
@Get('menu')
getMenu(@TenantId() tenantId: string) {
  return this.productsService.findAll(tenantId);
}

// Ruta privada — tenantId desde JWT (el guard ya validó el token)
@UseGuards(JwtAuthGuard)
@Get('admin/orders')
getOrders(@TenantId() tenantId: string) {
  return this.ordersService.findAll(tenantId);
}
```

**Regla:** Ningún DTO de entrada puede tener un campo `tenantId`. El decorador `@TenantId()` es la única forma de obtenerlo.

---

## 3. Patrón de uso en servicios (repositorios)

Todo `find`, `findOne`, `count`, `update` y `delete` debe incluir `tenantId` en el `where`. Sin excepción.

```typescript
// CORRECTO
findAll(tenantId: string) {
  return this.productRepo.find({ where: { tenantId } });
}

findOne(id: string, tenantId: string) {
  return this.productRepo.findOne({
    where: { id, tenantId },
  });
}

// INCORRECTO — busca en todos los tenants
findAll() {
  return this.productRepo.find(); // ❌ falta tenantId
}
```

> No agregar `deletedAt: IsNull()` al `where`: `@DeleteDateColumn()` ya lo excluye automáticamente de todas las consultas, y el skill `soft-delete` lo prohíbe explícitamente.

---

## 4. Definición de entidades con tenantId

Las entidades **Tenant-scoped** (las que pertenecen a un negocio) deben tener la columna `tenantId` indexada.

```typescript
@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  // Siempre presente, siempre indexado
  @Index()
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}
```

### Entidades con aislamiento indirecto

`OrderItem`, `Customer` y `Delivery` **no** tienen `tenantId` propio: no son Tenant-scoped. Se aíslan a través de su relación con `Order`.

**Regla:** toda consulta a `OrderItem`, `Customer` o `Delivery` debe pasar por un `Order` ya filtrado por `tenantId` — nunca consultar esas tablas de forma directa.

```typescript
// CORRECTO — se llega al pedido filtrando por tenantId
const order = await this.orderRepo.findOne({
  where: { id, tenantId },
  relations: { items: true, customer: true, delivery: true },
});

// INCORRECTO — consulta directa sin anclaje al tenant
await this.orderItemRepo.find({ where: { orderId } }); // ❌ sin tenantId
```

---

## 5. Checklist antes de hacer commit

- [ ] ¿Cada `find` / `findOne` incluye `tenantId` en el `where`?
- [ ] ¿Ningún DTO tiene `tenantId` como campo de entrada?
- [ ] ¿El decorador `@TenantId()` se usa en lugar de `@Body('tenantId')`?
- [ ] ¿Las entidades Tenant-scoped (`User`, `Category`, `Product`, `Order`, `RegularSchedule`, `AvailabilityException`) tienen `@Index()` en `tenantId`?
- [ ] ¿`OrderItem`, `Customer` y `Delivery` se consultan siempre a través de un `Order` filtrado por `tenantId` (nunca directo)?
- [ ] ¿Las rutas privadas usan `@UseGuards(JwtAuthGuard)` y las públicas no?
- [ ] ¿El `where` no incluye `deletedAt: IsNull()` (lo resuelve `@DeleteDateColumn()`)?

---

## Project Context

### Fuentes de tenantId en este proyecto

```
Todas las rutas:  /:tenant/...   (salvo GET /, POST /auth/register,
                                 POST /auth/login, GET /auth/me)

Rutas públicas:  tenantId ← slug de URL → TenantMiddleware → request['tenantId']
                 Ejemplo: tuapp.com/donpepe/menu → slug = 'donpepe'

Rutas privadas:  tenantId ← payload JWT → JwtStrategy → request.user.tenantId
                 El JWT se emite en login con { userId, tenantId } adentro
                 y se acepta por header Bearer o por cookie HttpOnly access_token
```

**Regla crítica de seguridad:** En ningún caso el backend acepta un `tenantId` enviado manualmente en el body o parámetros de la request para operaciones protegidas. El token es la única fuente válida. (Documentación V3, sección 3)

### Entidades que requieren tenantId en este proyecto

| Entidad | Tabla | Módulo | ¿`tenantId` propio? |
|---|---|---|---|
| `Tenant` | `tenants` | `src/modules/tenants/` | No — es el tenant |
| `User` | `users` | `src/modules/auth/` | Sí, indexado |
| `Category` | `categories` | `src/modules/categories/` | Sí, indexado |
| `Product` | `products` | `src/modules/products/` | Sí, indexado |
| `Order` | `orders` | `src/modules/orders/` | Sí, indexado |
| `RegularSchedule` | `regular_schedules` | `src/modules/tenants/` | Sí, indexado |
| `AvailabilityException` | `availability_exceptions` | `src/modules/tenants/` | Sí, indexado |

### Entidades con aislamiento indirecto

| Entidad | Tabla | Se aísla por |
|---|---|---|
| `OrderItem` | `order_items` | `order.tenantId` (FK `order_id`) |
| `Customer` | `customers` | `order.tenantId` (FK `customer_id`) |
| `Delivery` | `deliveries` | `order.tenantId` (FK `delivery_id`) |

`OrderItem`, `Customer` y `Delivery` no tienen `tenantId` directo — se aíslan a través de su FK a `Order`. Toda consulta a ellas debe pasar por un `Order` filtrado por `tenantId`.

### Ejemplo de query del proyecto (de la documentación)

```sql
-- Los pedidos siempre se filtran por tenant
SELECT * FROM orders WHERE tenant_id = 'donpepe';

-- Los productos también
SELECT * FROM products WHERE tenant_id = 'donpepe';

-- order_items no se consulta directo: se llega por el pedido ya filtrado
SELECT * FROM order_items WHERE order_id = (SELECT id FROM orders WHERE tenant_id = 'donpepe');
```
