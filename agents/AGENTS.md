# AGENTS.md — Sistema de Pedidos Online (Backend NestJS)
> **Fuente de verdad absoluta:** `/documentation/documentation_sistema_pedidos_online_V3.md` (V3.4)
> **Raíz de trabajo:** la raíz del repo. El backend NestJS vive en `backend_pedidos/` (código en `backend_pedidos/src/`), la documentación en `documentation/`, estas instrucciones en `agents/AGENTS.md` y las skills en `skills/`.

---

## LECTURA OBLIGATORIA ANTES DE CUALQUIER TAREA

Antes de responder cualquier petición, el agente activo debe leer en este orden:

1. Este archivo (`AGENTS.md`) — roles, protocolo y restricciones.
2. La sección relevante de `/documentation/documentation_sistema_pedidos_online_V3.md` (V3.4) — reglas de negocio.
3. `/documentation/diagrams.md` — diagramas de clases, ER, estados y casos de uso.
4. Las Skills de `/skills/` que apliquen a la tarea.

**Si no leíste los cuatro puntos, no estás habilitado para generar el Plan de Acción.**

---

## 1. Definición de Roles

### Agente Arquitecto
- **Cuándo se activa:** Al iniciar un módulo nuevo o al agregar archivos al proyecto.
- **Responsabilidades:**
  - Validar que la estructura de carpetas respete `src/modules/<modulo>/{entities,dto,*.controller.ts,*.service.ts,*.module.ts}`.
  - Un módulo puede agrupar **varias entidades** en su `entities/` cuando forman parte del mismo agregado. Caso vigente: `src/modules/orders/entities/` contiene `Order`, `OrderItem`, `Customer` y `Delivery` — cuatro entidades del agregado `Order`, no cuatro módulos.
  - Asegurar que nada de lógica de dominio caiga en `common/` ni en `core/`.
  - Aprobar el listado de archivos del Plan de Acción antes de que otro agente escriba.
- **Checklist de validación:**
  - [ ] ¿Las entidades están dentro del módulo correcto, no en `common/`?
  - [ ] ¿El módulo nuevo está importado en `app.module.ts`?
  - [ ] ¿No se duplican responsabilidades entre módulos?

---

### Agente de Persistencia
- **Cuándo se activa:** Al crear o modificar entidades, migraciones o repositorios.
- **Responsabilidades:**
  - Escribir entidades TypeORM que reflejen fielmente el modelo de datos de la documentación.
  - Aplicar `tenant-isolation` en **todos** los repositorios: todo `find`, `findOne` y `query` debe filtrar por `tenantId`.
  - Aplicar `soft-delete` con `@DeleteDateColumn() deletedAt` **exclusivamente** en `Product` y `Category`.
  - Guardar snapshot de precio Y nombre en `order_items` (tabla real) — nunca referenciar el nombre del producto en vivo.
- **Checklist de validación:**
  - [ ] ¿Las entidades Tenant-scoped (`User`, `Category`, `Product`, `Order`, `RegularSchedule`, `AvailabilityException`) tienen `tenantId` como `@Column()` indexado?
  - [ ] ¿`OrderItem`, `Customer` y `Delivery` NO tienen `tenantId` propio? Se aíslan vía `order.tenantId`: toda consulta a ellas debe pasar por un `Order` filtrado por `tenantId`.
  - [ ] ¿`Product` y `Category` tienen `@DeleteDateColumn()`? ¿Solo ellos?
  - [ ] ¿`order_items` (tabla real) tiene `price` y `name` como columnas propias (snapshot)?
  - [ ] ¿`dayOfWeek` en `RegularSchedule` (tabla real `regular_schedules`) es `SMALLINT` con rango 1–7 (ISO 8601)?
  - [ ] ¿La entidad `Delivery` tiene FK a `Order` y guarda `deliveryFee` al momento del pedido?

---

### Agente de Dominio
- **Cuándo se activa:** Al escribir controladores, servicios y DTOs.
- **Responsabilidades:**
  - Implementar **exclusivamente** los casos de uso definidos en `/documentation/documentation_sistema_pedidos_online_V3.md` y en `/documentation/diagrams.md`. Cualquier funcionalidad que no aparezca en esos documentos es fuera del MVP y no debe codificarse.
  - Usar `class-validator` + `class-transformer` en todos los DTOs. Sin validación, sin DTO.
  - El `tenantId` en rutas protegidas **siempre** se extrae del JWT, nunca del body ni de query params.
  - El `tenantId` en rutas públicas se extrae del middleware de tenant (por URL/slug).
  - **Restricción dura:** No inventar lógica, campos ni endpoints que no estén en el MVP documentado.
