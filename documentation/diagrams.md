# Diagramas — Sistema de Pedidos Online

> Este archivo es referencia técnica para los agentes.
> Fuente de verdad de negocio: `/documentation/documentation_sistema_pedidos_online_V3.md`

---

## Diagrama de Clases

```mermaid
classDiagram

    class Tenant {
        +int id
        +string slug
        +string name
        +string logo
        +string banner
        +string primary_color
        +string secondary_color
        +string description
        +bool is_open
        +string cbu
        +string alias
        +string account_holder
        +string bank
        +string whatsapp_number
        +string address
        +bool delivery_cost_enabled
        +float delivery_cost
        +timestamp created_at
        +timestamp updated_at

        +register()
        +updateTenant()
        +openTenant()
        +closeTenant()
    }

    class User {
        +int id
        +string email
        +string password
        +enum role
        +timestamp created_at
        +timestamp updated_at
        +timestamp deleted_at
        +Tenant tenant

        +login()
        +register()
    }

    class Category {
        +int id
        +string name
        +timestamp created_at
        +timestamp updated_at
        +timestamp deleted_at
        +Tenant tenant

        +createCategory()
        +updateCategory()
        +deleteCategory()
    }

    class Product {
        +int id
        +string name
        +string description
        +float price
        +string image
        +boolean is_active
        +timestamp created_at
        +timestamp updated_at
        +timestamp deleted_at
        +Category category
        +Tenant tenant

        +createProduct()
        +updateProduct()
        +deleteProduct()
        +activateProduct()
        +hideProduct()
    }

    class Order {
        +int id
        +enum status
        +string cancellation_reason
        +float total
        +string payment_method
        +boolean store_pickup
        +string notes
        +string tracking_uuid
        +timestamp created_at
        +Tenant tenant
        +Customer customer
        +OrderItem orderItems
        +Delivery delivery

        +createOrder()
        +confirmOrder()
        +readyOrder()
        +deliverOrder()
        +markAsNotPickedUp()
        +cancelOrder()
    }

    class Delivery {
        +int id
        +string address
        +string notes
        +float delivery_fee
    }

    class OrderItem {
        +int id
        +string name
        +int quantity
        +float price
        +Product product
    }

    class Customer {
        +int id
        +string name
        +string phone
        +string address

        +updatePhone()
    }

    class RegularSchedule {
        +int id
        +int day_of_week
        +time opening_time
        +time closing_time
        +Tenant tenant
    }

    class AvailabilityException {
        +int id
        +date date
        +boolean is_open
        +time opening_time
        +time closing_time
        +string reason
        +timestamp created_at
        +Tenant tenant
    }

    %% Relaciones
    User --> "1" Tenant
    Category --> "1" Tenant

    Product --> "1" Tenant
    Product --> "1" Category

    Order --> "1" Tenant
    Order --> "1..*" OrderItem
    OrderItem --> "1" Product

    Order --> "1" Customer
    Order --> "0..1" Delivery

    RegularSchedule --> "1" Tenant
    AvailabilityException --> "1" Tenant
```

---

## Diagrama Entidad-Relación

```mermaid
erDiagram

    Tenant {
        int id PK
        string slug
        string name
        string logo
        string banner
        string primary_color
        string secondary_color
        string description
        bool is_open
        string cbu
        string alias
        string account_holder
        string bank
        string whatsapp_number
        string address
        bool delivery_cost_enabled
        float delivery_cost
        timestamp created_at
        timestamp updated_at
    }

    User {
        int id PK
        string email
        string password
        enum role
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at
        int tenant_id FK
    }

    Category {
        int id PK
        string name
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at
        int tenant_id FK
    }

    Product {
        int id PK
        string name
        string description
        float price
        string image
        boolean is_active
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at
        int category_id FK
        int tenant_id FK
    }

    Order {
        int id PK
        enum status
        string cancellation_reason
        float total
        string payment_method
        boolean store_pickup
        string notes
        string tracking_uuid
        timestamp created_at
        int tenant_id FK
        int customer_id FK
        int delivery_id FK
    }

    Delivery {
        int id PK
        string address
        string notes
        float delivery_fee
    }

    OrderItem {
        int id PK
        string name
        int quantity
        float price
        int order_id FK
        int product_id FK
    }

    Customer {
        int id PK
        string name
        string phone
        string address
    }

    RegularSchedule {
        int id PK
        int day_of_week
        time opening_time
        time closing_time
        int tenant_id FK
    }

    AvailabilityException {
        int id PK
        date date
        boolean is_open
        time opening_time
        time closing_time
        string reason
        timestamp created_at
        int tenant_id FK
    }

    Tenant ||--o{ User : "has"
    Tenant ||--o{ Category : "has"
    Tenant ||--o{ Product : "has"
    Tenant ||--o{ Order : "has"
    Tenant ||--o{ RegularSchedule : "has"
    Tenant ||--o{ AvailabilityException : "has"
    Category ||--o{ Product : "contains"
    Order ||--|{ OrderItem : "comprises"
    Product ||--o{ OrderItem : "ordered_in"
    Customer ||--o{ Order : "places"
    Order ||--o| Delivery : "requires"
```

