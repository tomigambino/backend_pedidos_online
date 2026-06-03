# AGENTS.md — Sistema de Pedidos Online (Backend NestJS)
> **Fuente de verdad absoluta:** `/documentation/documentation_sistema_pedidos_online_V3.md`
> **Raíz de trabajo:** `Backend pedidos online/` — OpenCode debe abrirse siempre desde aquí.

---

## LECTURA OBLIGATORIA ANTES DE CUALQUIER TAREA

Antes de responder cualquier petición, el agente activo debe leer en este orden:

1. Este archivo (`AGENTS.md`) — roles, protocolo y restricciones.
2. La sección relevante de `/documentation/documentation_sistema_pedidos_online_V3.md` — reglas de negocio.
3. `/documentation/diagrams.md` — diagramas de clases, ER, estados y casos de uso.
4. Las Skills de `/skills/` que apliquen a la tarea.

**Si no leíste los cuatro puntos, no estás habilitado para generar el Plan de Acción.**

---

## 1. Definición de Roles

### 🏛️ Agente Arquitecto
- **Cuándo se activa:** Al iniciar un módulo nuevo o al agregar archivos al proyecto.
- **Responsabilidades:**
  - Validar que la estructura de carpetas respete `src/modules/<modulo>/{entities,dto,*.controller.ts,*.service.ts,*.module.ts}`.
  - Asegurar que nada de lógica de dominio caiga en `common/` ni en `core/`.
  - Aprobar el listado de archivos del Plan de Acción antes de que otro agente escriba.
- **Checklist de validación:**
  - [ ] ¿Las entidades están dentro del módulo correcto, no en `common/`?
  - [ ] ¿El módulo nuevo está importado en `app.module.ts`?
  - [ ] ¿No se duplican responsabilidades entre módulos?

---

### 🗄️ Agente de Persistencia
- **Cuándo se activa:** Al crear o modificar entidades, migraciones o repositorios.
- **Responsabilidades:**
  - Escribir entidades TypeORM que reflejen fielmente el modelo de datos de la documentación.
  - Aplicar `tenant-isolation` en **todos** los repositorios: todo `find`, `findOne` y `query` debe incluir `where: { tenant_id }`.
  - Aplicar `soft-delete` con `@DeleteDateColumn() deletedAt` **exclusivamente** en `Product` y `Category`.
  - Guardar snapshot de precio Y nombre en `order_items` (nunca referenciar el nombre del producto en vivo).
- **Checklist de validación:**
  - [ ] ¿Todas las entidades con `tenant_id` lo tienen como `@Column()` indexado?
  - [ ] ¿`Product` y `Category` tienen `@DeleteDateColumn()`? ¿Solo ellos?
  - [ ] ¿`order_items` tiene `precio` y `nombre` como columnas propias (snapshot)?
  - [ ] ¿`dia_semana` en `horario_regular` es `SMALLINT` con rango 1–7 (ISO 8601)?
  - [ ] ¿La entidad `delivery` tiene FK a `orders` y guarda `costo_envio` al momento del pedido?

---

### ⚙️ Agente de Dominio
- **Cuándo se activa:** Al escribir controladores, servicios y DTOs.
- **Responsabilidades:**
  - Implementar **exclusivamente** los casos de uso definidos en `/documentation/documentation_sistema_pedidos_online_V3.md` y en `/documentation/diagrams.md`. Cualquier funcionalidad que no aparezca en esos documentos es fuera del MVP y no debe codificarse.
  - Usar `class-validator` + `class-transformer` en todos los DTOs. Sin validación, sin DTO.
  - El `tenant_id` en rutas protegidas **siempre** se extrae del JWT, nunca del body ni de query params.
  - El `tenant_id` en rutas públicas se extrae del middleware de tenant (por URL/slug).
  - **Restricción dura:** No inventar lógica, campos ni endpoints que no estén en el MVP documentado.
- **Checklist de validación:**
  - [ ] ¿Las rutas públicas no tienen `JwtAuthGuard`?
  - [ ] ¿Las rutas de `/admin` tienen `@UseGuards(JwtAuthGuard)`?
  - [ ] ¿Ningún DTO acepta `tenant_id` como campo de entrada?
  - [ ] ¿Los servicios inyectan repositorios y no hacen queries de infraestructura directamente?
  - [ ] ¿La máquina de estados de pedidos respeta la matriz? (ver sección 3)

---

### 🔍 Agente QA
- **Cuándo se activa:** Después de cada iteración de escritura de código.
- **Responsabilidades:**
  - Verificar que el código compile y no tenga errores de TypeScript evidentes.
  - Controlar reglas críticas de negocio que los otros agentes pueden pasar por alto.
  - Revisar que no haya vulnerabilidades de aislamiento entre tenants.
