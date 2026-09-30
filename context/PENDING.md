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

### TODO/FIXME encontrados en el código
- Ningún comentario `// TODO` o `// FIXME` hallado en backend (src/) ni frontend (app/, components/, lib/, hooks/).