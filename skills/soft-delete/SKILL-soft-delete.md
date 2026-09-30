# SKILL: Soft Delete (NestJS + TypeORM)

## Objetivo
Implementar borrado lógico con `deletedAt` para preservar la integridad referencial de registros históricos, sin eliminar físicamente filas de la base de datos.

---

## 1. Configuración en la entidad

TypeORM provee el decorador `@DeleteDateColumn()` que maneja el soft delete de forma nativa. Cuando se llama a `softDelete()` o `remove()` con soft delete habilitado, TypeORM setea `deletedAt` al timestamp actual en lugar de borrar la fila.

```typescript
// src/modules/categories/entities/category.entity.ts
import { DeleteDateColumn, Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Index()
  @Column({ name: 'tenant_id' })
  tenantId: string;

  // Ocultar/activar — independiente del soft delete (ver sección 4)
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Soft delete: null = activo, timestamp = eliminado lógicamente
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
```

`Product` tiene la misma estructura (`@Entity('products')`), con `name`, `price`, `categoryId`, `isActive`, `imageUrl` y el mismo `@DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })`.

---

## 2. Comportamiento automático de TypeORM

Con `@DeleteDateColumn()` presente, TypeORM activa el **filtro automático** en todas las queries del repositorio: los registros con `deletedAt IS NOT NULL` son excluidos sin necesidad de agregar condiciones manualmente.

```typescript
// Esto devuelve SOLO registros activos (deletedAt IS NULL) — automático
const categories = await this.categoryRepo.find({
  where: { tenantId },
});

// Para incluir eliminados explícitamente (ej: panel de admin avanzado)
const all = await this.categoryRepo.find({
  where: { tenantId },
  withDeleted: true,
});
```

---

## 3. Operaciones de soft delete en el servicio

```typescript
// src/modules/categories/categories.service.ts
@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
  ) {}

  // Borrado lógico — setea deletedAt, NO elimina la fila
  async remove(id: string, tenantId: string) {
    const category = await this.findOneOrFail(id, tenantId);
    await this.categoryRepo.softRemove(category);
  }
}
```

`ProductsService.remove()` hace exactamente lo mismo con `this.productRepo.softRemove(product)`.

### Restaurar un registro eliminado lógicamente — NO IMPLEMENTADO EN EL MVP

No existe ningún método `restore()` / `recover()` en el código, ni endpoint `DELETE|PATCH :id/restore` en `CategoriesController` ni `ProductsController`. **No hay forma de recuperar un registro soft-deleted desde la API.** Si en el futuro se implementa, el patrón sería:

```typescript
// ⚠️ NO IMPLEMENTADO EN EL MVP — referencia para una iteración futura
async restore(id: string, tenantId: string): Promise<Category> {
  const category = await this.categoryRepo.findOne({
    where: { id, tenantId },
    withDeleted: true,          // necesario: sin esto TypeORM no lo encuentra
  });
  if (!category) throw new NotFoundException('Categoría no encontrada');
  return this.categoryRepo.recover(category);
}
```

---

## 4. Qué NO hacer

```typescript
// ❌ INCORRECTO — elimina la fila físicamente
await this.categoryRepo.delete({ id, tenantId });

// ❌ INCORRECTO — filtro manual innecesario (TypeORM ya lo hace)
await this.categoryRepo.find({
  where: { tenantId, deletedAt: IsNull() }, // redundante con @DeleteDateColumn
});

// ❌ INCORRECTO — aplicar soft delete en OrderItem
// OrderItem no debe tener @DeleteDateColumn — su integridad se preserva
// por otras razones (ver Project Context)
```

---

## 5. `isActive` vs soft delete

`Category` y `Product` tienen **dos mecanismos distintos e independientes**:

| Mecanismo | Campo | Endpoints | Efecto |
|---|---|---|---|
| Ocultar / activar | `isActive` (`is_active`) | `PATCH :id/hide` y `PATCH :id/activate` | Oculta del menú público; el registro **sigue visible en el panel del dueño** |
| Soft delete | `deletedAt` (`deleted_at`) | `DELETE :id` | Marca la fila como eliminada lógicamente; invisible en público **y** en el panel |

Ambos existen en `CategoriesController` y `ProductsController` (protegidos con `@UseGuards(JwtAuthGuard)`), y ambos métodos hacen un simple `save()` del campo:

```typescript
// src/modules/products/products.service.ts
async activate(id: string, tenantId: string): Promise<ProductResponseDto> {
  const product = await this.findOneOrFail(id, tenantId);
  product.isActive = true;
  return this.toResponse(await this.productRepo.save(product));
}

async hide(id: string, tenantId: string): Promise<ProductResponseDto> {
  const product = await this.findOneOrFail(id, tenantId);
  product.isActive = false;
  return this.toResponse(await this.productRepo.save(product));
}
```

### Regla real de visibilidad pública de productos

`ProductsService.findAll()` (catálogo público) usa un **INNER JOIN** a la categoría y aplica los cuatro filtros:

