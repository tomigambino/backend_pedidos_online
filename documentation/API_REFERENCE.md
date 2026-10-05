# API Reference — Backend Pedidos Online

**Framework:** NestJS 11 (Express)  
**Base URL:** `http://localhost:3000` (configurable via `PORT` env)  
**Auth:** JWT — via header `Authorization: Bearer <token>` o cookie HttpOnly `access_token`  
**Rate Limiting Global:** 100000 requests / 60s (configurado en `ThrottlerModule.forRoot`); varias rutas aplican su propio límite más estricto (ver [Rate limiting](#rate-limiting))  
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
- [Rate limiting](#rate-limiting)
- [Límites de subida](#límites-de-subida-de-imágenes)

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

**Respuesta:** `201 Created` — JWT token en cookie HttpOnly:

```json
{
  "success": true
}
```

> El JWT tiene una vigencia de 7 días e incluye `userId` y `tenantId` en el payload. Se devuelve en el
> body como `accessToken` y además se guarda en una cookie HttpOnly `access_token` con las mismas
> opciones que `login` (`httpOnly: true`, `sameSite: 'lax'`, `secure` en producción).

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

> Un JWT con vigencia de 7 días se devuelve en el body como `accessToken` y además se guarda en una
> **cookie HttpOnly** `access_token` (`httpOnly: true`, `sameSite: 'lax'`, `secure` en producción,
> `maxAge: 604800000`). El JWT strategy valida el token desde la cookie `access_token` **o** desde el
> header `Authorization: Bearer <token>`, indistintamente.

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

> - `productCount` cuenta los productos de la categoría que están **activos y no borrados** (`deleted_at IS NULL AND is_active = true`).
> - Las categorías ocultas (`isActive: false`) **no** aparecen en el listado público.
> - `total` / `totalPages` se calculan con un `count` que aplica **el mismo filtro que `data`**
>   (`tenant_id` + `is_active = true`, más `deleted_at IS NULL` automático por `@DeleteDateColumn`),
>   así que ambos cuadran.

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

> `productCount` cuenta los productos **activos e inactivos** de la categoría, pero **excluye los
> soft-deleted** (`deleted_at IS NULL`). Sin filtro por `isActive` de la categoría.
> Este listado sí incluye las categorías ocultas, por lo que `total` y `data` son consistentes.

---

### `GET /:tenant/categories/:id` 🔒

Obtiene una categoría por UUID.

**Respuesta:** entidad `Category` cruda (**no** es `CategoryResponseDto` — no incluye `productCount`):
```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "name": "Bebidas",
  "isActive": true,
  "createdAt": "2025-01-01T12:00:00.000Z",
  "updatedAt": "2025-01-01T12:00:00.000Z",
  "deletedAt": null
}
```

---

### `POST /:tenant/categories` 🔒

Crea una categoría (nace con `isActive: true` por defecto).

**Body:**
```json
{ "name": "Bebidas" }
```

**Respuesta:** `201 Created` — entidad `Category` cruda (misma forma que `GET /:tenant/categories/:id`, sin `productCount`).

---

### `PATCH /:tenant/categories/:id` 🔒

Actualiza el nombre de una categoría.

**Body:**
```json
{ "name": "Bebidas Frías" }
```

**Respuesta:** entidad `Category` cruda (sin `productCount`).

---

### `PATCH /:tenant/categories/:id/activate` 🔒

Establece `isActive = true` en la categoría.

**Respuesta:** `CategoryResponseDto`. ⚠️ `productCount` siempre vale `0` en este endpoint
(no se recalcula el conteo real de productos).

---

### `PATCH /:tenant/categories/:id/hide` 🔒

Establece `isActive = false` en la categoría. La categoría deja de aparecer
en `GET /:tenant/categories` (público) y sus productos desaparecen del menú público
(a través del filtro por categoría visible en `GET /:tenant/products`).

**Respuesta:** `CategoryResponseDto` con `productCount: 0` (misma salvedad que `activate`).

---

### `DELETE /:tenant/categories/:id` 🔒

Eliminación lógica (soft delete) de una categoría.

**Respuesta:** `200 OK` con cuerpo vacío (no hay `@HttpCode(204)` en el controller).

---

## Productos

### `GET /:tenant/products` 🔓

Lista **solo productos activos de categorías activas** (paginados).  
**No requiere JWT.**

> Un producto desaparece del listado público si: está oculto (`isActive: false`), su categoría
> está oculta (`category.isActive = false`) o su categoría está borrada (`category.deleted_at`),
> o el propio producto está soft-deleted. Se usa `INNER JOIN` contra `categories`.
> El `total` sale de `getManyAndCount()`, que reutiliza los mismos `JOIN`/`WHERE`, así que
> **los productos excluidos tampoco cuentan en `total`**.

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

Lista **todos los productos** del tenant, incluyendo los inactivos (`isActive: false`)
pero **excluyendo los soft-deleted** (`deleted_at IS NULL`, filtro automático de TypeORM).
Ordenados por `name` ASC.

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
**Content-Type:** `multipart/form-data`

> La imagen se sube como archivo (`FileInterceptor('image')`) a Cloudinary en la carpeta
> `pedilo/<tenantSlug>/products/`. Hay `limits.fileSize` y `fileFilter` configurados
> (ver [Límites de subida](#limites-de-subida-de-imágenes)): 5 MB por archivo y solo
> `image/jpeg`, `image/png` o `image/webp`.

| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| `name` | string | sí | |
| `description` | string | no | |
| `price` | number (≥0) | sí | |
| `categoryId` | string (UUID) | sí | debe pertenecer al tenant |
| `image` | file | no | imagen subida a Cloudinary |

**Respuesta:** `201 Created` — `ProductResponseDto`

---

### `PATCH /:tenant/products/:id` 🔒

Actualiza un producto (campos parciales).  
**Content-Type:** `multipart/form-data`

| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| `name` | string | no | |
| `description` | string | no | |
| `price` | number (≥0) | no | |
| `categoryId` | string (UUID) | no | |
| `image` | file | no | reemplaza la imagen anterior; la anterior se borra de Cloudinary en modo *fire-and-forget* |

**Respuesta:** producto actualizado (`ProductResponseDto`).

---

### `DELETE /:tenant/products/:id` 🔒

Eliminación lógica (soft delete).

**Respuesta:** `200 OK` con cuerpo vacío (no hay `@HttpCode(204)` en el controller).

---

### `PATCH /:tenant/products/:id/activate` 🔒

Establece `isActive = true`.

**Respuesta:** producto actualizado (`ProductResponseDto`).

---

### `PATCH /:tenant/products/:id/hide` 🔒

Establece `isActive = false`.

**Respuesta:** producto actualizado (`ProductResponseDto`).

---

### `DELETE /:tenant/products/:id/image` 🔒

Elimina la imagen del producto (Cloudinary) y setea `imageUrl = null`.
Idempotente: si el producto no tiene imagen, no falla.

**Respuesta:** `200 OK` — `ProductResponseDto` con `imageUrl: null`.

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
  "deliveryNotes": "Dejar en recepción",
  "desiredDeliveryTime": "2026-10-05T20:30:00-03:00"
}
```

| Campo | Tipo | Requerido | Validación |
|-------|------|-----------|------------|
| `items` | array | sí (min 1) | |
| `items[].productId` | string (UUID) | sí | producto visible del tenant: activo, no borrado y con su categoría activa y no borrada |
| `items[].quantity` | integer (≥1) | sí | |
| `customer.name` | string | sí | ≤120, solo letras, espacios y apóstrofes (`/^[a-zA-ZÀ-ÿñÑ\s']{2,}$/`) |
| `customer.phone` | string | sí | 6–20 chars, solo números, espacios, `+`, `-`, `()` (`/^[0-9+\-\s()]{6,20}$/`) |
| `customer.address` | string | no | ≤200 |
| `paymentMethod` | `EFECTIVO` / `TRANSFERENCIA` / `TARJETA_DEBITO` | sí | |
| `deliveryType` | `RETIRO_LOCAL` / `ENVIO_DOMICILIO` | sí | |
| `address` | string | solo si `deliveryType: ENVIO_DOMICILIO` | ≤200, debe contener al menos una letra |
| `notes` | string | no | ≤300 — nota general del pedido |
| `deliveryNotes` | string | no | ≤300 — solo para `ENVIO_DOMICILIO` |
| `desiredDeliveryTime` | string (ISO 8601) | no | debe incluir fecha, hora y offset; debe ser ≥ `now + minimumDeliveryTime` y caer dentro de una ventana abierta del local para esa fecha |

**Reglas de negocio:**
- No se permite pagar con `TARJETA_DEBITO` en envíos a domicilio (error 400).
- Si `deliveryType = ENVIO_DOMICILIO`, se crea un `Delivery` con `deliveryFee` = `tenant.deliveryCost`
  si `deliveryCostEnabled` está activo; si no, `deliveryFee = null`.
- `desiredDeliveryTime` es opcional. Si se envía, debe ser un ISO 8601 completo (`YYYY-MM-DDTHH:mm:ss±HH:mm`)
  posterior a `now + tenant.minimumDeliveryTime`, **dentro de una ventana abierta** del local para esa fecha
  (considerando `availability_exceptions` para esa fecha o `regular_schedules` para ese día de la semana),
  y con hora del día ≤ el `maxOrderTime` efectivo (configurado por schedule/excepción o, si está null,
  calculado como `closingTime - tenant.minimumDeliveryTime`). Múltiples schedules el mismo día
  (ej: mediodía + noche) se respetan: el desired debe caer en alguna de las ventanas.
- El `total` se calcula **server-side** como `Σ (price × quantity)` usando el precio actual de cada
  producto (snapshot en `order_items`). **El `total` NO incluye el `deliveryFee`.
- Cada `productId` se valida en `ProductsService.findOneForOrder()` con **el mismo filtro de visibilidad
  que el catálogo público** (`GET /:tenant/products`, INNER JOIN a `categories`): debe pertenecer al tenant,
  estar `isActive = true`, no estar soft-deleted, y su categoría debe estar `is_active = true` y sin
  `deleted_at`.
- **No se puede pedir nada que no esté en el menú público.** Si un producto está inactivo, borrado, es de
  otro tenant, o su categoría está oculta o borrada → **400 Bad Request**, con `message`:
  `Producto <uuid> no disponible`. La validación corre antes de copiar el snapshot, así que el pedido
  no se crea.

**Respuesta:** `201 Created` — `OrderResponseDto` (ver [Modelos](#orderresponsedto)).

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

> Las fechas se interpretan en zona horaria Argentina (ART, UTC-3).

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
Los montos se calculan en zona horaria Argentina (ART, UTC-3). Los pedidos cancelados **no** se incluyen en `revenueToday`.

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

**Respuesta:** `OrderResponseDto`

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
| `cancellationReason` | string (≤255) | no — solo se guarda si `status = CANCELADO`; en cualquier otro estado se fuerza a `null` |

> Ver [máquina de estados](#máquina-de-estados-pedidos) para transiciones válidas. Una transición no
> permitida devuelve `400` con el mensaje `Transición inválida: <actual> → <destino>`.
> El cambio se emite por SSE a los clientes suscritos al `status-stream`.

**Respuesta:** `OrderResponseDto` actualizado.

---

### `GET /:tenant/orders/:uuid/track` 🔓

Consulta pública de un pedido por `trackingUuid` (sin JWT).  
Rate limit: **30 req/min**

**Respuesta:** `OrderResponseDto`

---

### `GET /:tenant/orders/:id/whatsapp-link` 🔒

Genera un enlace de WhatsApp con el resumen del pedido para notificar al cliente.

**Respuesta:**
```json
{
  "url": "https://wa.me/541155551234?text=...",
  "message": "¡Hola Juan! Tu pedido #A1B2C3D4 en Mi Tienda está pendiente. Seguilo en tiempo real acá: http://localhost:3000/mi-tienda/pedido/<trackingUuid>. ..."
}
```

> Devuelve tanto el `url` como el `message` (enlace armado y texto sin codificar).
> Si el pedido es `TRANSFERENCIA` y el tenant tiene cargados `cbu`, `alias`, `accountHolder` y `bank`,
> el mensaje incluye además los datos bancarios y el monto a pagar.
> Si el cliente no tiene teléfono registrado, devuelve `400`.

---

### `PATCH /:tenant/orders/:uuid/customer/phone` 🔓

Actualiza el teléfono del cliente asociado a un pedido (público, por trackingUuid).  
Rate limit: **3 req/min**

> ⚠️ El `phone` se guarda **sin validación de formato**: el DTO solo comprueba que sea string.
> Como el endpoint es público, cualquiera con el `trackingUuid` puede modificar el teléfono.

**Body:**
```json
{ "phone": "1155555678" }
```

**Respuesta:**
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
  "minimumDeliveryTime": 30,
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
**Content-Type:** `multipart/form-data`

> Los campos de texto y los archivos se envían juntos en un solo request multipart.
> Los archivos se aceptan con `FileFieldsInterceptor` (`maxCount: 1` por campo), se suben a Cloudinary
> en la carpeta `pedilo/<tenantSlug>/branding/` y el anterior se borra en modo *fire-and-forget*.
> Cada archivo tiene los mismos límites que las imágenes de producto (ver
> [Límites de subida](#limites-de-subida-de-imagenes)): 5 MB y solo `image/jpeg`, `image/png`
> o `image/webp`. Se permiten hasta 2 archivos por request (uno de cada campo).
> `isOpen` y `deliveryCostEnabled` aceptan el string `"true"`/`"false"` además del booleano.

| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| `name` | string | no | nombre del negocio |
| `primaryColor` | string | no | |
| `secondaryColor` | string | no | |
| `description` | string | no | |
| `whatsapp` | string | no | |
| `address` | string | no | |
| `cbu` | string | no | |
| `alias` | string | no | |
| `accountHolder` | string | no | |
| `bank` | string | no | |
| `isOpen` | boolean | no | |
| `deliveryCostEnabled` | boolean | no | |
| `deliveryCost` | number (≥0) | no | |
| `minimumDeliveryTime` | integer (≥0) | no | minutos de preparación/envío mínimos |
| `logo` | file | no | imagen subida a Cloudinary (max 1) |
| `banner` | file | no | imagen subida a Cloudinary (max 1) |

**Respuesta:** tenant actualizado (entera).

---

### `DELETE /:tenant/admin/tenants/logo` 🔒

Elimina el logo del tenant (Cloudinary) y setea `logo = null`.
Idempotente: si no hay logo, no falla.

**Respuesta:** `200 OK` — tenant actualizado.

---

### `DELETE /:tenant/admin/tenants/banner` 🔒

Elimina el banner del tenant (Cloudinary) y setea `banner = null`.
Idempotente: si no hay banner, no falla.

**Respuesta:** `200 OK` — tenant actualizado.

### Horarios (Schedule)

#### `GET /:tenant/admin/schedule` 🔒
Lista todos los horarios regulares.

#### `POST /:tenant/admin/schedule` 🔒
Crea un horario regular.
```json
{ "dayOfWeek": 1, "openingTime": "09:00", "closingTime": "18:00", "maxOrderTime": "17:30" }
```

| Campo | Tipo | Validación |
|-------|------|------------|
| `dayOfWeek` | number | 1 (lunes) – 7 (domingo), entero |
| `openingTime` | string | `HH:MM` (`/^\d{2}:\d{2}$/`) |
| `closingTime` | string | `HH:MM` (`/^\d{2}:\d{2}$/`) |
| `maxOrderTime` | string (`HH:mm` o `HH:mm:ss`) | no | hora tope del día para programar entregas; si se omite, default = `closingTime - tenant.minimumDeliveryTime` |

#### `PATCH /:tenant/admin/schedule/:id` 🔒
Actualiza un horario regular (mismos campos que creación, todos opcionales).

#### `DELETE /:tenant/admin/schedule/:id` 🔒
Elimina un horario regular. `200 OK` con cuerpo vacío (no hay `@HttpCode(204)`).

---

### Excepciones

#### `GET /:tenant/admin/exceptions` 🔒
Lista todas las excepciones de disponibilidad.

#### `POST /:tenant/admin/exceptions` 🔒
Crea una excepción.
```json
{
  "date": "2025-12-25",
  "isOpen": true,
  "openingTime": "10:00",
  "closingTime": "15:00",
  "maxOrderTime": "14:30",
  "reason": "Navidad (horario especial)"
}
```

| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| `date` | string | sí | `YYYY-MM-DD` (`/^\d{4}-\d{2}-\d{2}$/`) |
| `isOpen` | boolean | sí | |
| `openingTime` | string (HH:MM) | sí si `isOpen: true` | |
| `closingTime` | string (HH:MM) | sí si `isOpen: true` | |
| `maxOrderTime` | string (HH:MM) | sí si `isOpen: true` | hora tope para entregas ese día; si se omite en el PATCH pero el día pasa a `isOpen: true`, queda `null` y se calcula como `closingTime - tenant.minimumDeliveryTime` |
| `reason` | string | no | |

Si `isOpen: true`, se requieren `openingTime`, `closingTime` y `maxOrderTime`. Si `isOpen: false`, los tres horarios se guardan como `null` (el service los anula explícitamente aunque se envíen).

#### `PATCH /:tenant/admin/exceptions/:id` 🔒
Actualiza una excepción (campos parciales).

#### `DELETE /:tenant/admin/exceptions/:id` 🔒
Elimina una excepción. `200 OK` con cuerpo vacío (no hay `@HttpCode(204)`).

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

#### `UserRole`
| Valor |
|-------|
| `OWNER` |

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
  "desiredDeliveryTime": "2026-10-05T20:30:00.000Z",
  "customer": {
    "id": "uuid",
    "name": "Juan Pérez",
    "phone": "1155551234",
    "address": null
  },
  "delivery": {
    "id": "uuid",
    "address": "Calle Falsa 123",
    "notes": "Dejar en recepción",
    "deliveryFee": 500
  },
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

> `delivery` es `null` cuando `deliveryType = RETIRO_LOCAL`.

#### `CustomerResponseDto`
```json
{
  "id": "uuid",
  "name": "Juan Pérez",
  "phone": "1155551234",
  "address": null
}
```

#### `DeliveryResponseDto`
```json
{
  "id": "uuid",
  "address": "Calle Falsa 123",
  "notes": "Dejar en recepción",
  "deliveryFee": 500
}
```

> `deliveryFee` es una **copia** del `tenant.deliveryCost` vigente al momento de la creación del
> pedido (`null` si `deliveryCostEnabled` estaba desactivado). Cambiar el costo del tenant después no
> altera pedidos ya creados.

#### `OrderItemResponseDto`
```json
{
  "id": "uuid",
  "productId": "uuid",
  "name": "Coca-Cola 500ml",
  "price": 1500,
  "quantity": 2
}
```

#### `ProductResponseDto`
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

#### `CategoryResponseDto`
```json
{ "id": "uuid", "name": "Bebidas", "productCount": 5, "isActive": true }
```

> `productCount` depende del endpoint: público (`GET /:tenant/categories`) cuenta solo productos
> activos y no borrados; admin (`GET /:tenant/categories/admin`) cuenta activos e inactivos, pero
> también excluye los soft-deleted.
> ⚠️ En `GET /:tenant/categories/:id`, `POST /:tenant/categories` y `PATCH /:tenant/categories/:id`
> la respuesta es la entidad cruda y **no** incluye `productCount`. En `activate` y `hide` sí viene
> el DTO, pero con `productCount` siempre en `0`.

#### `StatsResponseDto`
```json
{ "ordersToday": 5, "revenueToday": 12500, "pendingOrders": 2 }
```

> `revenueToday` suma el `total` de pedidos del día **excepto** los cancelados. `ordersToday` sí los
> incluye. `pendingOrders` cuenta **todos** los pedidos `PENDIENTE` del tenant, no solo los de hoy.
> Todo calculado en zona horaria Argentina (ART, UTC-3).

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

## Rate limiting

Configuración global en `app.module.ts`:

```ts
ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 100000 }])
```

Es decir, **100000 requests por ventana de 60s** para toda la API por defecto.
Algunas rutas la sobreescriben con `@Throttle`, que es más restrictivo:

| Ruta | Límite | Fuente |
|------|--------|--------|
| `POST /auth/register` | 5 req/min | `@Throttle({ default: { limit: 5, ttl: 60000 } })` |
| `POST /auth/login` | 10 req/min | `@Throttle({ default: { limit: 10, ttl: 60000 } })` |
| `POST /:tenant/orders` | 10 req/min | `@Throttle({ default: { limit: 10, ttl: 60000 } })` en `orders.controller.ts:35` |
| `GET /:tenant/orders/:uuid/track` | 30 req/min | `@Throttle({ default: { limit: 30, ttl: 60000 } })` |
| `PATCH /:tenant/orders/:uuid/customer/phone` | 3 req/min | `@Throttle({ default: { limit: 3, ttl: 60000 } })` |

El resto de las rutas **no** tienen límite propio: responden al `ThrottlerGuard` global con
`limit: 100000`.

Todos los límites cuentan **por IP** (`req.ip`), en una ventana de 60 s. En las respuestas que
pasan el límite se incluyen `X-RateLimit-Limit`, `X-RateLimit-Remaining` y `X-RateLimit-Reset`
(segundos); el `429` trae `Retry-After`.

> **Requisito de despliegue:** el contador depende de `X-Forwarded-For`. En producción nginx
> debe enviar `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` porque la app usa
> `trust proxy: 1`. Sin ese header, `req.ip` es la IP del proxy y **todos los clientes comparten
> un único contador** (por ejemplo, un local con tráfico bloquearía los pedidos de sus propios
> clientes). Bloqueante antes de desplegar.

### Límites de subida de imágenes

Las rutas con `multipart/form-data` (`POST`/`PATCH /:tenant/products` y `PATCH /:tenant/admin/tenants`)
validan cada archivo con `imageUploadLimits()` e `imageFileFilter()` de
`src/common/utils/upload-limits.util.ts`:

| Regla | Valor | Respuesta |
|-------|-------|-----------|
| Tamaño máximo por archivo | 5 MB (5242880 bytes) | `413 Payload Too Large` |
| MIME permitido | `image/jpeg`, `image/png`, `image/webp` | `400 Bad Request` |
| Archivos por request | 1 en productos, 2 en tenant (`logo` + `banner`) | `400 Bad Request` |

El filtro de tamaño corre en multer, **antes** de validar el body y antes de llegar al service, así
que un archivo rechazado no se sube a Cloudinary ni crea registros. El `413` usa el mensaje de Nest
en inglés (`"File too large"`), mientras que el rechazo por MIME trae el detalle del tipo recibido.

```json
// 413 - archivo mayor a 5 MB
{ "statusCode": 413, "message": "File too large", "error": "Payload Too Large" }

// 400 - MIME no permitido
{ "statusCode": 400, "message": "Tipo de imagen no permitido: image/gif. Permitidos: image/jpeg, image/png, image/webp", "error": "Bad Request" }
```

> **Limitación conocida:** el filtro valida el `Content-Type` declarado por el cliente, que es
> falseable. Un archivo que no es una imagen enviado con `Content-Type: image/png` pasa el filtro y
> llega a Cloudinary, que lo rechaza. La validación real requiere inspeccionar los magic bytes.

> Nota de clientes: algunos clientes HTTP abortan la subida si el servidor responde antes de que
> termine de enviar el body, y en ese caso puede observarse un error de conexión en vez del `413`,
> aunque la respuesta `413` sí se emite.

---

## Consideraciones Generales

- **Multi-tenant:** Todas las rutas incluyen `:tenant` (slug) en la URL, que el middleware resuelve al `tenantId` correspondiente. **Excepciones:** `GET /`, `POST /auth/register`, `POST /auth/login` y `GET /auth/me` (autenticación no está scoped a un tenant).
- **Autenticación:** Las rutas marcadas con 🔒 requieren un JWT. El token se puede enviar vía header `Authorization: Bearer <token>` **o** como cookie HttpOnly `access_token` (la estrategia JWT busca en ambas). Se obtiene de `POST /auth/login` o `POST /auth/register` (ambos devuelven `accessToken` en el body y además setean la cookie `access_token`). El guard no valida que el `tenantId` del token coincida con el `:tenant` de la URL: el aislamiento depende del `where tenantId = ...` de cada consulta.
- **Rate limiting:** global **100000 req/60s**, con límites más estrictos en 5 rutas (incluido `POST /:tenant/orders`, 10 req/min). Todos cuentan por IP (`req.ip`). Ver [Rate limiting](#rate-limiting).
- **Rutas inexistentes:** ⚠️ `GET /:tenant/menu` aparece en la lista `forRoutes` del `TenantMiddleware` en `app.module.ts`, pero **ningún controller lo expone**. El menú público se compone con `GET /:tenant/categories` + `GET /:tenant/products`. No documente `/menu`.
- **CORS:** `origin` configurable vía `CORS_ORIGIN` (default `*`), `credentials: true`, métodos `GET/POST/PATCH/DELETE`.
- **Seguridad:** Helmet aplicado globalmente para headers de seguridad HTTP.
- **Validación:** `ValidationPipe` global con `transform: true`, `whitelist: true`, `forbidNonWhitelisted: true`. Todos los bodies se transforman y validan automáticamente. Los `:id` / `:uuid` usan `ParseUUIDPipe`.
- **Códigos de respuesta en borrados:** los handlers que retornan `void` responden `200 OK` con cuerpo vacío. Ningún endpoint declara `@HttpCode(204)`.
- **Subida de imágenes:** Productos, logo y banner se suben a Cloudinary (`pedilo/<tenantSlug>/products/` y `pedilo/<tenantSlug>/branding/`). Los endpoints de productos (`POST`, `PATCH`) y tenant (`PATCH`) aceptan `multipart/form-data` con **5 MB por archivo** y MIME restringido a `image/jpeg`/`image/png`/`image/webp` (`413` por tamaño, `400` por MIME). Ver [Límites de subida](#límites-de-subida-de-imágenes).
- **Soft delete e isActive:** Categorías y productos usan soft delete (`deleted_at`), que TypeORM excluye automáticamente de las consultas de repositorio. Además, `isActive` oculta de forma independiente. El listado público de productos oculta los de categoría oculta/borrada; el listado público de categorías solo muestra las activas.