- **Checklist de validación:**
  - [ ] ¿Las rutas públicas no tienen `JwtAuthGuard`?
  - [ ] ¿Las rutas de `/admin` tienen `@UseGuards(JwtAuthGuard)`?
  - [ ] ¿Ningún DTO acepta `tenantId` como campo de entrada?
  - [ ] ¿Los servicios inyectan repositorios y no hacen queries de infraestructura directamente?
  - [ ] ¿La máquina de estados de pedidos respeta la matriz? (ver sección 3)

---

### Agente QA
- **Cuándo se activa:** Después de cada iteración de escritura de código.
- **Responsabilidades:**
  - Verificar que el código compile y no tenga errores de TypeScript evidentes.
  - Controlar reglas críticas de negocio que los otros agentes pueden pasar por alto.
  - Revisar que no haya vulnerabilidades de aislamiento entre tenants.
- **Checklist de validación:**
  - [ ] ¿`dayOfWeek` usa convención 1=Lunes, 7=Domingo? ¿Se convierte correctamente desde `Date.getDay()` (JS usa 0=Domingo)?
  - [ ] ¿Los estados terminales (`Entregado`, `Cancelado`, `No Retirado`) no tienen transiciones de salida?
  - [ ] ¿El SSE se cierra automáticamente cuando el pedido llega a estado terminal?
  - [ ] ¿`deliveryFee` se copia a la entidad `Delivery` al momento del pedido, no se lee en vivo del tenant?
  - [ ] ¿Un dueño no puede acceder a datos de otro tenant aunque manipule el JWT?

---

## 2. Protocolo de Plan de Acción (Obligatorio)

**Ningún agente puede escribir código sin presentar primero un Plan de Acción aprobado por el usuario.**

### Formato del Plan de Acción

```
## Plan de Acción — [Nombre del módulo / CU]

**Agente activo:** [Arquitecto | Persistencia | Dominio | QA]
**Caso de uso de referencia:** [CU-XX o "Infraestructura base"]
**Skills que se aplicarán:** [lista de skills relevantes]
**Secciones de documentación consultadas:** [secciones del V3]

### Archivos a crear:
- `ruta/exacta/del/archivo.ts` — descripción de qué hace

### Archivos a modificar:
- `ruta/exacta/del/archivo.ts` — qué se modifica y por qué

### Boceto de métodos / estructura:
[Pseudocódigo o firma de métodos, sin implementación completa]

### Restricciones aplicadas:
[Qué reglas de negocio o de arquitectura condicionan este plan]
```

> **Límite duro: máximo 2 archivos por iteración.** Si la tarea requiere más, dividirla en iteraciones separadas y esperar aprobación en cada una.

### Ciclo de trabajo

```
[Petición] → [Plan de Acción] → [Aprobación: "Proceder"] → [Escritura de código] → [QA]
                                        ↑
                             Si el plan no es claro,
                             el usuario pide ajustes
                             antes de aprobar.
```

### Regla de recuperación ante corte de texto

Si el modelo corta la respuesta antes de terminar un archivo:
1. No reescribir desde cero.
2. Escribir en el chat: `"CONTINUACIÓN — [nombre del archivo]"` y retomar desde la última línea completa.
3. El usuario confirma con `"Continuar"` antes de que el agente retome.

---

## 3. Reglas de Negocio Críticas (Referencia Rápida)

Estas reglas son no negociables. Cualquier código que las viole debe ser rechazado.

### Máquina de estados de pedidos
> Diagrama completo y visual en `/documentation/diagrams.md` → sección "Diagrama de Máquina de Estados".

```
PENDIENTE ──→ EN_PREPARACION ──→ LISTO ──→ ENTREGADO ✓
     └──────────────────────────────→ CANCELADO ✓
                                      LISTO ──→ NO_RETIRADO ✓
```
- `ENTREGADO`, `CANCELADO` y `NO_RETIRADO` son estados terminales: sin transiciones de salida.
- `CANCELADO` solo es accesible desde `PENDIENTE` o `EN_PREPARACION`.
- `NO_RETIRADO` solo es accesible desde `LISTO`.

### Aislamiento de tenants
- **Todas** las rutas llevan el slug `/:tenant` en la URL. Únicas excepciones: `GET /`, `POST /auth/register`, `POST /auth/login` y `GET /auth/me`.
- Rutas públicas: `tenantId` desde middleware (slug de URL).
- Rutas privadas: `tenantId` desde payload del JWT. Aunque el slug siga en la URL, el `tenantId` efectivo se toma **solo** del JWT (`@TenantId()` prioriza `request.user.tenantId` sobre el del middleware).
- El JWT puede llegar por header `Authorization: Bearer <token>` o por cookie HttpOnly `access_token`.
- **Nunca** aceptar `tenantId` en body, query params o headers de rutas protegidas.

### Horarios — ISO 8601
- `dayOfWeek`: `SMALLINT`, `1 = Lunes`, `7 = Domingo`.
- JS `Date.getDay()` retorna `0 = Domingo`. La conversión es: `(date.getDay() + 6) % 7 + 1`.
- Si `dayOfWeek` no tiene filas en `regular_schedules`, el local **no abre ese día**.
- `AvailabilityException` con `isOpen = false`: `openingTime` y `closingTime` deben ser `null`.

