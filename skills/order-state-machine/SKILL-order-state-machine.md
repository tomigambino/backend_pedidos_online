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
    private readonly sseService: OrdersSseService,
    private readonly dataSource: DataSource,
  ) {}

  async updateStatus(
    id: string,
    tenantId: string,
    newStatus: OrderStatus,
    cancellationReason?: string,
  ): Promise<OrderResponseDto> {
    const order = await this.dataSource.transaction(async (manager) => {
      // pessimistic_write evita dos cambios de estado concurrentes sobre el mismo pedido
      const locked = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write', undefined, ['o'])
        .where('o.id = :id AND o.tenantId = :tenantId', { id, tenantId })
        .getOne();

      if (!locked) throw new NotFoundException('Pedido no encontrado');

      // Validar transición contra el mapa
      const allowed = VALID_TRANSITIONS[locked.status];
      if (!allowed.includes(newStatus)) {
        throw new BadRequestException(
          `Transición inválida: ${locked.status} → ${newStatus}`,
        );
      }

      locked.status = newStatus;
      // cancellationReason se persiste SOLO si newStatus === CANCELADO
      locked.cancellationReason =
        newStatus === OrderStatus.CANCELADO ? (cancellationReason ?? null) : null;

      return manager.save(locked);
    });

    // Notificar SSE recién después del commit
    this.sseService.emit(order.trackingUuid, order.status);
    if (TERMINAL_STATES.includes(order.status)) {
      this.sseService.close(order.trackingUuid);
    }

    return this.toResponse(order);
  }
}
```

- `cancellationReason` se persiste **únicamente** cuando `newStatus === OrderStatus.CANCELADO` (y puede venir `undefined`, en cuyo caso queda `null`). En cualquier otro estado se fuerza a `null`.
- Mensaje de error real: `` `Transición inválida: ${locked.status} → ${newStatus}` `` (`BadRequestException`).
- Pedido inexistente o de otro tenant: `NotFoundException('Pedido no encontrado')` — el `where` incluye siempre `tenantId`.

---

## 4. DTO para cambio de estado

```typescript
// src/modules/orders/dto/update-order-status.dto.ts
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrderStatus } from '../../../common/enums/order-status.enum';

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status: OrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  cancellationReason?: string;
}
```

---

## 5. Endpoint en el controlador

El controlador está montado sobre `@Controller(':tenant/orders')`, así que la ruta completa es `PATCH /:tenant/orders/:id/status`. Es una **ruta protegida**: solo el dueño (admin) puede cambiar estados, y el `tenantId` sale **solo** del JWT vía `@TenantId()` (nunca del slug de la URL ni del body).

```typescript
// Solo el dueño (admin) puede cambiar estados
@Patch(':id/status')
@UseGuards(JwtAuthGuard)
updateStatus(
  @Param('id', ParseUUIDPipe) id: string,
  @TenantId() tenantId: string,
  @Body() dto: UpdateOrderStatusDto,
) {
  return this.ordersService.updateStatus(
    id,
    tenantId,
    dto.status,
    dto.cancellationReason,
  );
}
```

---

## 6. Checklist antes de hacer commit

- [ ] ¿El mapa `VALID_TRANSITIONS` cubre los 6 estados y los 3 terminales tienen array vacío?
- [ ] ¿El servicio lanza excepción si la transición no está en el mapa?
- [ ] ¿`cancellationReason` solo se persiste cuando `newStatus === CANCELADO` (y queda `null` en cualquier otro caso)?
- [ ] ¿El DTO valida con `@IsEnum(OrderStatus)` y no acepta strings libres?
- [ ] ¿La ruta `PATCH :id/status` tiene `@UseGuards(JwtAuthGuard)` y el `tenantId` sale del JWT?
- [ ] ¿El SSE emite por `trackingUuid` (no por `id` ni por `order_id`)?
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

Los métodos de dominio son los del diagrama de clases (`/documentation/diagrams.md`). **No existen endpoints separados por acción**: un único `PATCH :id/status` los cubre a todos, validando el `status` recibido contra `VALID_TRANSITIONS`.

| Método de dominio | Estado actual | Estado destino | Endpoint |
|---|---|---|---|
| `confirmOrder()` | `PENDIENTE` | `EN_PREPARACION` | `PATCH :id/status` con `{ "status": "EN_PREPARACION" }` |
| `cancelOrder()` | `PENDIENTE` \| `EN_PREPARACION` | `CANCELADO` | `PATCH :id/status` con `{ "status": "CANCELADO", "cancellationReason": "..." }` |
| `readyOrder()` | `EN_PREPARACION` | `LISTO` | `PATCH :id/status` con `{ "status": "LISTO" }` |
| `deliverOrder()` | `LISTO` | `ENTREGADO` | `PATCH :id/status` con `{ "status": "ENTREGADO" }` |
| `markAsNotPickedUp()` | `LISTO` | `NO_RETIRADO` | `PATCH :id/status` con `{ "status": "NO_RETIRADO" }` |

Si el `status` enviado no está en `VALID_TRANSITIONS[order.status]`, el servicio responde `400 Bad Request` con `Transición inválida: <actual> → <solicitado>`.

### Integración con SSE

Cuando el `status` del pedido cambia, `updateStatus()` emite el nuevo `status` por SSE a todos los clientes conectados al stream de ese pedido (identificado por `trackingUuid`). Cuando el nuevo `status` es terminal, la conexión SSE se cierra automáticamente.

```typescript
// Pseudocódigo de integración en updateStatus() — luego del commit de la transacción
this.sseService.emit(order.trackingUuid, order.status);
if (TERMINAL_STATES.includes(order.status)) {
  this.sseService.close(order.trackingUuid);
}
```

Del lado del consumidor, la ruta es **pública**: `GET /:tenant/orders/:uuid/status-stream` (sin `JwtAuthGuard`, busca por `trackingUuid`). Emite el estado actual al suscribirse y luego cada cambio:

```typescript
@Sse(':uuid/status-stream')
statusStream(
  @Param('uuid', ParseUUIDPipe) uuid: string,
  @TenantId() tenantId: string,
): Observable<MessageEvent> {
  this.sseService.connect(uuid);

  // defer para que la consulta ocurra en el momento de suscripción
  const initial$ = defer(async () => {
    const order = await this.ordersService.findByTracking(uuid, tenantId);
    return order.status;
  });

  const updates$ = this.sseService.getOrCreate(uuid).asObservable();

  return concat(initial$, updates$).pipe(
    map((status) => ({ data: status })),
    // takeWhile(..., true): el estado terminal se emite y después el stream completa
    takeWhile(
      (event) => !TERMINAL_STATES.includes(event.data as OrderStatus),
      true,
    ),
    finalize(() => this.sseService.disconnect(uuid)),
  );
}
```

### Casos de uso que involucran cambio de estado

- **CU-01** (Registrar pedido): crea el pedido en estado `PENDIENTE`.
- **CU-06** (Cancelar pedido): transición a `CANCELADO` desde `PENDIENTE` o `EN_PREPARACION`, con motivo opcional.
- **CU-08** (Consultar estado): el cliente ve el stepper visual con el estado actual vía SSE.

### Campo `cancellationReason` en la entidad `Order`

```typescript
@Column({ name: 'cancellation_reason', type: 'varchar', nullable: true })
cancellationReason: string | null;
```

Solo se persiste si `status === CANCELADO`. Para otros estados siempre es `null`.
