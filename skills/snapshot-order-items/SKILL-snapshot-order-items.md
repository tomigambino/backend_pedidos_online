# SKILL: Snapshot en Order Items (NestJS + TypeORM)

## Objetivo
Garantizar que cada `OrderItem` guarde una copia inmutable del `name` y `price` del producto al momento del pedido, desacoplando el historial de pedidos de cualquier cambio futuro en el catálogo.

---

## 1. El problema que resuelve

Sin snapshot, un `OrderItem` solo guarda `productId`. Si el dueño cambia el precio de un producto o lo elimina (soft delete), los pedidos históricos quedarían con datos incorrectos o rotos.

```
SIN snapshot:
  order_item.product_id → producto (precio actual: $2000)
  Pedido del mes pasado muestra: $2000 ← INCORRECTO, era $1500

CON snapshot:
  order_item.price = 1500.00  ← precio al momento del pedido, inmutable
  order_item.name  = "Hamburguesa Don Pepe"  ← nombre al momento, inmutable
```

---

## 2. Entidad OrderItem con snapshot

```typescript
// src/modules/orders/entities/order-item.entity.ts
@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Snapshot del nombre al momento del pedido
  @Column()
  name: string;

  // Snapshot del precio unitario al momento del pedido
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column()
  quantity: number;

  // FK al producto — puede quedar soft-deleted, el snapshot ya preservó los datos
  @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'product_id' })
  product: Product | null;

  @Column({ name: 'product_id', nullable: true })
  productId: string | null;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ name: 'order_id' })
  orderId: string;
}
```

**`OrderItem` NO tiene `tenantId` propio.** No es una entidad Tenant-scoped: se aísla a través de su FK a `Order` (`order.tenantId`). Toda consulta a `order_items` debe pasar por un `Order` ya filtrado por `tenantId`. Ver la skill `tenant-isolation`.

Los nombres de columna reales en la BD son `name`, `price`, `quantity`, `order_id` y `product_id` (TypeORM deriva `name`/`price`/`quantity` del nombre de la propiedad, sin `name:` explícito en el decorador).

---

## 3. Cómo poblar el snapshot al crear el pedido

El snapshot se copia desde el producto en el momento de crear el `OrderItem`. No en ningún otro momento. El método real es `OrdersService.create()` (no `createOrder()`) y corre **dentro de una transacción** (`this.dataSource.transaction(...)`).

```typescript
// src/modules/orders/orders.service.ts
async create(dto: CreateOrderDto, tenantId: string): Promise<OrderResponseDto> {
  const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundException('Tenant no encontrado');

  if (
    dto.deliveryType === DeliveryType.ENVIO_DOMICILIO &&
    dto.paymentMethod === PaymentMethod.TARJETA_DEBITO
  ) {
    throw new BadRequestException(
      'No se puede pagar con tarjeta de débito en envío a domicilio. Elegí efectivo o transferencia.',
    );
  }

  return this.dataSource.transaction(async (manager) => {
    // 1. Validar y copiar el snapshot de cada producto.
    //    Delega a ProductsService, que centraliza la visibilidad (isActive + categoría).
    const items = await Promise.all(
      dto.items.map(async (itemDto) => {
        const product = await this.productsService.findOneForOrder(
          itemDto.productId,
          tenantId,
        );
        const item = new OrderItem();
        item.productId = product.id;
        item.name = product.name;   // ← snapshot del nombre
        item.price = product.price; // ← snapshot del precio
        item.quantity = itemDto.quantity;
        return item;
      }),
    );

    // 2. El Customer también es snapshot: datos del cliente al momento del pedido
    const customer = new Customer();
    customer.name = dto.customer.name;
    customer.phone = dto.customer.phone;
    customer.address = dto.customer.address ?? null;

    // 3. Delivery: solo si es envío a domicilio (ver sección 3-bis)
    const delivery = /* ... */;

    // 4. Calcular el total EN EL SERVIDOR a partir del snapshot
    const total = items.reduce(
      (sum, item) => sum + Number(item.price) * item.quantity,
      0,
    );

    // 5. Crear el Order con status PENDIENTE y guardar en cascada
    const order = new Order();
    order.tenantId = tenantId;
    order.status = OrderStatus.PENDIENTE;
    order.trackingUuid = uuid();
    order.cancellationReason = null;
    order.total = total;
    order.paymentMethod = dto.paymentMethod;
    order.deliveryType = dto.deliveryType;
    order.customer = customer;
    order.delivery = delivery;
    order.items = items;
    order.notes = dto.notes ?? null;

    const saved = await manager.getRepository(Order).save(order);
    return this.toResponse(saved);
  });
}
```