### Soft Delete
- `@DeleteDateColumn()` **solo** en `Product` y `Category`.
- Los registros con `deletedAt != null` no deben aparecer en **ninguna** consulta pública.
- `Category` y `Product` además tienen `isActive` (ocultar / activar), que es **independiente** del soft delete: `isActive = false` oculta sin borrar, y el registro se puede volver a activar.
- Un producto no se lista en el catálogo público si está oculto (`isActive = false`), o si su categoría está oculta (`category.isActive = false`) o borrada (`category.deletedAt != null`).
- Los `order_items` históricos **no se tocan** aunque el producto sea eliminado.

### Snapshots en order_items
- Guardar `name` y `price` del producto **al momento del pedido**.
- Nunca leer el nombre o precio del producto en vivo para mostrar un pedido histórico.

### Convención de nombres
- **Código, campos y endpoints en inglés**: `status`, `cancellationReason`, `isActive`, `name`, `price`, `tenantId`, `dayOfWeek`, `trackingUuid`.
- Los **valores** de enums de estados y pagos siguen en español: `PENDIENTE`, `EN_PREPARACION`, `LISTO`, `ENTREGADO`, `CANCELADO`, `NO_RETIRADO`, `EFECTIVO`, etc.
- La conversión a ISO del día se mantiene: `(date.getDay() + 6) % 7 + 1`.

### SSE — Seguimiento de pedido
- La conexión SSE se abre en `GET /:tenant/orders/:uuid/status-stream`, buscando el pedido por `trackingUuid`.
- Se cierra automáticamente al llegar a estado terminal (`ENTREGADO`, `CANCELADO`, `NO_RETIRADO`).
- El cliente no necesita autenticación para esta ruta (es pública por `trackingUuid`).

---

## 4. Skills Disponibles

| Skill | Ruta | Cuándo usarla |
|---|---|---|
| `tenant-isolation` | `skills/tenant-isolation/SKILL-tenant-isolation.md` | Toda entidad o repositorio con `tenantId` |
| `soft-delete` | `skills/soft-delete/SKILL-soft-delete.md` | Entidades `Product` y `Category` |
| `order-state-machine` | `skills/order-state-machine/SKILL-order-state-machine.md` | Servicio y DTOs de `orders` |
| `snapshot-order-items` | `skills/snapshot-order-items/SKILL-snapshot-order-items.md` | Entidad y servicio de `order-items` |

---

## 5. Módulos del MVP y Estado

| Módulo | Ruta | Entidades incluidas | Estado |
|---|---|---|---|
| Auth | `src/modules/auth/` | `User` | ✅ Listo |
| Tenants | `src/modules/tenants/` | `Tenant`, `RegularSchedule`, `AvailabilityException` | ✅ Listo |
| Categories | `src/modules/categories/` | `Category` | ✅ Listo |
| Products | `src/modules/products/` | `Product` | ✅ Listo |
| Orders | `src/modules/orders/` | `Order`, `OrderItem`, `Customer`, `Delivery` | ✅ Listo |
| Core / Tenant MW | `src/core/tenant/` | — | ✅ Listo |

**Notas de agrupación:**
- `RegularSchedule` y `AvailabilityException` viven dentro de `tenants/` porque son configuración del negocio, no entidades de dominio independientes.
- `Customer` es un snapshot de auditoría (no un usuario con sesión) y vive como entidad interna de `orders/`: se crea junto al pedido y no tiene módulo propio.
- `Delivery` guarda los datos de envío al momento del pedido y vive como entidad interna de `orders/`: el `deliveryFee` se **copia** desde el tenant al crear el pedido, no se lee en vivo.
- `OrderItem` es el snapshot de `name` y `price` del producto y vive como entidad interna de `orders/`: un pedido histórico nunca lee el producto en vivo.
- `User` vive en `auth/` porque su único rol en el MVP es autenticar al dueño.

> Actualizar el estado a `🔄 En progreso` o `✅ Listo` a medida que se avanza.

---

## 6. Pendientes del MVP

- **Registrar pedido manual desde el panel admin** — caso de uso del diagrama de casos de uso (`/documentation/diagrams.md` → Owner → Pedidos): *"Registrar pedido manual — por si el pedido llega por otra fuente (teléfono, etc.)"*. **Aún sin implementar.** Se abordará en iteraciones chicas, **backend primero y frontend después**.

> El roadmap completo pre-despliegue irá en `ROADMAP.md` (iteración 4). Acá solo se referencian los pendientes conocidos.

---

*AGENTS.md — v1.4 | Proyecto: Backend pedidos online | Stack: NestJS + TypeORM + PostgreSQL*
