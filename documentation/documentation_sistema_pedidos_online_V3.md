# Documentación MVP Sistema de Pedidos Online

> **Versión:** 3.4

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

### Estructura de carpetas (backend)

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

Cada negocio que contrate el sistema tiene su propio **tenant**, identificado por un subdominio o ruta única:

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

1. El dueño ingresa email y contraseña en `/admin`
2. El backend valida las credenciales y además verifica que ese usuario tenga acceso al tenant del subdominio actual
3. Si es válido, devuelve un JWT que incluye el `userId` y el `tenantId`
4. Todas las requests siguientes incluyen ese JWT, y el backend usa el `tenantId` del token para filtrar los datos

> **⚠️ Regla de seguridad crítica:** En ningún caso el backend acepta un `tenant_id` enviado manualmente en el body o parámetros de la request para operaciones protegidas. El token es la única fuente válida.

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
- Teléfono (**opcional** — se puede agregar después desde la página de seguimiento para recibir actualizaciones por WhatsApp)
- Método de pago: efectivo o transferencia (obligatorio)

> **Aclaración sobre el costo del envío:** Si el dueño tiene activado el costo de envío fijo, el checkout lo suma al total y lo muestra desglosado: `Subtotal: $X + Envío: $Y = Total: $Z`. Si el dueño tiene el costo de envío desactivado, se muestra el subtotal con el siguiente aviso: *"El costo de envío no está incluido en este total y se coordina directamente con el local."*

**Confirmación:** Pantalla de "Tu pedido fue enviado" con una redirección al apartado de seguimiento con el número de pedido. Si el cliente no dejó su teléfono, se muestra el botón "Recibir actualizaciones por WhatsApp" para ingresarlo en ese momento. El UUID del pedido se guarda automáticamente en el `localStorage` del dispositivo.

### 5.2 Panel de Administración (vista del dueño)

Accesible desde `tuapp.com/donpepe/admin`. Requiere login con usuario y contraseña.

**Dashboard:** Resumen del día (pedidos recibidos, total facturado, pedidos pendientes).

**Pedidos:** Lista de pedidos con actualización automática por polling cada 20 segundos. Muestra estado de cada pedido (visualizables en la Máquina de Estados). El dueño puede cambiar el estado de cada pedido.

**Menú / Productos:** CRUD completo de categorías y productos. Puede subir fotos, definir precios y ocultar productos temporalmente (por ejemplo, si se terminó un ingrediente).

**Configuración del negocio:** Nombre, logo, colores, banner, WhatsApp de contacto, horarios de atención, dirección, datos bancarios y configuración de costo de envío.

---

## 6. Aclaraciones Técnicas

### Manejo de Horarios

#### Estándar adoptado: ISO 8601

`dia_semana` es un `SMALLINT` donde **1 = Lunes** y **7 = Domingo**. Esta convención es explícita en toda la base de datos y diferente al estándar de JavaScript (`Date.getDay()`, donde 0 = Domingo). Cualquier conversión desde objetos `Date` de JS debe tener esto en cuenta.

#### Entidades y atributos

**HorarioRegular**

```
id             UUID     PK
tenant_id      UUID     FK → tenants(id)
dia_semana     SMALLINT  1=Lunes ... 7=Domingo
hora_apertura  TIME
hora_cierre    TIME
```

Cada fila representa un bloque horario de atención para un día de la semana. Si un día no tiene filas, el local no abre ese día. Si tiene más de una fila para el mismo día, significa que el local trabaja en horario cortado (ej: 12:00–15:00 y 20:00–23:00).

**ExcepcionDisponibilidad**

Maneja cierres o aperturas puntuales que no responden al horario regular (feriados, fechas especiales).

```
id             UUID     PK
tenant_id      UUID     FK → tenants(id)
fecha          DATE
esta_abierto   BOOLEAN
hora_apertura  TIME     nullable (obligatorio si esta_abierto = true)
hora_cierre    TIME     nullable (obligatorio si esta_abierto = true)
motivo         VARCHAR  nullable  ej: 'Feriado', 'Vacaciones'
```

Funcionamiento del atributo `esta_abierto`:
- `esta_abierto = false` → cerrado, `hora_apertura` y `hora_cierre` siempre null
- `esta_abierto = true` → abre, `hora_apertura` y `hora_cierre` siempre obligatorios

**Ejemplo:** Si el local normalmente no abre los domingos, pero decide abrir el domingo 1 de junio por una fecha especial, el registro quedaría así:

```
fecha:         2025-06-01
esta_abierto:  true
hora_apertura: 12:00
hora_cierre:   22:00
motivo:        'Apertura especial por fecha especial'
```