### Validación real de productos

La validación no está en `OrdersService` sino en `ProductsService.findOneForOrder()`, que es la única fuente de verdad:

```typescript
// src/modules/products/products.service.ts
async findOneForOrder(id: string, tenantId: string): Promise<Product> {
  const product = await this.productRepo
    .createQueryBuilder('p')
    .innerJoin('p.category', 'c', 'c.isActive = true AND c.deletedAt IS NULL')
    .where('p.id = :id AND p.tenantId = :tenantId AND p.isActive = true', {
      id,
      tenantId,
    })
    .getOne();
  if (!product) throw new BadRequestException(`Producto ${id} no disponible`);
  return product;
}
```

Verifica, en la misma query:
1. El producto existe (`deletedAt IS NULL` automático por TypeORM — los soft-deleted no se encuentran).
2. El producto pertenece al tenant (`tenantId` coincide).
3. El producto está activo (`isActive: true` — no oculto por falta de stock).
4. La categoría del producto está activa (`c.isActive = true` — INNER JOIN a `category`).
5. La categoría del producto no está borrada (`c.deletedAt IS NULL`).

Si alguna falla, lanza `BadRequestException` con el id del producto problemático.

Es la misma regla que el catálogo público (`ProductsService.findAll()`, INNER JOIN a la categoría): **lo que no se puede pedir es lo que no está en el menú** (ver la skill `soft-delete`).

### Cálculo del total

El `total` se calcula en el servidor con un `reduce` sobre los snapshots ya copiados: `sum(Number(item.price) * item.quantity)`. **No confía en ningún precio enviado por el cliente** — el DTO (`CreateOrderDto`) solo acepta `productId` y `quantity` por item. El `total` no incluye el costo de envío (ver sección 3-bis).

---

## 3-bis. Snapshot de `Delivery` (`deliveryFee`)

`Delivery` también es un snapshot: el costo de envío se **copia** al crear el pedido y no se lee en vivo del tenant después.

```typescript
// Dentro de la misma transacción de create()
let delivery: Delivery | null = null;
if (dto.deliveryType === DeliveryType.ENVIO_DOMICILIO) {
  delivery = new Delivery();
  delivery.address = dto.address!;
  delivery.notes = dto.deliveryNotes ?? null;
  delivery.deliveryFee = tenant.deliveryCostEnabled
    ? Number(tenant.deliveryCost)
    : null;
}
```

**Cuándo aplica:**
- Solo si `deliveryType === DeliveryType.ENVIO_DOMICILIO`. Con `RETIRO_LOCAL` no se crea `Delivery` y queda `null`.
- El `deliveryFee` se setea solo si `tenant.deliveryCostEnabled` es `true`; si el tenant no tiene habilitado el costo de envío, queda `null`.
- El `tenant` se lee **una sola vez** al inicio de `create()` y se reutiliza, así que el valor copiado es el vigente en el momento del pedido.

Si el dueño cambia `Tenant.deliveryCost` después, los pedidos ya creados siguen mostrando el valor original en `delivery.deliveryFee`.

---

## 4. Cómo mostrar un pedido histórico

Al recuperar un pedido, usar **siempre** `item.name` e `item.price` del `OrderItem`, nunca del producto relacionado. `OrderResponseDto` no expone ningún dato de `Product`.

```typescript
// src/modules/orders/dto/order-item-response.dto.ts
export class OrderItemResponseDto {
  id: string;
  productId: string | null;
  name: string;      // ← del OrderItem (snapshot)
  price: number;     // ← del OrderItem (snapshot), con Number() en toResponse()
  quantity: number;
}
```

