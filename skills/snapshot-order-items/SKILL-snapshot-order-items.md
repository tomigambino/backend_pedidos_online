# SKILL: Snapshot en Order Items (NestJS + TypeORM)

## Objetivo
Garantizar que cada `OrderItem` guarde una copia inmutable del nombre y precio del producto al momento del pedido, desacoplando el historial de pedidos de cualquier cambio futuro en el catálogo.

---

## 1. El problema que resuelve

Sin snapshot, un `order_item` solo guarda `product_id`. Si el dueño cambia el precio de un producto o lo elimina (soft delete), los pedidos históricos quedarían con datos incorrectos o rotos.

```
SIN snapshot:
  order_item.product_id → producto (precio actual: $2000)
  Pedido del mes pasado muestra: $2000 ← INCORRECTO, era $1500

CON snapshot:
  order_item.precio = 1500.00  ← precio al momento del pedido, inmutable
  order_item.nombre = "Hamburguesa Don Pepe"  ← nombre al momento, inmutable
```

---

## 2. Entidad OrderItem con snapshot

```typescript
// src/modules/order-items/entities/order-item.entity.ts
@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Snapshot del nombre al momento del pedido
  @Column({ name: 'nombre' })
  nombre: string;

  // Snapshot del precio unitario al momento del pedido
  @Column({ name: 'precio', type: 'decimal', precision: 10, scale: 2 })
  precio: number;

  @Column({ name: 'cantidad' })
  cantidad: number;

  // FK al producto — puede quedar soft-deleted, el snapshot ya preservó los datos
  @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ name: 'product_id', nullable: true })
  productId: string | null;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ name: 'order_id' })
  orderId: string;
}
```

---

## 3. Cómo poblar el snapshot al crear el pedido

El snapshot se copia desde el producto en el momento de crear el `OrderItem`. No en ningún otro momento.

```typescript
// src/modules/orders/orders.service.ts
async createOrder(dto: CreateOrderDto, tenantId: string): Promise<Order> {
  // 1. Validar que todos los productos existen y pertenecen al tenant
  const items = await Promise.all(
    dto.items.map(async (itemDto) => {
      const product = await this.productRepo.findOne({
        where: { id: itemDto.productId, tenantId, activo: true },
      });
      if (!product) {
        throw new BadRequestException(
          `Producto ${itemDto.productId} no disponible`,
        );
      }

      // 2. Crear el OrderItem con snapshot de nombre y precio
      const orderItem = this.orderItemRepo.create({
        nombre: product.nombre,       // ← snapshot del nombre
        precio: product.precio,       // ← snapshot del precio
        cantidad: itemDto.cantidad,
        productId: product.id,
      });
      return orderItem;
    }),
  );

  // 3. Crear la orden con los items
  const order = this.orderRepo.create({
    tenantId,
    items,
    // ... resto de campos
  });

  return this.orderRepo.save(order);
}
```

---

## 4. Cómo mostrar un pedido histórico

Al recuperar un pedido, usar **siempre** los campos `nombre` y `precio` del `OrderItem`, no del producto relacionado.

```typescript
// CORRECTO — usa el snapshot
async findOne(id: string, tenantId: string) {
  return this.orderRepo.findOne({
    where: { id, tenantId },
    relations: ['items', 'customer', 'delivery'],
    // No hace falta cargar items.product para mostrar el pedido
  });
}

// Serialización correcta del item
// { nombre: "Hamburguesa Don Pepe", precio: 1500, cantidad: 2 }
// ↑ viene de order_items, no de products
```

```typescript
// INCORRECTO — usa el precio actual del producto
async findOne(id: string, tenantId: string) {
  const order = await this.orderRepo.findOne({
    where: { id, tenantId },
    relations: ['items', 'items.product'], // ❌ carga el producto en vivo
  });
  // Si luego hace order.items[0].product.precio → precio actual, no histórico
}
```

---

## 5. Checklist antes de hacer commit

- [ ] ¿La entidad `OrderItem` tiene `nombre` y `precio` como columnas propias (no `@Computed`)?
- [ ] ¿El servicio copia `product.nombre` y `product.precio` al crear cada item?
- [ ] ¿El servicio valida que el producto existe, pertenece al tenant y está `activo = true`?
- [ ] ¿Los endpoints que muestran pedidos usan `items.nombre` y `items.precio`, no `items.product.nombre`?
- [ ] ¿`productId` en `OrderItem` permite `null` para el caso de que el producto sea físicamente eliminado en el futuro?

---

## Project Context

### Modelo de order_items en este proyecto (de la documentación V3)

```
order_items → detalle de pedido
  id          UUID PK
  nombre      VARCHAR   ← snapshot del nombre del producto
  precio      DECIMAL   ← snapshot del precio unitario al momento del pedido
  cantidad    INTEGER
  order_id    UUID FK → orders(id)
  product_id  UUID FK → products(id)  ← puede quedar apuntando a un soft-deleted
```

### Relación con el modelo de datos completo

```
orders (1) ──────────────── (N) order_items
                                      │
                                      └── product_id → products (puede estar soft-deleted)
                                          nombre  ← snapshot, independiente del producto
                                          precio  ← snapshot, independiente del producto
```

### Por qué `product_id` se mantiene como FK nullable

Aunque el soft delete garantiza que el producto nunca se elimine físicamente en el MVP, se define `product_id` como nullable con `onDelete: 'SET NULL'` como medida de defensa. Si en una versión futura se migra a hard delete o se hace una limpieza de datos, el historial de pedidos no se rompe: los campos `nombre` y `precio` del snapshot siguen intactos.

### Validación de disponibilidad al crear el pedido (CU-01)

Al registrar un pedido (CU-01), el servicio debe verificar **antes de copiar el snapshot**:
1. El producto existe en la BD (`deletedAt IS NULL` — automático por TypeORM).
2. El producto pertenece al tenant (`tenantId` coincide).
3. El producto está activo (`activo = true` — no oculto por falta de stock).

Si alguna condición falla, lanzar `BadRequestException` con el id del producto problemático.