---

## Diagrama Máquina de Estados

```mermaid
stateDiagram-v2

    [*] --> Pendiente: Registrar pedido / createOrder()

    Pendiente --> EnPreparacion: Confirmar pedido / confirmOrder()
    EnPreparacion --> Listo: Completar preparación / readyOrder()

    Pendiente --> Cancelado: Cancelar pedido / cancelOrder()
    EnPreparacion --> Cancelado: Cancelar pedido / cancelOrder()

    Listo --> Entregado: Entregar pedido / deliverOrder()
    Listo --> NoRetirado: Marcar como no retirado / markAsNotPickedUp()

    Cancelado --> [*]
    Entregado --> [*]
    NoRetirado --> [*]
```

### Tabla de transiciones válidas (referencia para el agente)

| Estado actual | Acción del dueño | Estado destino | Método |
|---|---|---|---|
| `PENDIENTE` | Confirmar pedido | `EN_PREPARACION` | `confirmOrder()` |
| `PENDIENTE` | Cancelar pedido | `CANCELADO` | `cancelOrder()` |
| `EN_PREPARACION` | Completar preparación | `LISTO` | `readyOrder()` |
| `EN_PREPARACION` | Cancelar pedido | `CANCELADO` | `cancelOrder()` |
| `LISTO` | Entregar pedido | `ENTREGADO` | `deliverOrder()` |
| `LISTO` | Marcar como no retirado | `NO_RETIRADO` | `markAsNotPickedUp()` |
| `ENTREGADO` | — | — | Estado terminal |
| `CANCELADO` | — | — | Estado terminal |
| `NO_RETIRADO` | — | — | Estado terminal |

> **Nota de implementación:** Los nombres de estado en el enum de TypeScript usan UPPER_SNAKE_CASE: `PENDIENTE`, `EN_PREPARACION`, `LISTO`, `ENTREGADO`, `CANCELADO`, `NO_RETIRADO`.

---

## Diagrama de Casos de Uso

> No existe sintaxis Mermaid estándar para diagramas de casos de uso. Se representa como lista estructurada por actor.

### Actores

- **Cliente** — usuario final, no requiere registro ni login.
- **Owner** — dueño del negocio, requiere autenticación JWT.

---

### Cliente

| Caso de uso | Descripción |
|---|---|
| Consultar menú | Ver productos organizados por categoría del negocio |
| Registrar pedido | Armar carrito y completar checkout (CU-01) |
| Consultar estado de pedido | Ver stepper de estados en `/pedido/:uuid` vía SSE (CU-08) |
| Seguir pedido por WhatsApp | Agregar teléfono para recibir notificaciones (CU-07) |

---

### Owner

**Sesión**

| Caso de uso | Descripción |
|---|---|
| Iniciar sesión | Login con email y contraseña, recibe JWT con `userId` y `tenantId` |
| Registrarse | Incluye: registrar negocio (nombre, apariencia, datos bancarios) |

**Pedidos**

| Caso de uso | Descripción |
|---|---|
| Consultar pedidos recibidos | Lista de pedidos con polling cada 20s |
| Registrar pedido manual | Por si el pedido llega por otra fuente (teléfono, etc.) |
| Confirmar pedido | `PENDIENTE` → `EN_PREPARACION` |
| Completar preparación | `EN_PREPARACION` → `LISTO` |
| Entregar pedido | `LISTO` → `ENTREGADO` |
| Marcar como no retirado | `LISTO` → `NO_RETIRADO` |
| Cancelar pedido | `PENDIENTE` o `EN_PREPARACION` → `CANCELADO` |
| Notificar cliente por WhatsApp | Genera link pre-armado al cambiar estado (CU-06) |

**Productos**

| Caso de uso | Descripción |
|---|---|
| Consultar menú | Ver productos del negocio en el panel admin |
| Crear producto | Con foto, descripción y precio (CU-02) |
| Modificar producto | Editar campos del producto |
| Eliminar producto | Soft delete — preserva historial de pedidos |
| Activar producto | Volver a mostrar un producto oculto |
| Ocultar producto | Quitar del menú público sin eliminar (CU-03) |

**Categorías**

| Caso de uso | Descripción |
|---|---|
| Consultar categorías | Ver categorías del negocio |
| Crear categoría | Agregar nueva categoría al menú |
| Modificar categoría | Editar nombre de categoría |
| Eliminar categoría | Soft delete de la categoría |

**Configuración del negocio**

| Caso de uso | Descripción |
|---|---|
| Modificar datos de negocio | Nombre, logo, colores, WhatsApp, datos bancarios (CU-04) |
| Registrar cierre temporal | Deshabilita el carrito sin bajar el sitio (CU-05) |
| Registrar apertura de local | Reactiva el carrito |
| Consultar estadísticas básicas | Resumen del día: pedidos, facturado, pendientes |
