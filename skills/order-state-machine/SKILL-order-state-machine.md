# SKILL: Order State Machine (NestJS + TypeORM)

## Objetivo
Implementar la máquina de estados de pedidos con transiciones controladas, garantizando que ningún pedido pueda saltar a un estado inválido y que los estados terminales sean irreversibles.

---

## 1. Enum de estados

```typescript
// src/common/enums/order-status.enum.ts
export enum OrderStatus {
  PENDIENTE = 'PENDIENTE',
  EN_PREPARACION = 'EN_PREPARACION',
  LISTO = 'LISTO',
  ENTREGADO = 'ENTREGADO',
  CANCELADO = 'CANCELADO',
  NO_RETIRADO = 'NO_RETIRADO',
}
```

---

## 2. Matriz de transiciones válidas

Implementar como un mapa de estado actual → estados destino permitidos. El servicio valida contra este mapa antes de cualquier cambio de estado.

```typescript
// src/modules/orders/constants/order-transitions.ts
import { OrderStatus } from '../../../common/enums/order-status.enum';

export const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDIENTE]:       [OrderStatus.EN_PREPARACION, OrderStatus.CANCELADO],
  [OrderStatus.EN_PREPARACION]:  [OrderStatus.LISTO, OrderStatus.CANCELADO],
  [OrderStatus.LISTO]:           [OrderStatus.ENTREGADO, OrderStatus.NO_RETIRADO],
  [OrderStatus.ENTREGADO]:       [], // terminal
  [OrderStatus.CANCELADO]:       [], // terminal
  [OrderStatus.NO_RETIRADO]:     [], // terminal
};

export const TERMINAL_STATES = [
  OrderStatus.ENTREGADO,
  OrderStatus.CANCELADO,
  OrderStatus.NO_RETIRADO,
];
```

---

## 3. Validación de transición en el servicio

```typescript
// src/modules/orders/orders.service.ts
@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
  ) {}

  async updateStatus(
    id: string,
    tenantId: string,
    newStatus: OrderStatus,
    motivoCancelacion?: string,
  ): Promise<Order> {
    const order = await this.orderRepo.findOne({ where: { id, tenantId } });
    if (!order) throw new NotFoundException('Pedido no encontrado');

    // Validar transición
    const allowed = VALID_TRANSITIONS[order.estado];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Transición inválida: ${order.estado} → ${newStatus}. ` +
        `Transiciones permitidas: ${allowed.join(', ') || 'ninguna (estado terminal)'}`,
      );
    }

    // Motivo de cancelación obligatorio si el nuevo estado es CANCELADO
    if (newStatus === OrderStatus.CANCELADO && motivoCancelacion) {
      order.motivoCancelacion = motivoCancelacion;
    }

    order.estado = newStatus;
    return this.orderRepo.save(order);
  }
}
```

---

## 4. DTO para cambio de estado

```typescript
// src/modules/orders/dto/update-order-status.dto.ts
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrderStatus } from '../../../common/enums/order-status.enum';

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  estado: OrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  motivoCancelacion?: string;
}
```

---

## 5. Endpoint en el controlador

```typescript
// Solo el dueño (admin) puede cambiar estados
@UseGuards(JwtAuthGuard)
@Patch(':id/status')
updateStatus(
  @Param('id', ParseUUIDPipe) id: string,
  @TenantId() tenantId: string,
  @Body() dto: UpdateOrderStatusDto,
) {
  return this.ordersService.updateStatus(id, tenantId, dto.estado, dto.motivoCancelacion);
}
```

---

## 6. Checklist antes de hacer commit

- [ ] ¿El mapa `VALID_TRANSITIONS` cubre los 6 estados y los 3 terminales tienen array vacío?
- [ ] ¿El servicio lanza excepción si la transición no está en el mapa?
- [ ] ¿`motivoCancelacion` solo se persiste cuando `newStatus === CANCELADO`?
- [ ] ¿El DTO valida con `@IsEnum(OrderStatus)` y no acepta strings libres?
- [ ] ¿La ruta de cambio de estado tiene `@UseGuards(JwtAuthGuard)`?
- [ ] ¿Al llegar a estado terminal se dispara el cierre del SSE? (ver sección SSE en documentación)

---

## Project Context

### Diagrama de estados del proyecto

```
PENDIENTE ──────────────────────────────────────────→ CANCELADO ✓ (terminal)
    │
    ↓
EN_PREPARACION ─────────────────────────────────────→ CANCELADO ✓ (terminal)
    │
    ↓
LISTO ──────────────────────────────────────────────→ NO_RETIRADO ✓ (terminal)
    │
    ↓
ENTREGADO ✓ (terminal)
```

### Tabla de acciones disponibles por estado (de la documentación V3)

| Estado actual | Acciones disponibles para el dueño |
|---|---|
| `PENDIENTE` | Confirmar pedido → `EN_PREPARACION`, Cancelar pedido → `CANCELADO` |
| `EN_PREPARACION` | Completar preparación → `LISTO`, Cancelar pedido → `CANCELADO` |
| `LISTO` | Marcar como Entregado → `ENTREGADO`, Marcar como No Retirado → `NO_RETIRADO` |
| `ENTREGADO` | — (estado terminal) |
| `CANCELADO` | — (estado terminal) |
| `NO_RETIRADO` | — (estado terminal) |

### Integración con SSE

Cuando el estado del pedido cambia, el servicio de orders debe emitir el nuevo estado por SSE a todos los clientes conectados al stream de ese pedido (identificado por `uuid_seguimiento`). Cuando el nuevo estado es terminal, la conexión SSE debe cerrarse automáticamente.

```typescript
// Pseudocódigo de integración en updateStatus()
await this.orderRepo.save(order);
this.sseService.emit(order.uuidSeguimiento, order.estado);
if (TERMINAL_STATES.includes(order.estado)) {
  this.sseService.close(order.uuidSeguimiento);
}
```

### Casos de uso que involucran cambio de estado

- **CU-01** (Registrar pedido): crea el pedido en estado `PENDIENTE`.
- **CU-06** (Cancelar pedido): transición a `CANCELADO` desde `PENDIENTE` o `EN_PREPARACION`, con motivo opcional.
- **CU-08** (Consultar estado): el cliente ve el stepper visual con el estado actual vía SSE.

### Campo `motivoCancelacion` en la entidad `Order`

```typescript
@Column({ name: 'motivo_cancelacion', nullable: true })
motivoCancelacion: string | null;
```

Solo se persiste si `estado === CANCELADO`. Para otros estados siempre es `null`.