Cuando el sistema consulte si el local está abierto ese domingo, no va a encontrar registro en `HorarioRegular` para ese día (porque normalmente no abre), pero sí va a encontrar una excepción con `esta_abierto = true`, entonces usa el horario definido en esa excepción para determinar si está abierto en ese momento.

#### Relación final

```
Tenant 1 ————————— 1..* HorarioRegular
       |
       └—————————————————————————————— 0..* ExcepcionDisponibilidad
```

`ExcepcionDisponibilidad` apunta directamente al tenant porque es independiente del horario regular; son casos puntuales que no pertenecen a ninguna "programación semanal".

#### Ejemplo de Respuesta del Backend

```json
"schedule": {
  "regular": [
    { "diaSemana": 1, "horaApertura": "11:00", "horaCierre": "23:00" },
    { "diaSemana": 2, "horaApertura": "11:00", "horaCierre": "23:00" },
    { "diaSemana": 3, "horaApertura": "11:00", "horaCierre": "23:00" },
    { "diaSemana": 4, "horaApertura": "11:00", "horaCierre": "23:00" },
    { "diaSemana": 5, "horaApertura": "11:00", "horaCierre": "00:00" },
    { "diaSemana": 6, "horaApertura": "12:00", "horaCierre": "01:00" }
    // diaSemana 7 (domingo) ausente → no abre
  ],
  "excepciones": [
    {
      "fecha": "2025-06-01",
      "estaAbierto": true,
      "horaApertura": "12:00",
      "horaCierre": "22:00",
      "motivo": "Apertura especial por fecha especial"
    },
    {
      "fecha": "2025-05-25",
      "estaAbierto": false,
      "horaApertura": null,
      "horaCierre": null,
      "motivo": "Feriado nacional"
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

---

### Sesión del Cliente (localStorage)

Para mejorar la experiencia de usuario sin requerir registro, el sistema utiliza `localStorage` del navegador para recordar el pedido activo del cliente.

**Flujo:**

1. Al confirmar el pedido, el frontend guarda el UUID bajo la clave `pedido_activo_{tenantSlug}` en el `localStorage` del dispositivo.
2. Cuando el cliente vuelve a entrar a `tuapp.com/donpepe`, el frontend consulta el `localStorage`. Si existe un UUID con un pedido en **estado no terminal** (es decir, que no sea Entregado, Cancelado ni No Retirado), se muestra un banner: *"Tenés un pedido en curso → Ver estado"*.
3. Cuando el pedido llega a un estado terminal, se elimina la entrada del `localStorage`.

> **Nota:** se guarda un único pedido activo por tenant. Si el cliente realiza un segundo pedido antes de que se resuelva el anterior, el nuevo UUID reemplaza al anterior en el `localStorage`.

---

### Notificaciones en Tiempo Real para el Dueño

**Decisión para el MVP:** el panel del dueño realiza **polling cada 20 segundos** a la API para verificar si hay pedidos nuevos o cambios de estado. Es la solución más simple y suficiente para la escala del MVP.

En versiones futuras, según la carga real del sistema, se evaluará migrar a **WebSockets** o **Server-Sent Events (SSE)** para lograr notificaciones verdaderamente en tiempo real con menor overhead.

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

- `tuapp.com/donpepe` → Público, sin autenticación, cualquiera puede ver el menú y hacer pedidos.
- `tuapp.com/donpepe/admin` → Privado, requiere JWT válido. Si el dueño no está logueado, lo redirige al login.

El login del dueño está en `tuapp.com/donpepe/admin/login`. Solo el dueño (o empleados que él autorice en el futuro) tiene credenciales para entrar.

En NestJS esto se implementa con un **Guard de autenticación** que solo aplica a las rutas `/admin`:

```typescript
// Las rutas públicas no tienen guard
@Get('/menu')
getMenu(@TenantId() tenantId: string) { ... }

// Las rutas de admin sí tienen guard
@UseGuards(JwtAuthGuard)
@Get('/admin/orders')
getOrders(@TenantId() tenantId: string) { ... }
```

El JWT además lleva el `tenant_id` del dueño adentro, así NestJS verifica no solo que esté autenticado, sino que solo pueda acceder a los datos de su propio negocio.

---

### Registro de Dueño

La idea es unificar el registro de la cuenta con el negocio, realizándolo en varios pasos para no saturar de información al usuario:

1. Datos de acceso (Email, contraseña)
2. Datos del negocio
3. Apariencia

---

### Configuración Estética de los Negocios

En el backend, se creará el endpoint `GET /tenants/donpepe/config` para devolver la información del negocio.

**Ejemplo de respuesta del backend:**

```json
GET /tenants/donpepe/config

