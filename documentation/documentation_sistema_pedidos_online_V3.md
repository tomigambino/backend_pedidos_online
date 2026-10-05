# Documentación MVP Sistema de Pedidos Online

> **Versión:** 3.5

---

## Tabla de Contenidos

1. [Descripción General](#1-descripción-general)
2. [Stack Tecnológico](#2-stack-tecnológico)
3. [Modelo Multi-Tenant](#3-modelo-multi-tenant)
4. [Roles del Sistema](#4-roles-del-sistema)
5. [Módulos y Apartados de la Aplicación](#5-módulos-y-apartados-de-la-aplicación)
6. [Aclaraciones Técnicas](#6-aclaraciones-técnicas)
7. [Casos de Uso Principales](#7-casos-de-uso-principales)
8. [Modelo de Datos Simplificado](#8-modelo-de-datos-simplificado)
9. [Diagramas](#9-diagramas)
10. [Funcionalidades Fuera del MVP (versiones futuras)](#10-funcionalidades-fuera-del-mvp-versiones-futuras)
11. [Propuesta de Valor Resumida](#11-propuesta-de-valor-resumida)

---

## 1. Descripción General

El sistema es una plataforma web multi-tenant que permite a locales de comida (hamburguesas, pizzas, empanadas, etc.) recibir pedidos online sin depender de aplicaciones de delivery de terceros como PedidosYa o Rappi. Cada negocio tiene su propia URL personalizada, su propio catálogo de productos y recibe los pedidos en tiempo real desde un panel de administración. Los clientes finales no necesitan registrarse para hacer un pedido.

Es de suma importancia que el sistema sea web responsive, debido a que la mayor parte de los pedidos va a ser realizados por un dispositivo móvil.

---

## 2. Stack Tecnológico

Utilizaremos una arquitectura de tres capas:

- Capa de Controladores
- Capa de Servicios
- Capa de Acceso a Datos

### Estructura de carpetas

La estructura de carpetas del frontend se documenta en [`documentation/FRONTEND.md`](./FRONTEND.md). El backend usa una arquitectura de tres capas: controladores, servicios y acceso a datos.

```
src
|
├── common
|   ├── constants
|   ├── decorators
|   ├── dtos
|   ├── enums
|   ├── filters
|   ├── guards
|   └── interceptors
|
├── config
|   ├── database.config.ts
|   ├── env.config.ts
|   └── app.config.ts
|
├── core                        # Módulos estructurales esenciales de la arquitectura
|   ├── database                # Módulo que levanta la conexión a la base de datos
|   └── tenant                  # Módulo/Middleware encargado de extraer el tenant_id de la URL o JWT
|
├── modules                     # Aquí agrupamos las funcionalidades de negocio
|   ├── auth
|   |   ├── dto                 # Solo DTOs de login / registro
|   |   ├── strategies          # Estrategias de Passport (jwt.strategy.ts)
|   |   ├── auth.controller.ts
|   |   ├── auth.guard.ts
|   |   ├── auth.module.ts
|   |   └── auth.service.ts
|   |
|   ├── tenants
|   |   ├── entities
|   |   ├── dto
|   |   └── ...
|   |
|   ├── categories
|   |   ├── entities
|   |   ├── dto
|   |   └── ...
|   |
|   ├── products                # CRUD Productos con Soft Delete y lógica de ocultar
|   |   ├── entities
|   |   └── ...
|   |
|   └── orders
|       ├── entities
|       ├── dto
|       ├── orders.sse.service.ts   # Servicio específico para manejar Server-Sent Events del cliente
|       └── ...
|
└── main.ts
```

### Tecnologías utilizadas

- **Frontend:** Next.js (React)
- **Backend:** NestJS (Node.js + TypeScript + TypeORM + Bcrypt)
- **Validación:** Class validator + Class transformer
- **Base de datos:** PostgreSQL
- **Autenticación:** JWT (JSON Web Tokens)
- **Notificaciones:** WhatsApp
- **Tiempo Real:** SSE para clientes y polling cada 20 segundos para pedidos entrantes
- **Almacenamiento de imágenes:** Cloudinary (plan gratuito para MVP)

### Elección de Cloudinary

Se eligió Cloudinary sobre alternativas como Supabase Storage por los siguientes motivos:

- **Transformaciones automáticas por URL:** permite servir la misma imagen redimensionada según el contexto (`/w_400,f_auto,q_auto/`), evitando que usuarios mobile descarguen imágenes innecesariamente pesadas.
- **CDN global incluido:** las imágenes se sirven desde el edge sin configuración adicional.
- **Plan gratuito adecuado para MVP:** 25 GB de storage y 25 GB de ancho de banda mensual.
- **Sin dependencias extra:** dado que el stack ya utiliza PostgreSQL propio con NestJS, no hay necesidad de incorporar Supabase como plataforma completa solo por el storage.

---

## 3. Modelo Multi-Tenant

Cada negocio que contrate el sistema tiene su propio **tenant**, identificado por un **slug único dentro de una misma ruta** (no por subdominio):

```
tuapp.com/donpepe     →  Local Don Pepe Burger
tuapp.com/laesquina   →  Local La Esquina Pizzas
tuapp.com/elgordo     →  Local El Gordo Empanadas
```

En la base de datos, cada tabla relevante tiene una columna `tenant_id` que filtra los datos por negocio. Esto significa que aunque todos los negocios comparten la misma infraestructura y código, los datos de cada uno están completamente aislados.

```sql
-- Ejemplo: los pedidos siempre se filtran por tenant
SELECT * FROM orders WHERE tenant_id = 'donpepe';

-- Los productos también
SELECT * FROM products WHERE tenant_id = 'donpepe';
```

### Contexto de Autenticación

Para el **apartado de información pública**, como la carta digital, cuando el sistema recibe una request, lo primero que hace NestJS es identificar a qué tenant pertenece leyendo la URL, y a partir de ahí todos los queries a la base de datos se filtran automáticamente por ese tenant.

Para el **apartado de información privada** de la administración de negocios, donde los dueños se deben loguear para acceder, el `tenant_id` será obtenido desde el access token que se le entregará al loguearse, evitando una vulnerabilidad IDOR.

### Flujo de autenticación del dueño

1. El dueño ingresa email y contraseña en `/admin/login`
2. El backend valida las credenciales y devuelve un JWT que incluye el `userId` y el `tenantId`
3. El token se entrega en una **cookie HttpOnly** (`access_token`) y también puede enviarse en el header `Authorization: Bearer <token>`
4. Todas las requests siguientes se autentican con ese token, y el backend usa el `tenantId` del token para filtrar los datos

> **⚠️ Regla de seguridad crítica:** En ningún caso el backend acepta un `tenant_id` enviado manualmente en el body o parámetros de la request para operaciones protegidas. El token es la única fuente válida.
>
> **El login NO valida el subdominio/slug.** No hay ningún check que compare el slug de la URL con el `tenantId` del token: el panel de administración no incluye el slug en la URL y el `tenant_id` se toma exclusivamente de la sesión (JWT).

---

## 4. Roles del Sistema

El sistema tiene dos roles bien diferenciados:

### Rol: Owner (Dueño del negocio)

Es la persona que contrata el sistema. Tiene acceso al **panel de administración** de su negocio. Sus permisos son:

- Gestionar su menú (crear, editar, eliminar productos y categorías)
- Ver y gestionar los pedidos entrantes de su negocio
- Configurar los datos de su negocio (logo, colores, descripción, horarios)
- Ver reportes básicos de ventas

### Rol: Cliente (usuario final)

**Aclaración:** En una primera versión del producto (MVP), no existe este rol en la aplicación, pero se deberá incluir en una versión futura para generar un apartado de beneficios con múltiples compras, entre otras cosas, incluyendo un registro y logueo de los usuarios. La tabla `customers` en la base de datos funciona como un **registro de auditoría**: es un snapshot de los datos del comprador (nombre, teléfono, dirección) capturados en el momento del pedido y asociados a él. No representa un usuario con sesión.

Es el cliente del local que realiza un pedido. **No necesita registrarse ni tener cuenta.** Solo accede al menú público del negocio, arma su pedido y lo envía. Sus datos (nombre, teléfono, dirección) se capturan únicamente en el momento del pedido.

### (Futuro) Administrador

En el MVP no existe un rol de administrador global. Se gestiona todo directamente desde la base de datos. En versiones futuras, se puede agregar para mayor comodidad.

### (Futuro) EMPLOYEE (mozo o encargado)

- Vista limitada: solo puede ver pedidos entrantes y cambiar su estado
- No puede editar productos ni configuración
- Útil cuando el local tiene más de una persona atendiendo

---

## 5. Módulos y Apartados de la Aplicación

### 5.1 Panel Público (vista del cliente)

Es la parte que ve el cliente final al entrar a `tuapp.com/donpepe`. No requiere login.

**Inicio / Portada:** Logo del negocio, banner, nombre y descripción. Horario de atención y estado (abierto/cerrado).

**Menú:** Productos organizados por categorías (Hamburguesas, Bebidas, Postres, etc.). Cada producto muestra nombre, descripción, foto y precio.

**Carrito:** El cliente agrega productos, ve el resumen y el total.

**Checkout:** Formulario simple donde el cliente ingresa:
- Nombre (obligatorio)
- Tipo de entrega: retiro en local o envío a domicilio (obligatorio)
- Dirección (obligatorio solo si elige envío a domicilio)
- Teléfono (**obligatorio** — se usa para el contacto por WhatsApp)
- Método de pago: efectivo, transferencia o **tarjeta de débito** (obligatorio)

> **Aclaración sobre el costo del envío:** Si el dueño tiene activado el costo de envío fijo, el checkout lo suma al total y lo muestra desglosado: `Subtotal: $X + Envío: $Y = Total: $Z`. Si el dueño tiene el costo de envío desactivado, se muestra el subtotal con el siguiente aviso: *"El costo de envío no está incluido en este total y se coordina directamente con el local."*

**Datos bancarios en el checkout:** cuando el cliente elige **transferencia**, el checkout muestra en pantalla los datos bancarios del negocio (CBU, alias, banco y titular) para que pueda realizar la transferencia desde su banco.

**Confirmación:** No existe una pantalla separada de confirmación. Al registrar el pedido, el backend devuelve el UUID y el frontend **redirige directamente a la página de seguimiento** (`tuapp.com/donpepe/pedido/[uuid]`). El UUID **no** se guarda en `localStorage`.

> **⚠️ NO IMPLEMENTADO — Banner de pedido activo:** el sistema **no** guarda el UUID en `localStorage` bajo la clave `pedido_activo_{tenantSlug}` ni muestra el banner *"Tenés un pedido en curso → Ver estado"* en el menú público. No existe ninguna lectura ni escritura de esa clave en el frontend. Ver [Sección 6 — Sesión del Cliente](#sesión-del-cliente-localstorage) y `PENDING.md`.

### 5.2 Panel de Administración (vista del dueño)

Accesible desde `/admin` (ruta global, **sin slug ni subdominio**). Requiere login con usuario y contraseña.

**Dashboard:** Resumen del día (pedidos recibidos, total facturado, pedidos pendientes).

**Pedidos:** Lista de pedidos con actualización automática por polling cada 20 segundos. Muestra estado de cada pedido (visualizables en la Máquina de Estados). El dueño puede cambiar el estado de cada pedido.

**Menú / Productos:** CRUD completo de categorías y productos. Puede subir fotos, definir precios y ocultar productos temporalmente (por ejemplo, si se terminó un ingrediente).

**Configuración del negocio:** Nombre, logo, colores, banner, WhatsApp de contacto, horarios de atención, dirección, datos bancarios y configuración de costo de envío.

---

## 6. Aclaraciones Técnicas

### Manejo de Horarios

#### Estándar adoptado: ISO 8601

`day_of_week` es un `SMALLINT` donde **1 = Lunes** y **7 = Domingo**. Esta convención es explícita en toda la base de datos y diferente al estándar de JavaScript (`Date.getDay()`, donde 0 = Domingo). Cualquier conversión desde objetos `Date` de JS debe tener esto en cuenta.

#### Entidades y atributos

**RegularSchedule**

```
id             UUID     PK
tenant_id      UUID     FK → tenants(id)
day_of_week    SMALLINT  1=Lunes ... 7=Domingo
opening_time   TIME
closing_time   TIME
```

Cada fila representa un bloque horario de atención para un día de la semana. Si un día no tiene filas, el local no abre ese día. Si tiene más de una fila para el mismo día, significa que el local trabaja en horario cortado (ej: 12:00–15:00 y 20:00–23:00).

**AvailabilityException**

Maneja cierres o aperturas puntuales que no responden al horario regular (feriados, fechas especiales).

```
id             UUID     PK
tenant_id      UUID     FK → tenants(id)
date           DATE
is_open        BOOLEAN
opening_time   TIME     nullable (obligatorio si is_open = true)
closing_time   TIME     nullable (obligatorio si is_open = true)
reason         VARCHAR  nullable  ej: 'Feriado', 'Vacaciones'
created_at     TIMESTAMPTZ
```

Funcionamiento del atributo `is_open`:
- `is_open = false` → cerrado, `opening_time` y `closing_time` siempre null
- `is_open = true` → abre, `opening_time` y `closing_time` siempre obligatorios

> **Nota:** `AvailabilityException.is_open` es un campo **independiente** de `Tenant.is_open`. No son el mismo flag.

**Ejemplo:** Si el local normalmente no abre los domingos, pero decide abrir el domingo 1 de junio por una fecha especial, el registro quedaría así:

```
date:           2025-06-01
is_open:        true
opening_time:   12:00
closing_time:   22:00
reason:         'Apertura especial por fecha especial'
```

#### ⚠️ Estado abierto/cerrado: toggle manual (`Tenant.is_open`)

**El sistema NO calcula automáticamente si el local está abierto.** No existe ninguna lógica de negocio que compare la fecha/hora actual contra `RegularSchedule` o `AvailabilityException`.

El campo `tenants.is_open` (default `true`) es un **toggle manual** que el dueño activa o desactiva desde el panel. Cuando está en `false`, el sitio sigue online y el menú se puede ver, pero el carrito queda deshabilitado y no se pueden crear pedidos.

Los horarios y las excepciones **se guardan y se devuelven** en `GET /:tenant/availability`, pero hoy son **informativos**: ninguna lectura de esa información altera `is_open` ni bloquea el checkout.

> **Pendiente (ver `PENDING.md`):** el cálculo automático de "abierto ahora" a partir del horario semanal y las excepciones no está implementado.

#### Relación final

```
Tenant 1 ————————— 1..* RegularSchedule
       |
       └—————————————————————————————— 0..* AvailabilityException
```

`AvailabilityException` apunta directamente al tenant porque es independiente del horario regular; son casos puntuales que no pertenecen a ninguna "programación semanal".

#### Ejemplo de Respuesta del Backend

`GET /:tenant/availability` devuelve el fragmento `schedule` con los nombres reales de campo (ver [`API_REFERENCE.md`](./API_REFERENCE.md) para la respuesta completa):

```json
"schedule": {
  "regular": [
    { "id": "uuid", "dayOfWeek": 1, "openingTime": "11:00", "closingTime": "23:00" },
    { "id": "uuid", "dayOfWeek": 2, "openingTime": "11:00", "closingTime": "23:00" },
    { "id": "uuid", "dayOfWeek": 3, "openingTime": "11:00", "closingTime": "23:00" },
    { "id": "uuid", "dayOfWeek": 4, "openingTime": "11:00", "closingTime": "23:00" },
    { "id": "uuid", "dayOfWeek": 5, "openingTime": "11:00", "closingTime": "00:00" },
    { "id": "uuid", "dayOfWeek": 6, "openingTime": "12:00", "closingTime": "01:00" }
    // dayOfWeek 7 (domingo) ausente → no abre
  ],
  "exceptions": [
    {
      "id": "uuid",
      "date": "2025-06-01",
      "isOpen": true,
      "openingTime": "12:00",
      "closingTime": "22:00",
      "reason": "Apertura especial por fecha especial"
    },
    {
      "id": "uuid",
      "date": "2025-05-25",
      "isOpen": false,
      "openingTime": null,
      "closingTime": null,
      "reason": "Feriado nacional"
    }
  ]
}
```

---

### Costo de Envío

El dueño puede configurar el costo de envío desde el panel de administración. La entidad `Tenant` incluye dos campos para esto:

```
delivery_cost_enabled   BOOLEAN   default: false
delivery_cost           DECIMAL   nullable
```

#### Comportamiento en el checkout

| Estado | Comportamiento |
|--------|---------------|
| `delivery_cost_enabled = true` | El checkout suma el costo al total y lo muestra desglosado: *Subtotal: $X + Envío: $Y = Total: $Z* |
| `delivery_cost_enabled = false` | El checkout muestra solo el subtotal con el aviso: *"El costo de envío no está incluido en este total y se coordina directamente con el local."* |

#### Regla de negocio

**El total del pedido incluye el costo de envío.** Cuando el local tiene un costo de envío fijo configurado, ese importe forma parte del total que ve y paga el cliente: el subtotal de productos más el envío. El frontend debe mostrar siempre el desglose para que el cliente vea explícitamente cuánto del total corresponde al envío.

Cuando el local no tiene costo de envío configurado, el envío no se suma al total y se coordina directamente con el repartidor, lo que se le aclara al cliente con el aviso indicado arriba.

> **Decisión de MVP:** no existe configuración de costos variables por zona o dirección. El costo de envío es un valor fijo único por tenant en caso de que este decida trabajar de esta manera, si no se considera como un costo externo que determinará el repartidor.

---

### Seguimiento de Pedidos

Dado que el cliente no requiere login para realizar un pedido, el seguimiento se resuelve mediante dos mecanismos complementarios.

#### Link único por pedido

Al confirmar el pedido, el sistema genera un UUID único asociado a ese pedido y redirige al cliente a una página de seguimiento con la siguiente estructura:

```
tuapp.com/donpepe/pedido/a3f9b2c1-...
```

Esta página muestra en tiempo real el estado actual del pedido. El cliente puede guardar o compartir el link en cualquier momento para consultar el estado sin necesidad de registrarse ni iniciar sesión.

#### Notificaciones por WhatsApp

El sistema no utiliza la WhatsApp Business API. En su lugar, cuando el dueño actualiza el estado de un pedido desde el panel de administración, el sistema genera un botón "Notificar al cliente" que abre WhatsApp con un mensaje pre-armado informando el nuevo estado, dirigido al número que el cliente proporcionó en el checkout. El dueño lo envía con un tap.

**Combinando ambos mecanismos:** El link de seguimiento le permite consultar el estado en cualquier momento por su cuenta, y las notificaciones por WhatsApp le traen las actualizaciones de forma proactiva sin que tenga que hacer nada. Si el cliente no proporcionó su número en el checkout, puede agregarlo en cualquier momento desde la página de seguimiento (CU-07), aunque el link de seguimiento garantiza que igual pueda hacer el seguimiento de su pedido.

> **Implementación actual:** el backend expone `PATCH /:tenant/orders/:uuid/customer/phone` para actualizar el teléfono del cliente asociado al pedido, pero **no hay ninguna UI en el frontend que lo invoque**. No existe el botón "Recibir actualizaciones por WhatsApp" ni en una pantalla de confirmación (que no existe) ni en la página de seguimiento. Ver [PENDING.md](../context/PENDING.md).

---

### Sesión del Cliente (localStorage)

#### ⚠️ NO IMPLEMENTADO

El banner de **pedido activo** y la clave `pedido_activo_{tenantSlug}` en `localStorage` son un diseño propuesto, **no una funcionalidad existente**. No hay ninguna lectura ni escritura de esa clave en el frontend, y el menú público no muestra ningún banner de pedido en curso.

**Flujo propuesto (no implementado):**

1. Al confirmar el pedido, el frontend guardaría el UUID bajo la clave `pedido_activo_{tenantSlug}` en el `localStorage` del dispositivo.
2. Cuando el cliente vuelve a entrar a `tuapp.com/donpepe`, el frontend consultaría el `localStorage`. Si existe un UUID con un pedido en **estado no terminal** (es decir, que no sea Entregado, Cancelado ni No Retirado), se mostraría un banner: *"Tenés un pedido en curso → Ver estado"*.
3. Cuando el pedido llega a un estado terminal, se eliminaría la entrada del `localStorage`.

> **Nota:** el diseño guarda un único pedido activo por tenant. Si el cliente realiza un segundo pedido antes de que se resuelva el anterior, el nuevo UUID reemplazaría al anterior en el `localStorage`.
>
> **Pendiente (ver `PENDING.md`):** cliente HTTP para consultar el estado del pedido activo + banner en el menú público.

---

### Notificaciones en Tiempo Real para el Dueño

**Decisión para el MVP:** el panel del dueño realiza **polling cada 20 segundos** a la API para verificar si hay pedidos nuevos o cambios de estado. Es la solución más simple y suficiente para la escala del MVP.

En versiones futuras, según la carga real del sistema, se evaluará migrar el **panel del dueño** a **WebSockets** o **Server-Sent Events (SSE)** para lograr notificaciones verdaderamente en tiempo real con menor overhead.

> El SSE **ya está implementado y en uso**, pero solo para el **seguimiento del cliente** (`orders.sse.service.ts` + `@Sse()`). Lo que queda pendiente es aplicarlo al panel del dueño, que hoy sigue con polling.

---

### Seguimiento de Pedido en Tiempo Real (SSE)

La página de seguimiento del cliente (`tuapp.com/donpepe/pedido/[uuid]`) utiliza **Server-Sent Events (SSE)** para actualizar el estado del pedido en tiempo real sin necesidad de recargar la página.

Se eligió SSE por sobre polling o WebSockets por las siguientes razones:

- El cliente está esperando pasivamente, no interactúa con el servidor. SSE es unidireccional y es exactamente el caso de uso para el que fue diseñado.
- A diferencia del polling, el cliente no necesita esperar un intervalo fijo para ver el cambio. La actualización llega en el momento en que el dueño modifica el estado.
- Es significativamente más simple de implementar que WebSockets. NestJS lo soporta nativamente con el decorador `@Sse()`.

**El flujo es el siguiente:**

1. El cliente abre la página de seguimiento y el frontend establece una conexión SSE con el backend.
2. El backend mantiene la conexión abierta y emite un evento cada vez que el estado del pedido cambia.
3. El frontend recibe el evento y actualiza el stepper visual sin recargar la página.
4. Cuando el pedido llega a un estado final (`Entregado`, `Cancelado` o `No retirado`) la conexión se cierra automáticamente.

---

### Soft Delete (Borrado Lógico)

Las entidades `Product` y `Category` **no se eliminan físicamente de la base de datos**. En su lugar, se utiliza el campo `deleted_at` (timestamp): cuando es `null`, el registro está activo; cuando tiene un valor, está eliminado lógicamente.

**Motivo:** preservar la integridad referencial de los `order_items` históricos. Un pedido ya facturado referencia productos con un precio y nombre determinados. Eliminar físicamente esos productos rompería el historial.

Los registros con `deleted_at` no nulo son excluidos de todas las consultas públicas mediante scopes globales en el ORM.

---

### Protección del panel de administración

El sistema tiene **dos contextos de URL distintos:**

- `/[tenant]` → Público, sin autenticación, cualquiera puede ver el menú y hacer pedidos.
- `/admin` → Privado, requiere JWT válido. Si el dueño no está logueado, lo redirige al login.

El login del dueño está en `/admin/login`. Solo el dueño (o empleados que él autorice en el futuro) tiene credenciales para entrar.

**Entrega y transporte del token:**

- El login responde con una **cookie HttpOnly** llamada `access_token` (7 días de vigencia, `SameSite=Lax`, `Secure` solo en producción).
- El token también puede enviarse manualmente en el header `Authorization: Bearer <token>`.

```typescript
// Las rutas públicas no tienen guard
@Get('/menu')
getMenu(@TenantId() tenantId: string) { ... }

// Las rutas de admin sí tienen guard
@UseGuards(JwtAuthGuard)
@Get('/admin/orders')
getOrders(@TenantId() tenantId: string) { ... }
```

El JWT además lleva el `tenant_id` del dueño adentro, así NestJS verifica no solo que esté autenticado, sino que solo pueda acceder a los datos de su propio negocio. El `tenant_id` se toma **exclusivamente del token** (o de la sesión), nunca de un parámetro de la request.

---

### Registro de Dueño

La idea es unificar el registro de la cuenta con el negocio, realizándolo en varios pasos para no saturar de información al usuario:

1. Datos de acceso (Email, contraseña)
2. Datos del negocio
3. Apariencia

---

### Configuración Estética de los Negocios

El backend expone un **único endpoint público** que devuelve toda la configuración del negocio: `GET /:tenant/availability`. Es el mismo endpoint que devuelve los horarios y las excepciones (ver la sección anterior).

**Ejemplo de respuesta del backend:**

```json
GET /:tenant/availability

{
  "name": "Don Pepe Burger",
  "logo": "https://res.cloudinary.com/tuapp/image/upload/donpepe/logo.png",
  "banner": "https://res.cloudinary.com/tuapp/image/upload/donpepe/banner.png",
  "primaryColor": "#E63946",
  "secondaryColor": "#1D3557",
  "description": "Hamburguesas y smash",
  "whatsapp": "5493512345678",
  "address": "Av. Siempreviva 742",
  "isOpen": true,
  "deliveryCostEnabled": true,
  "deliveryCost": 500.00,
  "minimumDeliveryTime": 30,
  "schedule": {
    "regular": [
      { "id": "uuid", "dayOfWeek": 1, "openingTime": "11:00", "closingTime": "23:00" },
      { "id": "uuid", "dayOfWeek": 6, "openingTime": "12:00", "closingTime": "01:00" }
      // domingo ausente → no abre
    ],
    "exceptions": [
      {
        "id": "uuid",
        "date": "2025-06-01",
        "isOpen": true,
        "openingTime": "12:00",
        "closingTime": "22:00",
        "reason": "Apertura especial"
      },
      {
        "id": "uuid",
        "date": "2025-05-25",
        "isOpen": false,
        "openingTime": null,
        "closingTime": null,
        "reason": "Feriado nacional"
      }
    ]
  }
}
```

> **Referencia:** la especificación completa de este endpoint y de los endpoints de configuración del dueño está en [`API_REFERENCE.md`](./API_REFERENCE.md).

#### ¿Cómo lo usa el frontend?

Con esa respuesta el frontend aplica los colores como CSS variables y renderiza todo con la identidad del negocio:

```css
:root {
  --color-primary:   #E63946;
  --color-secondary: #1D3557;
}
```

---

### Métodos de Pago

En el MVP no existe integración con pasarelas de pago online. El cliente abona en **efectivo**, por **transferencia bancaria** o con **tarjeta de débito** al momento de retirar o recibir el pedido.

#### Configuración por parte del dueño

El dueño puede cargar sus datos bancarios desde el panel de administración en "Configuración del negocio": CBU, alias, titular y banco. Estos datos se muestran al cliente únicamente cuando elige transferencia como método de pago.

#### Flujo del cliente

En el checkout el cliente selecciona su método de pago preferido: efectivo, transferencia o tarjeta de débito. Si elige **transferencia**, la pantalla del checkout muestra los datos bancarios del negocio (CBU, alias, banco y titular) para que pueda realizar el pago por su cuenta desde su banco.

#### ⚠️ Verificación del pago: NO IMPLEMENTADA

La **verificación del pago es manual y no está implementada como acción ni estado en el sistema**:

- No existe ningún campo de estado de pago en la entidad `Order` (el enum `PaymentMethod` solo registra el método elegido, no si fue pagado).
- No existe ninguna acción en el panel del dueño para marcar un pedido como "pago verificado" / "pago pendiente".
- La verificación hoy es una gestión **fuera del sistema**: el dueño revisa su banco/cuenta por su cuenta y luego avanza el estado del pedido manualmente con los botones normales (`Confirmar pedido`, etc.).

> **Pendiente (ver `PENDING.md`):** estado de pago + acción de verificación manual en el panel del dueño.

---

### Seguridad y límites

Resumen de las medidas de seguridad realmente implementadas en el backend:

**Rate limiting (ThrottlerGuard global)**

El límite por defecto es muy permisivo y casi todas las rutas heredan ese valor. Todos cuentan por
IP (`req.ip`) en una ventana de 60 s:

| Ruta | Límite |
|---|---|
| Global (`ThrottlerModule.forRoot`) | **100000** requests / 60 s |
| `POST /auth/register` | 5 / 60 s |
| `POST /auth/login` | 10 / 60 s |
| `POST /:tenant/orders` (crear pedido) | 10 / 60 s |
| `GET /:tenant/orders/:uuid/track` | 30 / 60 s |
| `PATCH /:tenant/orders/:uuid/customer/phone` | 3 / 60 s |

> **Requisito de despliegue:** el contador depende de `X-Forwarded-For`. En producción nginx debe
> enviar `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` porque la app usa
> `trust proxy: 1`. Sin ese header, `req.ip` es la IP del proxy y **todos los clientes comparten un
> único contador**. Bloqueante antes de desplegar.

**Cookie de sesión**

- `access_token` es una cookie **HttpOnly** (7 días, `SameSite=Lax`, `Secure` solo en producción). Al ser HttpOnly, no es accesible desde JavaScript del navegador.

**CORS**

- Configurado en `main.ts` con `origin: process.env.CORS_ORIGIN ?? '*'` y `credentials: true`, métodos `GET, POST, PATCH, DELETE`.
- Si `CORS_ORIGIN` no está definido, el origen es comodín (`*`) combinado con `credentials: true`, una combinación insegura en producción.

**Carga de archivos (multipart)**

- Productos (`POST/PATCH /:tenant/products`) y configuración del tenant (`PATCH /:tenant/admin/tenants`)
  validan cada archivo con `imageUploadLimits()` e `imageFileFilter()` de
  `src/common/utils/upload-limits.util.ts`: **5 MB por archivo** y MIME restringido a
  `image/jpeg`, `image/png` e `image/webp`.
- Un MIME no permitido devuelve `400` con el detalle del tipo recibido; un archivo mayor a 5 MB
  devuelve `413`. La validación corre en multer, **antes** del service, así que el archivo rechazado
  no llega a Cloudinary.
- El filtro valida el `Content-Type` declarado por el cliente, que es falseable: un archivo que no
  es imagen enviado como `image/png` pasa el filtro y es Cloudinary quien lo rechaza. La validación
  real por magic bytes quedó descartada para el MVP para no agregar dependencias.

**Aislamiento por tenant**

- Las rutas protegidas toman el `tenant_id` del JWT, nunca del body o de los query params, lo que evita IDOR entre negocios.

> **Pendientes (ver `PENDING.md`):** header `X-Forwarded-For` en nginx (bloqueante de despliegue),
> `CORS_ORIGIN` obligatorio en producción y validación de MIME por magic bytes en las subidas.

## 7. Casos de Uso Principales

### CU-01: Registrar pedido

1. El cliente entra a `tuapp.com/donpepe`
2. Navega el menú y agrega productos al carrito
3. Confirma el carrito y completa el formulario de checkout (Nombre y Teléfono obligatorios, dirección si elige envío)
4. El sistema registra el pedido y redirige directamente a la página de seguimiento con el UUID (`tuapp.com/donpepe/pedido/[uuid]`)
5. El dueño recibe el pedido en el panel (actualización por polling cada 20 segundos)

> **NO IMPLEMENTADO:** el UUID no se guarda en `localStorage` bajo `pedido_activo_{tenantSlug}`, por lo que no hay banner de pedido activo.

### CU-02: Registrar producto

1. El dueño entra al panel de administración
2. Va a la sección "Productos"
3. Agrega un nuevo producto con foto, descripción y precio
4. El producto aparece de inmediato en el menú público

### CU-03: Ocultar producto

1. El dueño detecta que se quedó sin un ingrediente
2. Entra al panel y desactiva el producto
3. El producto deja de aparecer en el menú público, sin eliminarse del apartado de productos del dueño

### CU-04: Registrar apariencia de negocio

1. El dueño entra a "Configuración"
2. Sube su logo y banner
3. Elige su color primario
4. Guarda los cambios y el sitio se actualiza

### CU-05: Cierre temporal

1. El dueño activa el modo "Cerrado" desde el panel (`PATCH /:tenant/admin/tenants` con `isOpen: false`)
2. Los clientes que entren al sitio siguen viendo el menú
3. El carrito se deshabilita y no se pueden generar pedidos

> El cierre es un **toggle manual** sobre `tenants.is_open`. No se deriva automáticamente del horario semanal ni de las excepciones de fecha.

### CU-06: Cancelar pedido

1. El dueño identifica un pedido que necesita cancelar desde el panel de pedidos
2. Abre el detalle del pedido y selecciona "Cancelar pedido" (disponible solo si el estado es Pendiente o En Preparación)
3. El sistema solicita un motivo de cancelación opcional (ej: "Sin stock", "Local cerrado")
4. El dueño confirma la cancelación
5. El sistema actualiza el estado del pedido a `Cancelado` y registra el motivo
6. El dueño puede usar el botón "Notificar cliente por WhatsApp", que abre WhatsApp con un mensaje pre-armado informando la cancelación

> La notificación es un link pre-armado que el dueño envía con un tap. **No hay verificación de pago asociada.**

### CU-07: Seguir pedido por WhatsApp

> **⚠️ NO IMPLEMENTADO en el frontend.** El backend expone `PATCH /:tenant/orders/:uuid/customer/phone` (límite 3/min) que actualiza el teléfono del cliente del pedido, pero **no hay ninguna UI en el frontend que lo invoque**: no existe el botón "Recibir actualizaciones por WhatsApp".

Flujo diseñado:

1. El cliente entra a la página de seguimiento de su pedido
2. Se le ofrece la opción de ingresar su número de WhatsApp
3. El sistema actualiza el teléfono en `customers` (snapshot del pedido)
4. El dueño puede notificarle normalmente por WhatsApp

> Como el teléfono es **obligatorio en el checkout**, el caso solo tendría sentido para pedidos realizados antes de este requisito o para corregir un número mal cargado.

### CU-08: Consultar estado

1. El cliente accede al link de seguimiento de su pedido `tuapp.com/donpepe/pedido/[uuid]`
2. El sistema muestra el estado actual del pedido en un stepper visual con los estados: `Pendiente → En preparación → Listo → Entregado`, o en su defecto `Cancelado` o `No retirado`
3. El cliente puede ver el detalle completo del pedido (productos, cantidades, total, método de pago, tipo de entrega)
4. Si el estado del pedido cambia mientras el cliente tiene la página abierta, el stepper se actualiza en tiempo real sin necesidad de recargar mediante SSE
5. El cliente puede consultar al negocio por el botón "Contactar por WhatsApp", que abre un chat con el WhatsApp del local configurado en el tenant

---

## 8. Modelo de Datos Simplificado

**Todas las claves primarias y foráneas son `UUID`** (`uuid PRIMARY KEY DEFAULT uuid_generate_v4()`). No existen ids incrementales.

```
tenants                  → negocios registrados
                           (id, slug, name, logo, banner, primary_color, secondary_color,
                            description, whatsapp, address, is_open, cbu, alias,
                            account_holder, bank, delivery_cost_enabled, delivery_cost,
                            minimum_delivery_time,
                            created_at, updated_at)

users                    → dueños de negocios
                           (id, tenant_id, email, password, role, created_at, updated_at)

categories               → categorías del menú
                           (id, tenant_id, name, is_active, created_at, updated_at, deleted_at)

products                 → productos
                           (id, tenant_id, category_id, name, description, price,
                            image_url, is_active, created_at, updated_at, deleted_at)

orders                   → pedidos
                           (id, tenant_id, customer_id, delivery_id, status (ENUM),
                            tracking_uuid, cancellation_reason, total, payment_method (ENUM),
                            delivery_type (ENUM), notes, desired_delivery_time,
                            created_at, updated_at)

order_items              → detalle del pedido
                           (id, order_id, product_id, name, quantity, price)

customers                → snapshot de datos del comprador al momento del pedido
                           (id, name, phone, address)

deliveries               → datos de envío a domicilio
                           (id, address, notes, delivery_fee)

regular_schedules        → horario semanal
                           (id, tenant_id, day_of_week (SMALLINT), opening_time, closing_time,
                            max_order_time)

availability_exceptions  → cierres/aperturas excepcionales
                           (id, tenant_id, date, is_open, opening_time, closing_time,
                            max_order_time, reason, created_at)
```

### Notas del modelo

- **`store_pickup` no existe.** El campo real es `orders.delivery_type` (ENUM `DeliveryType`), que define retiro en local vs. envío a domicilio.
- **`payment_method`** (ENUM `PaymentMethod`) está en `orders` y registra el método de pago elegido. No es un estado de pago.
- **`updated_at`** existe en `tenants`, `users`, `categories`, `products`, `orders` y `availability_exceptions`.
- **`is_active`** está tanto en `categories` como en `products` y controla la visibilidad en el menú público.
- **`tenants.whatsapp`** es el número de contacto del negocio, usado por los links pre-armados de WhatsApp.
- **`products.image_url`** guarda la URL de Cloudinary.
- El nombre real de la tabla de envíos es **`deliveries`** (no `delivery`).
- **`order_items`, `customers` y `deliveries` NO tienen `tenant_id`.** Son entidades internas del agregado `Order` y se aíslan a través de `orders.tenant_id`.
- `Customer.updatePhone()` es la operación que permite actualizar el teléfono del snapshot del cliente.
- **Soft delete:** solo `products` y `categories` tienen `deleted_at`. `users` **no** tiene `deleted_at`.
- **Enums:** `orders.status` → `OrderStatus`; `orders.payment_method` → `PaymentMethod`; `orders.delivery_type` → `DeliveryType`; `users.role` → `UserRole`.
- Los importes (`price`, `total`, `delivery_fee`, `delivery_cost`) son `decimal(10,2)`.

> **Referencia:** el detalle completo de las entidades y sus relaciones está en [`diagrams.md`](./diagrams.md).

---

## 9. Diagramas

> Los diagramas de clases, entidad-relación, máquina de estados y casos de uso se encuentran en el archivo [`diagrams.md`](./diagrams.md).

**Clases principales identificadas:**

| Clase | Atributos clave | Métodos |
|-------|----------------|---------|
| **Tenant** | id (UUID), slug, name, logo, banner, primary_color, secondary_color, description, whatsapp, address, is_open, cbu, alias, account_holder, bank, delivery_cost_enabled, delivery_cost, minimum_delivery_time | — |
| **User** | id (UUID), tenant_id, email, password, role | login(), register() |
| **Category** | id (UUID), tenant_id, name, is_active, deleted_at | createCategory(), updateCategory(), deleteCategory(), activateCategory(), hideCategory() |
| **Product** | id (UUID), tenant_id, category_id, name, description, price, image_url, is_active, deleted_at | createProduct(), updateProduct(), deleteProduct(), activateProduct(), hideProduct(), removeImage() |
| **Order** | id (UUID), tenant_id, customer_id, delivery_id, status, tracking_uuid, cancellation_reason, total, payment_method, delivery_type, notes, desired_delivery_time | createOrder(), confirmOrder(), readyOrder(), deliverOrder(), markAsNotPickedUp(), cancelOrder() |
| **OrderItem** | id (UUID), order_id, product_id, name, quantity, price | — |
| **Customer** | id (UUID), name, phone, address | updatePhone() |
| **Delivery** | id (UUID), address, notes, delivery_fee | — |
| **RegularSchedule** | id (UUID), tenant_id, day_of_week, opening_time, closing_time | — |
| **AvailabilityException** | id (UUID), tenant_id, date, is_open, opening_time, closing_time, reason | — |

---

## 10. Funcionalidades Fuera del MVP (versiones futuras)

El detalle y la priorización de cada ítem están en [`ROADMAP.md`](./ROADMAP.md).

### A) Antes de desplegar

- Registrar pedido manual desde el panel admin (botón/modal "Agregar pedido" en Gestión de Pedidos)
- Imprimir recibo del pedido
- Impresión térmica automática
- Código QR en Configuración para imprimir como cartel de mostrador
- Cupones de descuento
- Apartado de estadísticas con reportes en tabla filtrables por fecha, estado y cliente
- Métodos de pago con recargos/descuentos automáticos por método

### B) Después de probarlo con clientes

- Conciliación bancaria automática con CVU único por pedido (Chytapay, Cucuru u otra herramienta)
- Control de stock con actualización automática por venta
- Extras en los pedidos (ej. agregar carne, cheddar)

### C) Roles y plataforma

- Rol Cliente con registro y beneficios por múltiples compras
- Rol Administrador global
- Rol EMPLOYEE (mozo/encargado)
- Integración con pasarelas de pago online
- Costos de envío variables por zona o dirección
- Migración del polling del panel del dueño a WebSockets/SSE

---

> La deuda técnica y los bugs conocidos detectados en el código están en [`context/PENDING.md`](../context/PENDING.md).

---

## 11. Propuesta de Valor Resumida

El sistema permite a cualquier local de comida tener su propio canal de pedidos online sin depender de intermediarios como PedidosYa o Rappi, con:

- URL propia por negocio
- Sin registro requerido para el cliente final
- Panel de administración completo para el dueño
- Notificaciones por WhatsApp sin costo de API
- Seguimiento en tiempo real por SSE
- Identidad visual configurable por negocio
- Arquitectura multi-tenant escalable
