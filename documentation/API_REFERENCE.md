# API Reference — Backend Pedidos Online

**Framework:** NestJS 11 (Express)  
**Base URL:** `http://localhost:3000` (configurable via `PORT` env)  
**Auth:** JWT — via header `Authorization: Bearer <token>` o cookie HttpOnly `access_token`  
**Rate Limiting Global:** 10 requests / 60s  
**Multi-tenant:** Slug-based (`:tenant`) resuelto por `TenantMiddleware`  
**Paginación:** Respuesta envolvente `{ data, total, page, limit, totalPages }`

---

## Índice

- [Autenticación](#autenticación)
- [Categorías](#categorías)
- [Productos](#productos)
- [Pedidos](#pedidos)
- [Tenant / Configuración](#tenant--configuración)
- [Health Check](#health-check)
- [Modelos de Datos](#modelos-de-datos)
- [Máquina de Estados (Pedidos)](#máquina-de-estados-pedidos)

---

## Autenticación

### `POST /auth/register`

Registra un nuevo usuario (OWNER) junto con un tenant. **No requiere slug.**  
Rate limit: **5 req/min**

**Body:**
```json
{
  "email": "user@example.com",
  "password": "12345678",
  "tenantName": "Mi Tienda",
  "tenantSlug": "mi-tienda"
}
```

| Campo | Tipo | Validación |
|-------|------|------------|
| `email` | string | email válido |
| `password` | string | min 8 caracteres |
| `tenantName` | string | obligatorio |
| `tenantSlug` | string | solo `a-z`, `0-9`, `-` |

**Respuesta:** `201 Created` — JWT token en el body:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

> El token expira en 7 días e incluye `userId` y `tenantId` en el payload.

---

### `POST /auth/login`

Inicia sesión. **No requiere `:tenant`** (a diferencia del resto de las rutas).  
Rate limit: **10 req/min**

**Body:**
```json
{
  "email": "user@example.com",
  "password": "12345678"
}
```

**Respuesta:**
```json
{
  "success": true
}
```

> Un token JWT expirado a los 7 días se guarda en una **cookie HttpOnly** `access_token`
> (`httpOnly: true`, `sameSite: lax`, `secure` en producción). El JWT strategy valida el token
> desde la cookie `access_token` **o** desde el header `Authorization: Bearer <token>`, indistintamente.

---

### `GET /auth/me` 🔒

Devuelve la identidad del usuario autenticado. **No requiere `:tenant`.**

**Respuesta:**
```json
{
  "email": "user@example.com",
  "tenantSlug": "mi-tienda",
  "tenantName": "Mi Tienda"
}
```

---

## Categorías

### `GET /:tenant/categories` 🔓

Lista **solo categorías activas** (paginadas, ordenadas por nombre ASC).  
**No requiere JWT.**

| Query | Tipo | Default |
|-------|------|---------|
| `page` | number (≥1) | 1 |
| `limit` | number (1–100) | 10 |

**Respuesta:**
```json
{
  "data": [
    { "id": "uuid", "name": "Bebidas", "productCount": 5, "isActive": true }
  ],
  "total": 1,
  "page": 1,
  "limit": 10,
  "totalPages": 1
}
```

> - `productCount` cuenta **solo productos activos** dentro de la categoría.
> - Las categorías ocultas (`isActive: false`) **no** aparecen en este listado público.

---

### `GET /:tenant/categories/admin` 🔒

Lista **todas las categorías** (activas e inactivas).  
Requiere JWT.

> **Atención:** Esta ruta debe declararse **antes** de `GET /:tenant/categories/:id` para evitar conflictos.

| Query | Tipo | Default |
|-------|------|---------|
| `page` | number (≥1) | 1 |
| `limit` | number (1–100) | 10 |

**Respuesta:**
```json
{
  "data": [
    { "id": "uuid", "name": "Bebidas", "productCount": 8, "isActive": true }
  ],
  "total": 1,
  "page": 1,
  "limit": 10,
  "totalPages": 1
}
```

> `productCount` cuenta **todos** los productos (activos e inactivos). Sin filtro por `isActive` de categoría.

---

### `GET /:tenant/categories/:id` 🔒

Obtiene una categoría por UUID.

**Respuesta:**
```json
{ "id": "uuid", "name": "Bebidas", "isActive": true }
```

---

### `POST /:tenant/categories` 🔒

Crea una categoría (nace con `isActive: true` por defecto).

**Body:**
```json
{ "name": "Bebidas" }
```

**Respuesta:** `201 Created`

---

### `PATCH /:tenant/categories/:id` 🔒

Actualiza el nombre de una categoría.

**Body:**
```json
{ "name": "Bebidas Frías" }
```

**Respuesta:** categoría actualizada.

---

### `PATCH /:tenant/categories/:id/activate` 🔒

Establece `isActive = true` en la categoría.

**Respuesta:** categoría actualizada.

---

### `PATCH /:tenant/categories/:id/hide` 🔒

Establece `isActive = false` en la categoría. La categoría deja de aparecer
en `GET /:tenant/categories` (público) y sus productos desaparecen del menú público
(a través del filtro por categoría visible en `GET /:tenant/products`).

**Respuesta:** categoría actualizada.

---

### `DELETE /:tenant/categories/:id` 🔒

Eliminación lógica (soft delete) de una categoría.

**Respuesta:** `204 No Content`

---

## Productos

### `GET /:tenant/products` 🔓

Lista **solo productos activos de categorías activas** (paginados).  
**No requiere JWT.**

> Un producto desaparece del listado público si: está oculto (`isActive: false`), su categoría
> está oculta (`category.isActive = false`) o su categoría está borrada (`category.deleted_at`).
> Se usa `INNER JOIN` contra `categories`, así que un producto con categoría oculta/borrada
> simplemente no se lista (y no cuenta en `total`).

| Query | Tipo | Default |
|-------|------|---------|
| `page` | number (≥1) | 1 |
| `limit` | number (1–100) | 10 |

**Respuesta:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Coca-Cola 500ml",
      "description": "Bebida gaseosa",
      "price": 1500,
      "imageUrl": "https://...",
      "isActive": true,
      "categoryId": "uuid"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10,
  "totalPages": 1
}
```

---

### `GET /:tenant/products/admin` 🔒

Lista **todos los productos** (incluyendo inactivos).

> **Atención:** Esta ruta debe declararse **antes** de `GET /:tenant/products/:id` para evitar conflictos.

---

### `GET /:tenant/products/:id` 🔒

Obtiene un producto por UUID.

**Respuesta:**
```json
{
  "id": "uuid",
  "name": "Coca-Cola 500ml",
  "description": "Bebida gaseosa",
  "price": 1500,
  "imageUrl": "https://...",
  "isActive": true,
  "categoryId": "uuid"
}
```

### `POST /:tenant/products` 🔒

Crea un producto.

**Body:**
```json
{
  "name": "Coca-Cola 500ml",
  "description": "Bebida gaseosa",
  "price": 1500,
  "categoryId": "uuid-de-categoria",
  "imageUrl": "https://..."
}
```

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `name` | string | sí |
| `description` | string | no |
| `price` | number (≥0) | sí |
| `categoryId` | string (UUID) | sí |
| `imageUrl` | string | no |

---

### `PATCH /:tenant/products/:id` 🔒

Actualiza un producto (campos parciales).

**Body:** Mismos campos que `CreateProductDto`, todos opcionales.

---

### `DELETE /:tenant/products/:id` 🔒

Eliminación lógica (soft delete).

**Respuesta:** `204 No Content`

---

### `PATCH /:tenant/products/:id/activate` 🔒

Establece `isActive = true`.

---

### `PATCH /:tenant/products/:id/hide` 🔒

Establece `isActive = false`.

---

## Pedidos

### `POST /:tenant/orders` 🔓

Crea un pedido. **No requiere JWT.**

**Body:**
```json
{
  "items": [
    { "productId": "uuid", "quantity": 2 }
  ],
  "customer": {
    "name": "Juan Pérez",
    "phone": "1155551234"
  },
  "paymentMethod": "EFECTIVO",
  "deliveryType": "ENVIO_DOMICILIO",
  "address": "Calle Falsa 123",
  "notes": "Sin cebolla, por favor",
  "deliveryNotes": "Dejar en recepción"
}
```

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `items` | array | sí (min 1) |
| `items[].productId` | string (UUID) | sí |
| `items[].quantity` | number (≥1) | sí |
| `customer.name` | string (≤120) | sí |
| `customer.phone` | string (≤50) | sí |
| `customer.address` | string (≤200) | no |
| `paymentMethod` | `EFECTIVO` / `TRANSFERENCIA` / `TARJETA_DEBITO` | sí |
| `deliveryType` | `RETIRO_LOCAL` / `ENVIO_DOMICILIO` | sí |
| `address` | string (≤200) | solo si `deliveryType: ENVIO_DOMICILIO` |
| `notes` | string (≤300) | no — nota general del pedido |
| `deliveryNotes` | string (≤300) | no — nota específica del envío |

**Respuesta:** `201 Created` — `OrderResponseDto` (ver [Modelos](#modelos-de-datos)).

---

### `GET /:tenant/orders` 🔒

Lista todos los pedidos (paginados, más recientes primero).

| Query | Tipo | Descripción |
|-------|------|-------------|
| `page` | number (≥1) | default 1 |
| `limit` | number (1–100) | default 10 |
| `status` | `OrderStatus` | filtra por estado (opcional) |
| `search` | string (≤120) | filtra por nombre de cliente (`ILIKE`) |
| `dateFrom` | string (ISO date) | pedidos desde esa fecha |
| `dateTo` | string (ISO date) | pedidos hasta esa fecha (fin de día inclusive) |

**Respuesta:**
```json
{
  "data": [ /* OrderResponseDto[] */ ],
  "total": 10,
  "page": 1,
  "limit": 10,
  "totalPages": 1
}
```

---

### `GET /:tenant/orders/admin/counts` 🔒

Cuenta pedidos agrupados por estado, aplicando los mismos filtros opcionales
(`search`, `dateFrom`, `dateTo`) que `GET /:tenant/orders` (sin `status`, `page` ni `limit`).

**Respuesta:** objeto con un contador por cada estado de `OrderStatus` (los estados sin pedidos valen `0`):
```json
{
  "PENDIENTE": 2,
  "EN_PREPARACION": 0,
  "LISTO": 1,
  "ENTREGADO": 5,
  "CANCELADO": 1,
  "NO_RETIRADO": 0
}
```

---

### `GET /:tenant/orders/admin/stats` 🔒

Estadísticas del día.

**Respuesta:**
```json
{
  "ordersToday": 5,
  "revenueToday": 12500,
  "pendingOrders": 2
}
```

---

### `GET /:tenant/orders/:id` 🔒

Obtiene un pedido por su ID UUID.

---

### `PATCH /:tenant/orders/:id/status` 🔒

Actualiza el estado de un pedido siguiendo la máquina de estados.

**Body:**
```json
{
  "status": "EN_PREPARACION",
  "cancellationReason": "Cliente solicitó cancelación"
}
```

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `status` | `OrderStatus` | sí |
| `cancellationReason` | string (≤255) | solo si status = `CANCELADO` |

> Ver [máquina de estados](#máquina-de-estados-pedidos) para transiciones válidas.

---

### `GET /:tenant/orders/:uuid/track` 🔓

Consulta pública de un pedido por `trackingUuid` (sin JWT).

**Respuesta:** `OrderResponseDto`

---

### `GET /:tenant/orders/:id/whatsapp-link` 🔒

Genera un enlace de WhatsApp con el resumen del pedido para notificar al cliente.

**Respuesta:**
```json
{
  "url": "https://wa.me/541155551234?text=...",
  "message": "¡Hola! Tu pedido en el local está pendiente. Seguilo acá: https://tuapp.com/mi-tienda/pedido/<trackingUuid>"
}
```

> Devuelve tanto el `url` como el `message` (enlace armado y texto sin codificar).

---

### `PATCH /:tenant/orders/:uuid/customer/phone` 🔓

Actualiza el teléfono del cliente asociado a un pedido (público, por trackingUuid).

**Body:**
```json
{ "phone": "1155555678" }
```

---

### `SSE /:tenant/orders/:uuid/status-stream` 🔓

Server-Sent Events para seguir cambios de estado en tiempo real.  
Se conecta por `trackingUuid` (público). Emite el estado actual como `string` en cada evento.  
Se cierra automáticamente al alcanzar un estado terminal (`ENTREGADO`, `CANCELADO`, `NO_RETIRADO`).

**Ejemplo de conexión (cliente):**
```js
const evtSource = new EventSource('/mi-tienda/orders/aaa-bbb-ccc/status-stream');
evtSource.onmessage = (event) => console.log('Nuevo estado:', event.data);
```

---

## Tenant / Configuración

### `GET /:tenant/availability` 🔓

Obtiene configuración pública del tenant (nombre, logo, colores, horarios, etc.).

**Respuesta:**
```json
{
  "name": "Mi Tienda",
  "logo": "https://...",
  "banner": null,
  "primaryColor": "#FF5733",
  "secondaryColor": "#33FF57",
  "description": "Descripción del negocio",
  "whatsapp": "541155551234",
  "address": "Av. Siempre Viva 123",
  "isOpen": true,
  "deliveryCostEnabled": true,
  "deliveryCost": 500,
  "schedule": {
    "regular": [
      { "id": "uuid", "dayOfWeek": 1, "openingTime": "09:00", "closingTime": "18:00" }
    ],
    "exceptions": [
      { "id": "uuid", "date": "2025-12-25", "isOpen": false, "openingTime": null, "closingTime": null, "reason": "Navidad" }
    ]
  }
}
```

---

### `PATCH /:tenant/admin/tenants` 🔒

Actualiza la configuración del tenant.

**Body (todos opcionales):**
```json
{
  "name": "Mi Tienda",
  "logo": "https://...",
  "banner": "https://...",
  "primaryColor": "#FF5733",
  "secondaryColor": "#33FF57",
  "description": "Nueva descripción",
  "whatsapp": "541155551234",
  "address": "Av. Siempre Viva 123",
  "cbu": "0000003100000000000001",
  "alias": "mi.tienda.mp",
  "accountHolder": "Juan Pérez",
  "bank": "Banco Ejemplo",
  "isOpen": true,
  "deliveryCostEnabled": false,
  "deliveryCost": 0
}
```

---

### Horarios (Schedule)

#### `GET /:tenant/admin/schedule` 🔒
Lista todos los horarios regulares.

#### `POST /:tenant/admin/schedule` 🔒
Crea un horario regular.
```json
{ "dayOfWeek": 1, "openingTime": "09:00", "closingTime": "18:00" }
```

| Campo | Tipo | Validación |
|-------|------|------------|
| `dayOfWeek` | number | 1 (lunes) – 7 (domingo) |
| `openingTime` | string | formato `HH:MM` |
| `closingTime` | string | formato `HH:MM` |

#### `PATCH /:tenant/admin/schedule/:id` 🔒
Actualiza un horario regular (mismos campos que creación).

#### `DELETE /:tenant/admin/schedule/:id` 🔒
Elimina un horario regular. `204 No Content`

---

### Excepciones

#### `GET /:tenant/admin/exceptions` 🔒
Lista todas las excepciones de disponibilidad.

#### `POST /:tenant/admin/exceptions` 🔒
Crea una excepción.
```json
{
  "date": "2025-12-25",
  "isOpen": false,
  "reason": "Navidad"
}
```
Si `isOpen: true`, se requieren `openingTime` y `closingTime`.

#### `PATCH /:tenant/admin/exceptions/:id` 🔒
Actualiza una excepción.

#### `DELETE /:tenant/admin/exceptions/:id` 🔒
Elimina una excepción. `204 No Content`

---

## Health Check

### `GET /`

```text
Hello World!
```

---

## Modelos de Datos

### Enums

#### `OrderStatus`
| Valor | Descripción |
|-------|-------------|
| `PENDIENTE` | Pedido creado, pendiente de acción |
| `EN_PREPARACION` | En curso |
| `LISTO` | Terminado, esperando retiro/entrega |
| `ENTREGADO` | Entregado al cliente (terminal) |
| `CANCELADO` | Cancelado (terminal) |
| `NO_RETIRADO` | No retirado (terminal) |

#### `PaymentMethod`
| Valor |
|-------|
| `EFECTIVO` |
| `TRANSFERENCIA` |
| `TARJETA_DEBITO` |

#### `DeliveryType`
| Valor |
|-------|
| `RETIRO_LOCAL` |
| `ENVIO_DOMICILIO` |

---

### DTOs de Respuesta

#### `OrderResponseDto`
```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "status": "PENDIENTE",
  "trackingUuid": "uuid",
  "cancellationReason": null,
  "total": 3000,
  "paymentMethod": "EFECTIVO",
  "deliveryType": "RETIRO_LOCAL",
  "notes": null,
  "customer": {
    "id": "uuid",
    "name": "Juan Pérez",
    "phone": "1155551234",
    "address": null
  },
  "delivery": null,
  "items": [
    {
      "id": "uuid",
      "productId": "uuid",
      "name": "Coca-Cola 500ml",
      "price": 1500,
      "quantity": 2
    }
  ],
  "createdAt": "2025-01-01T12:00:00.000Z",
  "updatedAt": "2025-01-01T12:00:00.000Z"
}
```

#### `ProductResponseDto`
```json
{
  "id": "uuid",
  "name": "Coca-Cola 500ml",
  "description": "Bebida gaseosa",
  "price": 1500,
  "imageUrl": null,
  "isActive": true,
  "categoryId": "uuid"
}
```

#### `CategoryResponseDto`
```json
{ "id": "uuid", "name": "Bebidas", "productCount": 5, "isActive": true }
```

> `productCount` depende del endpoint: público (`GET /:tenant/categories`) cuenta solo productos activos; admin (`GET /:tenant/categories/admin`) cuenta todos los productos (incluyendo inactivos).

#### `StatsResponseDto`
```json
{ "ordersToday": 5, "revenueToday": 12500, "pendingOrders": 2 }
```

#### `TenantConfigResponseDto`
```json
{
  "name": "Mi Tienda",
  "logo": null,
  "banner": null,
  "primaryColor": null,
  "secondaryColor": null,
  "description": null,
  "whatsapp": null,
  "address": null,
  "isOpen": true,
  "deliveryCostEnabled": false,
  "deliveryCost": null,
  "schedule": {
    "regular": [ /* RegularScheduleResponseDto[] */ ],
    "exceptions": [ /* ExceptionResponseDto[] */ ]
  }
}
```

#### `RegularScheduleResponseDto`
```json
{ "id": "uuid", "dayOfWeek": 1, "openingTime": "09:00", "closingTime": "18:00" }
```

#### `ExceptionResponseDto`
```json
{ "id": "uuid", "date": "2025-12-25", "isOpen": false, "openingTime": null, "closingTime": null, "reason": "Navidad" }
```

---

## Máquina de Estados (Pedidos)

Las transiciones de estado están definidas en `src/modules/orders/constants/order-transitions.ts`:

```
PENDIENTE ──────────► EN_PREPARACION ──► LISTO ──► ENTREGADO (terminal)
     │                      │                │
     │                      │                └──► NO_RETIRADO (terminal)
     │                      │
     └──► CANCELADO (terminal) ◄──────────────┘
```

**Estados terminales:** `ENTREGADO`, `CANCELADO`, `NO_RETIRADO`  
Al alcanzar un estado terminal, el SSE stream se cierra automáticamente.

---

## Paginación

Todos los endpoints `GET` que devuelven listas aceptan los mismos parámetros de paginación:

| Query | Tipo | Default | Límites |
|-------|------|---------|---------|
| `page` | number | 1 | ≥ 1 |
| `limit` | number | 10 | 1 – 100 |

**Respuesta paginada:**
```json
{
  "data": [ ... ],
  "total": <number>,
  "page": <number>,
  "limit": <number>,
  "totalPages": <number>
}
```

---

## Consideraciones Generales

- **Multi-tenant:** Todas las rutas incluyen `:tenant` (slug) en la URL, que el middleware resuelve al `tenantId` correspondiente. **Excepciones:** `GET /`, `POST /auth/register`, `POST /auth/login` y `GET /auth/me` (autenticación no está scoped a un tenant).
- **Autenticación:** Las rutas marcadas con 🔒 requieren un JWT. El token se puede enviar vía header `Authorization: Bearer <token>` **o** como cookie HttpOnly `access_token` (la estrategia JWT busca en ambas). Se obtiene de `POST /auth/login` (setea la cookie) o de `POST /auth/register` (devuelve el `accessToken`).
- **Rate limiting:** Global 10 req/60s. `POST /auth/register`: 5 req/min. `POST /auth/login`: 10 req/min.
- **CORS:** `origin` configurable vía `CORS_ORIGIN` (default `*`), `credentials: true`, métodos `GET/POST/PATCH/DELETE`.
- **Soft delete e isActive:** Categorías y productos usan soft delete (`deleted_at`). Además, `isActive` oculta de forma independiente. El listado público de productos oculta los de categoría oculta/borrada; el listado público de categorías solo muestra las activas.