{
  "name": "Don Pepe Burger",
  "logo": "https://res.cloudinary.com/tuapp/image/upload/donpepe/logo.png",
  "banner": "https://res.cloudinary.com/tuapp/image/upload/donpepe/banner.png",
  "primaryColor": "#E63946",
  "secondaryColor": "#1D3557",
  "whatsapp": "5493512345678",
  "address": "Av. Siempreviva 742",
  "deliveryCostEnabled": true,
  "deliveryCost": 500.00,
  "schedule": {
    "regular": [
      { "diaSemana": 1, "horaApertura": "11:00", "horaCierre": "23:00" },
      { "diaSemana": 2, "horaApertura": "11:00", "horaCierre": "23:00" },
      { "diaSemana": 3, "horaApertura": "11:00", "horaCierre": "23:00" },
      { "diaSemana": 4, "horaApertura": "11:00", "horaCierre": "23:00" },
      { "diaSemana": 5, "horaApertura": "11:00", "horaCierre": "00:00" },
      { "diaSemana": 6, "horaApertura": "12:00", "horaCierre": "01:00" }
      // domingo ausente → no abre
    ],
    "excepciones": [
      {
        "fecha": "2025-06-01",
        "estaAbierto": true,
        "horaApertura": "12:00",
        "horaCierre": "22:00",
        "motivo": "Apertura especial"
      },
      {
        "fecha": "2025-05-25",
        "estaAbierto": false,
        "horaApertura": null,
        "horaCierre": null,
        "motivo": "Feriado nacional"
      }
    ]
  }
}
```

#### ¿Cómo lo usa el frontend?

Cuando alguien entra a `tuapp.com/donpepe`, lo primero que hace Next.js es pedir la configuración del tenant:

```javascript
// Un solo endpoint público
GET /tenants/donpepe/config

// Respuesta
{
  "name": "Don Pepe Burger",
  "logo": "https://storage.tuapp.com/donpepe/logo.png",
  "banner": "https://storage.tuapp.com/donpepe/banner.png",
  "primaryColor": "#E63946",
  "secondaryColor": "#1D3557",
  "whatsapp": "5493512345678",
  "address": "Av. Siempreviva 742",
  "schedule": { ... }
}
```

Con eso el frontend aplica los colores como CSS variables y renderiza todo con la identidad del negocio:

```css
:root {
  --color-primary:   #E63946;
  --color-secondary: #1D3557;
}
```

---

### Métodos de Pago

En el MVP no existe integración con pasarelas de pago online. El cliente abona en efectivo o por transferencia bancaria al momento de retirar o recibir el pedido.

#### Configuración por parte del dueño

El dueño puede cargar sus datos bancarios desde el panel de administración en "Configuración del negocio": CBU, alias, titular y banco. Estos datos se muestran al cliente únicamente cuando elige transferencia como método de pago.

#### Flujo del cliente

En el checkout el cliente selecciona su método de pago preferido: efectivo o transferencia. Si elige transferencia, la pantalla de confirmación del pedido muestra los datos bancarios del negocio para que pueda realizar el pago por su cuenta desde su banco. La verificación del pago es manual; el dueño confirma desde el panel que la transferencia fue recibida.

---

### Estructura de carpetas en Next.js

```
app/
├── [tenant]/
|   ├── page.tsx              → carta digital (tuapp.com/donpepe)
|   ├── pedido/
|   |   └── [uuid]/
|   |       └── page.tsx      → seguimiento (tuapp.com/donpepe/pedido/uuid)
|   └── admin/
|       ├── page.tsx          → panel admin (tuapp.com/donpepe/admin)
|       ├── productos/
|       |   └── page.tsx
|       └── pedidos/
|           └── page.tsx
└── page.tsx                  → landing de tuapp.com (presentación del producto)
```

---

## 7. Casos de Uso Principales

### CU-01: Registrar pedido

1. El cliente entra a `tuapp.com/donpepe`
2. Navega el menú y agrega productos al carrito
3. Confirma el carrito y completa el formulario de checkout (Teléfono opcional)
4. El sistema registra el pedido y muestra pantalla de confirmación con link de seguimiento
5. El UUID del pedido se guarda en `localStorage` bajo `pedido_activo_{tenantSlug}`
6. El dueño recibe la notificación en el panel (actualización por polling cada 20 segundos)

### CU-02: Registrar producto en menú

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
4. Guarda los cambios y el sitio se actualiza en tiempo real

### CU-05: Registrar cierre de local temporalmente

1. El dueño activa el modo "Cerrado" desde el panel
2. Los clientes que entren al sitio ven un mensaje de "Estamos cerrados"
3. El carrito se deshabilita y no se pueden generar pedidos, pero sí visualizar el menú

### CU-06: Cancelar pedido

1. El dueño identifica un pedido que necesita cancelar desde el panel de pedidos
2. Abre el detalle del pedido y selecciona "Cancelar pedido" (disponible solo si el estado es Pendiente o En Preparación)
3. El sistema solicita un motivo de cancelación opcional (ej: "Sin stock", "Local cerrado")
4. El dueño confirma la cancelación
5. El sistema actualiza el estado del pedido a `Cancelado` y registra el motivo
6. Si el cliente proporcionó su número, el sistema genera el botón "Notificar al cliente" con un mensaje pre-armado informando la cancelación y el motivo. Si no, simplemente se muestra en el seguimiento del pedido que fue "Cancelado".
7. El dueño envía la notificación con un tap desde WhatsApp

### CU-07: Seguir pedido por WhatsApp

1. Cliente confirma el pedido sin dejar teléfono
2. En la pantalla de confirmación/seguimiento aparece un botón "Recibir actualizaciones por WhatsApp"
3. El cliente ingresa su número
4. El sistema actualiza el campo `telefono` en `customers`
5. El dueño puede notificarle normalmente por WhatsApp

### CU-08: Consultar estado de pedido

1. El cliente accede al link de seguimiento de su pedido `tuapp.com/donpepe/pedido/[uuid]` (por link directo o por el banner en `localStorage`)
2. El sistema muestra el estado actual del pedido en un stepper visual con los estados: `Pendiente → En preparación → Listo → Entregado`, o en su defecto `Cancelado`
3. El cliente puede ver el detalle completo del pedido (productos, cantidades, total, método de pago, tipo de entrega)
4. Si el estado del pedido cambia mientras el cliente tiene la página abierta, el stepper se actualiza en tiempo real sin necesidad de recargar mediante SSE
5. Si el cliente aún no registró su número, el sistema le ofrece el botón "Recibir actualizaciones por WhatsApp"

---

## 8. Modelo de Datos Simplificado

```
tenants                  → negocios registrados (id, slug, name, logo, ...)
users                    → dueños de negocios (id, email, password, role, ...)
categories               → categorías del menú (id, name, created_at, ...)
products                 → productos (id, name, description, price, is_active, deleted_at, ...)
orders                   → pedidos (id, status (ENUM), cancellation_reason, ...)
order_items              → detalle de pedido (id, name, quantity, price, ...)
customers                → snapshot de datos del comprador al momento del pedido
                           (id, name, phone, address)