```typescript
this.productRepo
  .createQueryBuilder('product')
  .innerJoin('product.category', 'category')
  .where('product.tenantId = :tenantId', { tenantId })
  .andWhere('product.isActive = true')
  .andWhere('category.isActive = true')
  .andWhere('category.deletedAt IS NULL')
  .andWhere('product.deletedAt IS NULL')
```

**Un producto NO se lista en el catálogo público si:** está oculto (`isActive = false`), **o** su categoría está oculta (`category.isActive = false`), **o** su categoría está borrada (`category.deletedAt != null` — el INNER JOIN descarta la fila entera), **o** el propio producto está borrado.

En el panel del dueño, `ProductsService.findAllAdmin()` no aplica ningún filtro de `isActive`: lista también los ocultos (y, por el comportamiento de TypeORM, excluye los soft-deleted).

### `productCount` en categorías

`CategoriesService` calcula el conteo con un `LEFT JOIN` a productos cuya condición **depende de la vista**:

```typescript
// Público (onlyActive = true)
`p.category_id = c.id AND p.deleted_at IS NULL AND p.is_active = true`
// Admin (onlyActive = false)
`p.category_id = c.id AND p.deleted_at IS NULL`
```

Es decir: el **`productCount` público cuenta solo productos activos y no borrados**; el **admin cuenta todos los no borrados**, incluidos los ocultos. En ambos casos la propia categoría se filtra con `c.deleted_at IS NULL`, y el listado público además con `c.is_active = true`.

---

## 6. Checklist antes de hacer commit

- [ ] ¿`@DeleteDateColumn()` está presente solo en `Product` y `Category`?
- [ ] ¿Se usa `softRemove()` en lugar de `delete()` o `remove()`?
- [ ] ¿Las queries públicas NO usan `withDeleted: true`?
- [ ] ¿El listado público de productos mantiene el INNER JOIN a categoría + `product.isActive = true` + `category.isActive = true` + `category.deletedAt IS NULL`?
- [ ] ¿`isActive` y `deletedAt` se tratan como mecanismos separados (ocultar ≠ eliminar)?
- [ ] ¿`productCount` público cuenta solo productos activos y no borrados?
- [ ] ¿Los `order_items` históricos siguen apuntando al producto aunque esté soft-deleted?
- [ ] ¿El panel del dueño (`findAllAdmin`) sí lista los ocultos?
- [ ] ¿No se documenta `restore()` / `recover()` como funcionalidad vigente si el método no existe en el código?

---

## Project Context

### Entidades con Soft Delete en este proyecto

**Solo dos entidades usan `@DeleteDateColumn()`:**

| Entidad | Tabla | Módulo | Motivo |
|---|---|---|---|
| `Product` | `products` | `src/modules/products/` | Preserva integridad de `order_items` históricos |
| `Category` | `categories` | `src/modules/categories/` | Preserva integridad de productos y pedidos históricos |

**Ninguna otra entidad usa soft delete.** En particular: `Order`, `OrderItem`, `Customer`, `Delivery`, `Tenant`, `User` no tienen `@DeleteDateColumn()` (y en el MVP no se eliminan).

### Endpoints de borrado y ocultamiento (reales)

| Operación | `ProductsController` (`/:tenant/products`) | `CategoriesController` (`/:tenant/categories`) |
|---|---|---|
| Soft delete | `DELETE :id` | `DELETE :id` |
| Ocultar | `PATCH :id/hide` | `PATCH :id/hide` |
| Activar | `PATCH :id/activate` | `PATCH :id/activate` |
| Restaurar | — no existe | — no existe |

Todos requieren `@UseGuards(JwtAuthGuard)`.

### Por qué es crítico en este proyecto

Un `OrderItem` histórico guarda el `product_id` como FK. Si el producto se eliminara físicamente, la FK quedaría rota y los pedidos históricos no podrían mostrar qué se compró. El soft delete garantiza que la fila del producto exista siempre en la BD aunque no sea visible en el menú público.

```
orders (pedido del 01/06)
  └── order_items
        ├── product_id: abc-123  ← apunta al producto
        ├── name: "Hamburguesa Don Pepe"  ← snapshot
        └── price: 1500.00  ← snapshot

products (id: abc-123, deletedAt: 2025-06-15)  ← soft deleted, sigue existiendo
```

### Flujo del caso de uso CU-03 (Ocultar producto)

El dueño "oculta" un producto cuando se queda sin stock. Esto **no es un soft delete** — es setear `isActive = false` vía `PATCH /:tenant/products/:id/hide`. El soft delete (`DELETE /:tenant/products/:id`) se usa solo cuando el dueño elimina el producto desde el panel.

```
isActive = false  →  producto oculto del menú público, sigue en el panel del dueño
deletedAt != null  →  producto eliminado lógicamente, invisible en todos lados
                     pero la fila sigue en la BD para integridad histórica
```

Si además la **categoría** del producto está oculta o borrada, el producto tampoco aparece en el público, aunque el producto en sí esté activo y no borrado (por el INNER JOIN de `findAll`).

> Nota: `OrderItem.product_id` tiene `onDelete: 'SET NULL'`, así que un borrado **físico** del producto dejaría la FK en `null` sin romper el historial: los campos `name` y `price` del snapshot siguen intactos.
