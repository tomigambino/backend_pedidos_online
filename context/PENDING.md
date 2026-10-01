# PENDING.md

## Seguridad / infraestructura
- [ ] Configurar nginx en prod con `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`
      (necesario para que `trust proxy: 1` funcione correctamente)
- [ ] Revisar `trust proxy` si se agrega CDN/LB delante de nginx (pasaría a 2+ hops)
- [ ] `synchronize: true` → pasar a migraciones antes de deploy

## Code quality (deferred)
- [ ] Extraer `buildDateRange()` helper en `orders.service.ts`
- [ ] Mover `APP_URL` hardcodeado de `getWhatsAppLink()` a env var
- [ ] Separar `getStats()`/`getWhatsAppLink()` a servicio propio si crece el archivo
- [ ] `@Exclude()` en `password` de User depende de `ClassSerializerInterceptor` — no está registrado global. Hoy no se filtra nada pero es frágil.
- [ ] Cloudinary `deleteImage` fire-and-forget puede dejar imágenes huérfanas (bajo impacto)
- [ ] Índices faltantes: `Order.status`, `Order.createdAt`, `Product.categoryId`
- [ ] Ruta `/menu` muerta en TenantMiddleware (no tiene controller, 404 garantizado)
- [ ] Lookup de slug redundante en rutas `/admin/*` (JWT ya trae tenantId)

## Auditoría backend — en curso
- [x] Menú público con soft-deleted (Iteración 1)
- [x] TOCTOU en updateStatus (Iteración 2)
- [x] Rate limiting real (Iteración 3)
- [x] trust proxy (Iteración 4)
- [ ] Leak de Subjects en SSE (Iteración 5) — en definición

## Hallazgos de auditoría de documentación (2026-09)
- [ ] [Alta] orders.service.ts:106-116 — El total del pedido en backend no incluye deliveryFee, pero el checkout del front muestra subtotal + envío: el cliente ve un total y el sistema guarda otro. Decidir qué es "total" y alinear front y back.
- [ ] [Alta] products.service.ts:154-160 — ProductsService.findOneForOrder() no valida que la categoría del producto esté visible (oculta o borrada): se puede pedir por POST /:tenant/orders con un productId conocido algo que no está en el menú público.
- [ ] [Alta] orders.controller.ts:35, app.module.ts:29-35 — POST /:tenant/orders sin @Throttle (comentado) y rate limit global muy alto (100k/min). El límite global alto es intencional (iteración 3), pero POST orders carece de límite específico; evaluar agregar @Throttle dedicado.
- [ ] [Alta] products.controller.ts:55,66; tenants.controller.ts:35-40 — Multipart sin limits.fileSize ni fileFilter en productos y tenant: sin restricción de tamaño ni MIME del lado servidor (el límite de 5 MB del front es solo cliente).
- [ ] [Media] tenant.middleware.ts:14-24 — No se valida que el slug de la URL coincida con el tenantId del JWT en rutas protegidas (no hay fuga porque manda el JWT, pero falta 403 como defensa en profundidad). Enlazar con ítem existente "Lookup de slug redundante en rutas /admin/*" sin duplicarlo.
- [ ] [Media] categories.service.ts:62 — CategoriesService.runFindAll(): el total del listado público cuenta categorías ocultas y borradas (count sin filtro is_active/deleted_at), rompiendo la paginación pública.
- [ ] [Baja] app.module.ts:63-81 — GET /:tenant/orders/:id, PATCH /:tenant/orders/:id/status y GET /:tenant/orders/:id/whatsapp-link no pasan por el TenantMiddleware (no es fuga, solo registrarlo).
- [ ] [Baja] categories.service.ts:102-114,116-123 — PATCH categories/:id/activate y /hide devuelven productCount siempre 0; GET/POST/PATCH categories/:id devuelven la entidad cruda sin productCount.
- [ ] [Baja] categories.controller.ts:68-70; products.controller.ts:78-80; tenants.controller.ts — Los DELETE devuelven 200 con cuerpo vacío en vez de 204 (decidir si se agrega @HttpCode(204) o se deja).
- [ ] [Baja] categories.service.ts, products.service.ts — Restore/recover de Category y Product no implementado en el MVP.
- [ ] [Media] lib/context/CartContext.tsx:21 — Frontend: CartContext usa la clave única 'cart' en localStorage, compartida entre tenants; al navegar a otro negocio en el mismo navegador se mezclan carritos.
- [ ] [Alta] main.ts:15-19 — CORS cae a `origin: '*'` (línea 16) combinado con `credentials: true` (línea 17) si falta `CORS_ORIGIN`; con la cookie HttpOnly `access_token` el login del panel deja de funcionar o queda inseguro. No hay validación en el arranque (el directorio `src/config/` está vacío: no existe `env.config.ts`). Arreglo propuesto: validar `CORS_ORIGIN` al bootear en `main.ts` y fallar el arranque en producción si no está definida.
- [ ] [Media] orders.service.ts:61-71 — `create()` carga el tenant (línea 61), valida que exista (62) y descarta tarjeta de débito + envío a domicilio (64-71), pero **no valida `tenant.isOpen`**: `POST /:tenant/orders` acepta pedidos con el local cerrado. Peor: tampoco hay bloqueo en el frontend (el `isOpen` del front solo se usa para mostrar `StatusBadge` en `app/(public)/[tenant]/page.tsx:84` y en el toggle admin), así que el bloqueo no existe en ninguna de las dos capas. Agregar validación server-side en `create()`.
- [ ] [Media] tenant.entity.ts:52-54 — `is_open` es un BOOLEAN con default `true` controlado manualmente (toggle en `StoreStatusToggle.tsx:22` y `config-manager.tsx:285`); los horarios de `regular_schedules` y las excepciones de `availability_exceptions` no abren ni cierran el local automáticamente (no hay ningún `@Cron`/`Scheduler` en el backend). Decidir: calcular "abierto ahora" desde horarios/excepciones o dejarlo manual y aclararlo en la UI.
- [ ] [Media] documentation_sistema_pedidos_online_V3.md:613-673 — Frontend: CU-07 (botón "Recibir actualizaciones por WhatsApp") y el banner de pedido en curso con `localStorage` `pedido_activo_{tenantSlug}` están documentados pero **no implementados** (no hay referencias a esas claves ni UI que llame a `PATCH /:tenant/orders/:uuid/customer/phone`). Como el teléfono pasó a ser obligatorio en el checkout, decidir si se elimina CU-07 de la documentación y se deja solo el banner como mejora opcional.
- [ ] [Baja] frontend_pedidos/app/registro/page.tsx:1-3 — Stub de 3 líneas (`return <div>Registro de negocio</div>`) duplicado de `app/register/page.tsx:1-5`, que sí renderiza `RegisterForm`. Borrar `app/registro/` o redirigir a `/register`.
- [ ] [Baja] Documentacion-Sistema-De-Pedidos-Online.md:1-3 — Copia general obsoleta en la raíz del monorepo (fuera del repo backend): 757 líneas, sin header de versión y con dos H1 duplicados; contiene el contenido previo al v3.5 (nombres de campo en español, `dia_semana`, `DIAGRAMS.md`). Marcarla como OBSOLETA en su encabezado o borrarla; la vigente es `backend_pedidos_online/documentation/documentation_sistema_pedidos_online_V3.md` v3.5.

### TODO/FIXME encontrados en el código
- Ningún comentario `// TODO` o `// FIXME` hallado en backend (src/) ni frontend (app/, components/, lib/, hooks/).