delivery                 → datos de envío a domicilio (id, address, notes, ...)
regular_schedules        → horario semanal (id, day_of_week (SMALLINT), opening_time, closing_time, ...)
availability_exceptions  → cierres/aperturas excepcionales (id, date, is_open, ...)
```

---

## 9. Diagramas

### Diagrama de Clases

> Los diagramas de clases, entidad-relación, máquina de estados y casos de uso se encuentran en el archivo [`DIAGRAMS.md`](./DIAGRAMS.md).

**Clases principales identificadas:**

| Clase | Atributos clave | Métodos |
|-------|----------------|---------|
| **Order** | status, cancellation_reason, total, payment_method, store_pickup, tracking_uuid | createOrder(), confirmOrder(), readyOrder(), deliverOrder(), markAsNotPickedUp(), cancelOrder() |
| **OrderItem** | name, quantity, price | — |
| **Customer** | name, phone, address | updatePhone() |
| **Delivery** | address, notes, delivery_fee | — |
| **Product** | name, description, price, is_active, deleted_at | createProduct(), updateProduct(), deleteProduct(), activateProduct(), hideProduct() |
| **Category** | name, deleted_at | createCategory(), updateCategory(), deleteCategory() |
| **User** | email, password, role | login(), register() |
| **Tenant** | slug, name, logo, banner, primary_color, secondary_color, delivery_cost_enabled, delivery_cost | — |
| **RegularSchedule** | day_of_week, opening_time, closing_time | — |
| **AvailabilityException** | date, is_open, opening_time, closing_time, reason | — |

---

## 10. Funcionalidades Fuera del MVP (versiones futuras)

- Rol Cliente con registro y beneficios por múltiples compras
- Rol Administrador global
- Rol EMPLOYEE (mozo/encargado)
- Costos de envío variables por zona o dirección
- Integración con pasarelas de pago online
- Migración de polling a WebSockets/SSE para el panel del dueño
- Reportes avanzados de ventas

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
