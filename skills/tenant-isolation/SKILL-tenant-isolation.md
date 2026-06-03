# SKILL: Tenant Isolation (NestJS + TypeORM)

## Objetivo
Garantizar que cada operación de base de datos esté filtrada por `tenant_id`, de modo que los datos de un negocio nunca sean visibles ni modificables por otro.

---

## 1. Fuentes del tenant_id según contexto

### Rutas públicas (sin autenticación)
El `tenant_id` se obtiene desde el slug de la URL. Un middleware de NestJS extrae el slug, busca el tenant en la BD y adjunta el `tenant_id` al objeto `request`.

```typescript
// src/core/tenant/tenant.middleware.ts
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const slug = req.params.tenant; // extraído de la URL: /donpepe/...
    const tenant = await this.tenantRepo.findOne({ where: { slug } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');
    req['tenantId'] = tenant.id;
    next();
  }
}
```

### Rutas privadas (con JWT)
El `tenant_id` se extrae **exclusivamente** del payload del JWT. Nunca del body, query params ni headers manuales.

```typescript
// src/common/decorators/tenant-id.decorator.ts
export const TenantId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    // En rutas públicas viene del middleware; en privadas del JWT
    const user = request.user; // seteado por JwtAuthGuard
    return user?.tenantId ?? request['tenantId'];
  },
);
```

---

## 2. Patrón de uso en controladores

```typescript
// Ruta pública — tenant_id desde middleware
@Get('menu')
getMenu(@TenantId() tenantId: string) {
  return this.productsService.findAll(tenantId);
}

// Ruta privada — tenant_id desde JWT (el guard ya validó el token)
@UseGuards(JwtAuthGuard)
@Get('admin/orders')
getOrders(@TenantId() tenantId: string) {
  return this.ordersService.findAll(tenantId);
}
```

**Regla:** Ningún DTO de entrada puede tener un campo `tenantId` o `tenant_id`. El decorador `@TenantId()` es la única forma de obtenerlo.

---

## 3. Patrón de uso en servicios (repositorios)

Todo `find`, `findOne`, `count`, `update` y `delete` debe incluir `tenantId` en el `where`. Sin excepción.

```typescript
// CORRECTO
findAll(tenantId: string) {
  return this.productRepo.find({
    where: { tenantId, deletedAt: IsNull() },
  });
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

---

## 4. Definición de entidades con tenant_id

Todas las entidades que pertenezcan a un negocio deben tener la columna `tenantId` indexada.

```typescript
@Entity()
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  nombre: string;

  // Siempre presente, siempre indexado
  @Index()
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}
```

---

## 5. Checklist antes de hacer commit

- [ ] ¿Cada `find` / `findOne` incluye `tenantId` en el `where`?
- [ ] ¿Ningún DTO tiene `tenantId` como campo de entrada?
- [ ] ¿El decorador `@TenantId()` se usa en lugar de `@Body('tenantId')`?
- [ ] ¿Las entidades con datos de negocio tienen `@Index()` en `tenantId`?
- [ ] ¿Las rutas privadas usan `@UseGuards(JwtAuthGuard)` y las públicas no?

---

## Project Context

### Fuentes de tenant_id en este proyecto

```
Rutas públicas:  tenant_id ← slug de URL → middleware → request['tenantId']
                 Ejemplo: tuapp.com/donpepe → slug = 'donpepe'

Rutas privadas:  tenant_id ← payload JWT → JwtAuthGuard → request.user.tenantId
                 El JWT se emite en login con { userId, tenantId } adentro
```

**Regla crítica de seguridad:** En ningún caso el backend acepta un `tenant_id` enviado manualmente en el body o parámetros de la request para operaciones protegidas. El token es la única fuente válida. (Documentación V3, sección 3)

### Entidades que requieren tenant_id en este proyecto

| Entidad | Módulo |
|---|---|
| `Tenant` | `src/modules/tenants/` |
| `User` | `src/modules/auth/` |
| `Category` | `src/modules/categories/` |
| `Product` | `src/modules/products/` |
| `Order` | `src/modules/orders/` |
| `RegularSchedule` | `src/modules/tenants/` |
| `AvailabilityException` | `src/modules/tenants/` |

`OrderItem`, `Customer` y `Delivery` no tienen `tenant_id` directo — se aíslan a través de su FK a `Order`.

### Ejemplo de query del proyecto (de la documentación)

```sql
-- Los pedidos siempre se filtran por tenant
SELECT * FROM orders WHERE tenant_id = 'donpepe';

-- Los productos también
SELECT * FROM products WHERE tenant_id = 'donpepe';
```
