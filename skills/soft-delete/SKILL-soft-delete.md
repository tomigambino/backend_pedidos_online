# SKILL: Soft Delete (NestJS + TypeORM)

## Objetivo
Implementar borrado lógico con `deletedAt` para preservar la integridad referencial de registros históricos, sin eliminar físicamente filas de la base de datos.

---

## 1. Configuración en la entidad

TypeORM provee el decorador `@DeleteDateColumn()` que maneja el soft delete de forma nativa. Cuando se llama a `softDelete()` o `remove()` con soft delete habilitado, TypeORM setea `deletedAt` al timestamp actual en lugar de borrar la fila.

```typescript
import { DeleteDateColumn, Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  nombre: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Soft delete: null = activo, timestamp = eliminado lógicamente
  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt: Date | null;
}
```

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
@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
  ) {}

  // Borrado lógico — setea deletedAt, NO elimina la fila
  async remove(id: string, tenantId: string): Promise<void> {
    const category = await this.categoryRepo.findOne({
      where: { id, tenantId },
    });
    if (!category) throw new NotFoundException('Categoría no encontrada');
    await this.categoryRepo.softRemove(category);
  }

  // Restaurar un registro eliminado lógicamente
  async restore(id: string, tenantId: string): Promise<Category> {
    const category = await this.categoryRepo.findOne({
      where: { id, tenantId },
      withDeleted: true,
    });
    if (!category) throw new NotFoundException('Categoría no encontrada');
    return this.categoryRepo.recover(category);
  }
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

## 5. Checklist antes de hacer commit

- [ ] ¿`@DeleteDateColumn()` está presente solo en las entidades correctas?
- [ ] ¿Se usa `softRemove()` en lugar de `delete()` o `remove()`?
- [ ] ¿Las queries públicas NO usan `withDeleted: true`?
- [ ] ¿Los `order_items` históricos siguen apuntando al producto aunque esté soft-deleted?
- [ ] ¿El panel del dueño excluye productos/categorías con `deletedAt` en las vistas de menú?

---

## Project Context

### Entidades con Soft Delete en este proyecto

**Solo dos entidades usan `@DeleteDateColumn()`:**

| Entidad | Módulo | Motivo |
|---|---|---|
| `Product` | `src/modules/products/` | Preserva integridad de `order_items` históricos |
| `Category` | `src/modules/categories/` | Preserva integridad de productos y pedidos históricos |

**Ninguna otra entidad usa soft delete.** En particular: `Order`, `OrderItem`, `Customer`, `Delivery`, `Tenant`, `User` se eliminan físicamente si fuera necesario (o no se eliminan en el MVP).

### Por qué es crítico en este proyecto

Un `OrderItem` histórico guarda el `product_id` como FK. Si el producto se eliminara físicamente, la FK quedaría rota y los pedidos históricos no podrían mostrar qué se compró. El soft delete garantiza que la fila del producto exista siempre en la BD aunque no sea visible en el menú público.

```
orders (pedido del 01/06)
  └── order_items
        ├── product_id: abc-123  ← apunta al producto
        ├── nombre: "Hamburguesa Don Pepe"  ← snapshot
        └── precio: 1500.00  ← snapshot

products (id: abc-123, deletedAt: 2025-06-15)  ← soft deleted, sigue existiendo
```

### Flujo del caso de uso CU-03 (Ocultar producto)

El dueño "oculta" un producto cuando se queda sin stock. Esto **no es un soft delete** — es setear `activo = false`. El soft delete se usa solo cuando el dueño elimina definitivamente el producto desde el panel.

```
activo = false  →  producto oculto del menú público, sigue en panel del dueño
deletedAt != null  →  producto eliminado del panel del dueño, invisible en todos lados
                      pero la fila sigue en la BD para integridad histórica
```