`OrdersService` mapea los items así (nunca toca `item.product`):

```typescript
items: (order.items ?? []).map((item) => ({
  id: item.id,
  productId: item.productId,
  name: item.name,
  price: Number(item.price),
  quantity: item.quantity,
})),
```

Las queries de pedidos cargan `items`, `customer` y `delivery` — **no** `items.product`:

```typescript
// src/modules/orders/orders.service.ts
const order = await this.orderRepo.findOne({
  where: { id, tenantId },
  relations: { items: true, customer: true, delivery: true },
});
```

```typescript
// INCORRECTO — usa el precio/nombre actual del producto
relations: { items: { product: true } }, // ❌ carga el producto en vivo
// Si luego lee order.items[0].product.price → precio actual, no histórico
```

---

## 5. Checklist antes de hacer commit

- [ ] ¿La entidad `OrderItem` tiene `name` y `price` como columnas propias (no `@Computed`)?
- [ ] ¿`OrderItem` no tiene `tenantId` y se aísla vía `order.tenantId`?
- [ ] ¿El servicio copia `product.name` y `product.price` al crear cada item?
- [ ] ¿La validación del producto delega en `ProductsService.findOneForOrder()` (filtra `tenantId` + `isActive` del producto + `isActive`/`deletedAt` de su categoría)?
- [ ] ¿El `total` se calcula en el servidor desde el snapshot (`sum(price * quantity)`)?
- [ ] ¿Los endpoints que muestran pedidos usan `items.name` e `items.price`, no `items.product.name`?
- [ ] ¿`Delivery.deliveryFee` se copia del tenant al crear el pedido, y solo con `deliveryType = ENVIO_DOMICILIO`?
- [ ] ¿`productId` en `OrderItem` permite `null` para el caso de que el producto sea físicamente eliminado en el futuro?

---

## Project Context

### Modelo de order_items en este proyecto (de la documentación V3)

```
order_items → detalle de pedido
  id          UUID PK
  name        VARCHAR   ← snapshot del nombre del producto
  price       DECIMAL   ← snapshot del precio unitario al momento del pedido
  quantity    INTEGER
  order_id    UUID FK → orders(id)
  product_id  UUID FK → products(id)  ← nullable, onDelete SET NULL,
                                       puede quedar apuntando a un soft-deleted
```

### Relación con el modelo de datos completo

```
orders (1) ──────────────── (N) order_items
              tenant_id                 │
                                          └── product_id → products (puede estar soft-deleted)
                                              name  ← snapshot, independiente del producto
                                              price ← snapshot, independiente del producto
```

`OrderItem` no tiene `tenant_id`: el aislamiento viene de `orders.tenant_id`, a través de `order_id`.

### Por qué `product_id` se mantiene como FK nullable

Aunque el soft delete garantiza que el producto nunca se elimine físicamente en el MVP, se define `product_id` como nullable con `onDelete: 'SET NULL'` como medida de defensa. Si en una versión futura se migra a hard delete o se hace una limpieza de datos, el historial de pedidos no se rompe: los campos `name` y `price` del snapshot siguen intactos.

### Validación de disponibilidad al crear el pedido (CU-01)

Al registrar un pedido (CU-01), la verificación ocurre en `ProductsService.findOneForOrder()` **antes de copiar el snapshot**, en la misma query:
1. El producto existe en la BD (`deletedAt IS NULL` — automático por TypeORM).
2. El producto pertenece al tenant (`tenantId` coincide).
3. El producto está activo (`isActive: true` — no oculto por falta de stock).
4. La categoría del producto está activa (`isActive: true`).
5. La categoría del producto no está borrada (`deletedAt IS NULL`).

Si alguna condición falla, lanza `BadRequestException` con el id del producto problemático.

> El alta de pedidos aplica el mismo filtro de visibilidad que el catálogo público (`ProductsService.findAll()`, INNER JOIN a `category`): pedir un producto con la categoría oculta o borrada devuelve 400, igual que pedir un producto oculto, borrado o de otro tenant.
