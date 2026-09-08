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