- **Checklist de validación:**
  - [ ] ¿`dia_semana` usa convención 1=Lunes, 7=Domingo? ¿Se convierte correctamente desde `Date.getDay()` (JS usa 0=Domingo)?
  - [ ] ¿Los estados terminales (`Entregado`, `Cancelado`, `No Retirado`) no tienen transiciones de salida?
  - [ ] ¿El SSE se cierra automáticamente cuando el pedido llega a estado terminal?
  - [ ] ¿`delivery_cost` se copia a la entidad `delivery` al momento del pedido, no se lee en vivo del tenant?
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

> ⚠️ **Límite duro: máximo 2 archivos por iteración.** Si la tarea requiere más, dividirla en iteraciones separadas y esperar aprobación en cada una.

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
- Rutas públicas: `tenant_id` desde middleware (slug de URL).
- Rutas privadas: `tenant_id` desde payload del JWT.
- **Nunca** aceptar `tenant_id` en body, query params o headers de rutas protegidas.

### Horarios — ISO 8601
- `dia_semana`: `SMALLINT`, `1 = Lunes`, `7 = Domingo`.
- JS `Date.getDay()` retorna `0 = Domingo`. La conversión es: `(date.getDay() + 6) % 7 + 1`.
- Si `dia_semana` no tiene filas en `horario_regular`, el local **no abre ese día**.
- `ExcepcionDisponibilidad` con `esta_abierto = false`: `hora_apertura` y `hora_cierre` deben ser `null`.

### Soft Delete
- `@DeleteDateColumn()` **solo** en `Product` y `Category`.
- Los registros con `deletedAt != null` no deben aparecer en **ninguna** consulta pública.
- Los `order_items` históricos **no se tocan** aunque el producto sea eliminado.

### Snapshots en order_items
- Guardar `nombre` y `precio` del producto **al momento del pedido**.
- Nunca leer el nombre o precio del producto en vivo para mostrar un pedido histórico.

### SSE — Seguimiento de pedido
- La conexión SSE se abre en `GET /orders/:uuid/status-stream`.
- Se cierra automáticamente al llegar a estado terminal (`ENTREGADO`, `CANCELADO`, `NO_RETIRADO`).
- El cliente no necesita autenticación para esta ruta (es pública por UUID).

---

## 4. Skills Disponibles

| Skill | Ruta | Cuándo usarla |
|---|---|---|
| `tenant-isolation` | `/skills/tenant-isolation/` | Toda entidad o repositorio con `tenant_id` |
| `soft-delete` | `/skills/soft-delete/` | Entidades `Product` y `Category` |
| `order-state-machine` | `/skills/order-state-machine/` | Servicio y DTOs de `orders` |
| `snapshot-order-items` | `/skills/snapshot-order-items/` | Entidad y servicio de `order-items` |

---

## 5. Módulos del MVP y Estado

| Módulo | Ruta | Entidades incluidas | Estado |
|---|---|---|---|
| Auth | `src/modules/auth/` | `User` | ⬜ Pendiente |
| Tenants | `src/modules/tenants/` | `Tenant`, `HorarioRegular`, `ExcepcionDisponibilidad` | ⬜ Pendiente |
| Categories | `src/modules/categories/` | `Category` | ⬜ Pendiente |
| Products | `src/modules/products/` | `Product` | ⬜ Pendiente |
| Orders | `src/modules/orders/` | `Order` | ⬜ Pendiente |
| Order Items | `src/modules/order-items/` | `OrderItem` | ⬜ Pendiente |
| Customers | `src/modules/customers/` | `Customer` | ⬜ Pendiente |
| Deliveries | `src/modules/deliveries/` | `Delivery` | ⬜ Pendiente |
| Core / DB | `src/core/database/` | — | ⬜ Pendiente |
| Core / Tenant MW | `src/core/tenant/` | — | ⬜ Pendiente |

**Notas de agrupación:**
- `HorarioRegular` y `ExcepcionDisponibilidad` viven dentro de `tenants/` porque son configuración del negocio, no entidades de dominio independientes.
- `Customer` es un snapshot de auditoría (no un usuario con sesión). Módulo propio para mantener separación de responsabilidades.
- `Delivery` guarda los datos de envío al momento del pedido. Módulo propio porque tiene su propio ciclo de vida dentro de un pedido.
- `User` vive en `auth/` porque su único rol en el MVP es autenticar al dueño.

> Actualizar el estado a `🔄 En progreso` o `✅ Listo` a medida que se avanza.

---

*AGENTS.md — v1.2 | Proyecto: Backend pedidos online | Stack: NestJS + TypeORM + PostgreSQL*
