# PENDING.md

## Seguridad / infraestructura
- [ ] **[Alta] BLOQUEANTE DE DESPLIEGUE** — Configurar nginx en prod con
      `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` (necesario para que
      `trust proxy: 1` funcione correctamente). Sin este header, `req.ip` es la IP del proxy:
      con el `@Throttle` de 10/min en `POST /:tenant/orders` (cuenta por IP) **todas las requests
      de todos los usuarios comparten un único contador**, y un local con tráfico bloquearía a sus
      propios clientes. No desplegar hasta cerrarlo.
- [ ] Revisar `trust proxy` si se agrega CDN/LB delante de nginx (pasaría a 2+ hops)
- [ ] `synchronize: true` → pasar a migraciones antes de deploy
- [ ] [Baja] products.controller.ts:55,66; tenants.controller.ts:35-40 — El `fileFilter` de las
      subidas valida el MIME declarado por el cliente (`Content-Type`), que es falseable: un archivo
      no-imagen con `Content-Type: image/png` pasa el filtro (Cloudinary lo rechaza o transforma
      después, pero el buffer ya llegó al servidor). Validación real requiere inspección por magic
      bytes (p. ej. paquete `file-type`), decisión descartada para el MVP por no agregar dependencias.

## Code quality (deferred)
- [ ] Extraer `buildDateRange()` helper en `orders.service.ts`
- [ ] Mover `APP_URL` hardcodeado de `getWhatsAppLink()` a env var
- [ ] Separar `getStats()`/`getWhatsAppLink()` a servicio propio si crece el archivo
- [ ] `@Exclude()` en `password` de User depende de `ClassSerializerInterceptor` — no está registrado global. Hoy no se filtra nada pero es frágil.
- [ ] Cloudinary `deleteImage` fire-and-forget puede dejar imágenes huérfanas (bajo impacto)
- [ ] Índices faltantes: `Order.status`, `Order.createdAt`, `Product.categoryId`
- [ ] Ruta `/menu` muerta en TenantMiddleware (no tiene controller, 404 garantizado)
- [ ] Lookup de slug redundante en rutas `/admin/*` (JWT ya trae tenantId)
- [ ] [Baja] Frontend: 7 renders con `next/image` usan un ternario por truthiness sobre URLs de la API, sin validar. El backend ya sanea `imageUrl`, `logo` y `banner` (commit `509400f`), así que el riesgo residual es bajo: queda sobre todo **carritos viejos guardados en `localStorage`** (que no pasan por el backend al renderizar) y **hosts distintos de Cloudinary**. Mitigación: helper `isValidImageUrl` en `frontend_pedidos/lib/utils/image.ts` (solo http/https, sin restringir host) con fallback al placeholder existente. Sitios: `app/(public)/[tenant]/carrito/CarritoContent.tsx:132`, `app/(public)/[tenant]/checkout/CheckoutContent.tsx:382`, `app/(public)/[tenant]/page.tsx:36,52`, `app/(public)/[tenant]/info/InfoNegocioContent.tsx:45`, `app/(admin)/admin/(protected)/menu/menu-manager.tsx:418`, `app/(admin)/admin/(protected)/configuracion/config-manager.tsx:608,642`, `components/admin/ProductFormModal.tsx:164`. Nota: `next.config.ts` solo permite `https://res.cloudinary.com`, así que cualquier otro host falla igual en `next/image`, con o sin URL válida.
- [ ] [Baja] Backend (`backend_pedidos/package.json`): separar el script `lint` en `lint` (solo lectura, `eslint` sin `--fix`) y `lint:fix` (`eslint --fix`). Hoy `npm run lint` **reescribe archivos fuera del alcance de la tarea**: al correrlo se reformatearon `orders.service.ts`, `orders.controller.ts`, `orders-sse.service.ts` y `app.module.ts` sin que fueran parte del trabajo.
- [ ] [Baja] Backend (`eslint.config.mjs`): `projectService` solo encuentra el `tsconfig.json`, cuyo `include` es `["src/**/*"]`, así que **ningún archivo bajo `test/` se puede parsear** (`Parsing error: was not found by the project service`). Afecta a la spec boilerplate `test/app.e2e-spec.ts` y a las nuevas de e2e. Solución: un `tsconfig.eslint.json` con `include: ["src/**/*", "test/**/*"]` y `parserOptions.project: ['./tsconfig.eslint.json']` en vez de `projectService`, sin tocar el `include` del tsconfig de build.
- [ ] [Baja] Agregar `.gitattributes` (`* text=auto eol=lf`) para normalizar fin de línea. El repo no tiene `.gitattributes` y en Windows git reporta "LF will be replaced by CRLF"; ya manusearon archivos que figuraban modificados sin diferencia de contenido (solo EOL), lo que hace ruido en `git status` y riesgo de conflictos. La normalización requiere `git add --renormalize .` y **va en un commit aparte**, sin mezclarlo con cambios funcionales.

## Auditoría backend — en curso
- [x] Menú público con soft-deleted (Iteración 1)
- [x] TOCTOU en updateStatus (Iteración 2)
- [x] Rate limiting real (Iteración 3)
- [x] trust proxy (Iteración 4)
- [ ] Leak de Subjects en SSE (Iteración 5) — en definición

## Hallazgos de auditoría de documentación (2026-09)
- [ ] [Alta] orders.service.ts:106-116 — El total del pedido en backend no incluye deliveryFee, pero el checkout del front muestra subtotal + envío: el cliente ve un total y el sistema guarda otro. Decidir qué es "total" y alinear front y back.
- [x] [Alta] products.service.ts:155-166 — **Resuelto**: `ProductsService.findOneForOrder()` ahora Inner JOINea a `category` con `isActive = true AND deletedAt IS NULL`, la misma regla que el catálogo público (`findAll()`). Un pedido de un producto con categoría oculta o borrada devuelve 400. QA verificada: los tres casos (categoría oculta, categoría borrada, producto de otro tenant) dan 400.
- [x] [Alta] orders.controller.ts:35, app.module.ts:29-35 — **Resuelto**: `POST /:tenant/orders`
      ahora tiene `@Throttle({ default: { limit: 10, ttl: 60000 } })` (`ttl` en ms) y cuenta por
      `req.ip`; el límite global de 100k/min se mantiene intencional. QA verificada: 10×201 y el
      11º en 429, con `Retry-After` en el 429 y `X-RateLimit-*` en el 201. Queda pendiente el
      bloqueante de X-Forwarded-For de arriba, sin el cual el contador es compartido por proxy.
- [x] [Media] auth.controller.ts:19 — **Resuelto**: `AuthController` tenía `@UseGuards(ThrottlerGuard)`
      además del `ThrottlerGuard` global de `app.module.ts`, así que cada request de esas rutas
      se contaba **dos veces** contra el mismo key y el límite efectivo era la mitad
      (`POST /auth/register` cortaba en el 3º request en vez del 6º; `login` en el 6º en vez del 11º).
      Se quitó el `@UseGuards` de clase: el guard global ya cubre. QA verificada con
      `backend_pedidos/test/scratch/qa-orders-throttle.ts`.
- [x] [Alta] products.controller.ts:55,66; tenants.controller.ts:35-40 — **Resuelto**: multipart con
      `limits.fileSize` y `fileFilter` en productos y tenant. `src/common/utils/upload-limits.util.ts`
      expone `imageUploadLimits(maxFiles)` (5 MB por archivo → `413`) e `imageFileFilter()` (solo
      `image/jpeg`, `image/png`, `image/webp` → `400` con el tipo recibido en el mensaje), aplicados en
      `products.controller.ts` (`FileInterceptor('image')`, `files: 1`) y `tenants.controller.ts`
      (`FileFieldsInterceptor`, `files: 2` para logo + banner). El filtro corre en multer, antes del
      service: un archivo rechazado no llega a Cloudinary. El límite es 5 MB exactos (busboy corta en
      `fileSize === limit`, por eso el `+1` en el helper). QA: `test/scratch/qa-upload-limits.ts` y
      `test/scratch/qa-tenant-upload-limits.ts`. Queda el residuo [Baja] de MIME falseable de arriba.
- [ ] [Media] tenant.middleware.ts:14-24 — No se valida que el slug de la URL coincida con el tenantId del JWT en rutas protegidas (no hay fuga porque manda el JWT, pero falta 403 como defensa en profundidad). Enlazar con ítem existente "Lookup de slug redundante en rutas /admin/*" sin duplicarlo. El comportamiento actual quedó congelado en `backend_pedidos/test/tenant-isolation.e2e-spec.ts` (casos "cookie de A contra slug de B devuelve los datos de A" y "cookie de A contra slug de B escribe en A"), así que un cambio a 403 se ve al instante en la suite.
- [ ] [Media] auth/strategies/jwt.strategy.ts:25-27 — `validate()` devuelve `{userId, tenantId}` del token sin consultar la base: no verifica que el usuario exista ni que le corresponda ese tenant. La cookie `access_token` dura 7 días (`auth.controller.ts:33`), así que un token sigue operando sobre el tenant completo aunque el dueño haya borrado su usuario, y el `userId` del claim no se usa para autorizar nada. Cubierto por `test.todo` en `backend_pedidos/test/tenant-isolation.e2e-spec.ts`.
- [x] [Media] categories.service.ts:62 — **Resuelto**: `CategoriesService.runFindAll()` pasa el mismo filtro al count (`{ tenantId, ...(onlyActive && { isActive: true }) }`), así que en el listado público `total` y `totalPages` coinciden con las filas listadas. La rama admin queda igual (ya excluía los borrados por `@DeleteDateColumn`).
- [ ] [Baja] categories.service.ts:68-75 — El `map` sobre `getRawMany()` (tipado `any[]`) genera 7 errores preexistentes de ESLint (`@typescript-eslint/no-unsafe-assignment` / `no-unsafe-member-access`); confirmados idénticos en HEAD, no los introduce el fix de visibilidad. Solución propuesta: declarar una interfaz `CategoryRawRow { id: string; name: string; is_active: boolean; product_count: string }` y tipar la query con `getRawMany<CategoryRawRow>()` para eliminar el `any`.
- [ ] [Baja] app.module.ts:63-81 — GET /:tenant/orders/:id, PATCH /:tenant/orders/:id/status y GET /:tenant/orders/:id/whatsapp-link no pasan por el TenantMiddleware (no es fuga, solo registrarlo).
- [ ] [Baja] categories.service.ts:102-114,116-123 — PATCH categories/:id/activate y /hide devuelven productCount siempre 0; GET/POST/PATCH categories/:id devuelven la entidad cruda sin productCount.
- [ ] [Baja] categories.controller.ts:68-70; products.controller.ts:78-80; tenants.controller.ts — Los DELETE devuelven 200 con cuerpo vacío en vez de 204 (decidir si se agrega @HttpCode(204) o se deja).
- [ ] [Baja] categories.service.ts, products.service.ts — Restore/recover de Category y Product no implementado en el MVP.
- [X] [Media] lib/context/CartContext.tsx:21 — Frontend: CartContext usa la clave única 'cart' en localStorage, compartida entre tenants; al navegar a otro negocio en el mismo navegador se mezclan carritos.
- [ ] [Alta] main.ts:15-19 — CORS cae a `origin: '*'` (línea 16) combinado con `credentials: true` (línea 17) si falta `CORS_ORIGIN`; con la cookie HttpOnly `access_token` el login del panel deja de funcionar o queda inseguro. No hay validación en el arranque (el directorio `src/config/` está vacío: no existe `env.config.ts`). Arreglo propuesto: validar `CORS_ORIGIN` al bootear en `main.ts` y fallar el arranque en producción si no está definida.
- [ ] [Media] orders.service.ts:61-71 — `create()` carga el tenant (línea 61), valida que exista (62) y descarta tarjeta de débito + envío a domicilio (64-71), pero **no valida `tenant.isOpen`**: `POST /:tenant/orders` acepta pedidos con el local cerrado. Peor: tampoco hay bloqueo en el frontend (el `isOpen` del front solo se usa para mostrar `StatusBadge` en `app/(public)/[tenant]/page.tsx:84` y en el toggle admin), así que el bloqueo no existe en ninguna de las dos capas. Agregar validación server-side en `create()`.
- [ ] [Media] tenant.entity.ts:52-54 — `is_open` es un BOOLEAN con default `true` controlado manualmente (toggle en `StoreStatusToggle.tsx:22` y `config-manager.tsx:285`); los horarios de `regular_schedules` y las excepciones de `availability_exceptions` no abren ni cierran el local automáticamente (no hay ningún `@Cron`/`Scheduler` en el backend). Decidir: calcular "abierto ahora" desde horarios/excepciones o dejarlo manual y aclararlo en la UI.
- [ ] [Media] documentation_sistema_pedidos_online_V3.md:613-673 — Frontend: CU-07 (botón "Recibir actualizaciones por WhatsApp") y el banner de pedido en curso con `localStorage` `pedido_activo_{tenantSlug}` están documentados pero **no implementados** (no hay referencias a esas claves ni UI que llame a `PATCH /:tenant/orders/:uuid/customer/phone`). Como el teléfono pasó a ser obligatorio en el checkout, decidir si se elimina CU-07 de la documentación y se deja solo el banner como mejora opcional.
- [ ] [Baja] frontend_pedidos/app/registro/page.tsx:1-3 — Stub de 3 líneas (`return <div>Registro de negocio</div>`) duplicado de `app/register/page.tsx:1-5`, que sí renderiza `RegisterForm`. Borrar `app/registro/` o redirigir a `/register`.
- [ ] [Baja] Documentacion-Sistema-De-Pedidos-Online.md:1-3 — Copia general obsoleta en la raíz del monorepo (fuera del repo backend): 757 líneas, sin header de versión y con dos H1 duplicados; contiene el contenido previo al v3.5 (nombres de campo en español, `dia_semana`, `DIAGRAMS.md`). Marcarla como OBSOLETA en su encabezado o borrarla; la vigente es `backend_pedidos_online/documentation/documentation_sistema_pedidos_online_V3.md` v3.5.
- [ ] [Baja] Frontend: En la vista de detalle del pedido del panel admin y/o flujo público falta mostrar la nota o instrucciones de entrega a domicilio especificadas por el cliente.
- [ ] [Media] Frontend: Normalizar el diseño y layout de las cards (productos/pedidos) para garantizar uniformidad visual y evitar variaciones de altura o desalineaciones según el contenido o la cantidad de información de cada una.
- [ ] [Baja] Evaluar e implementar una vista de tabla alternativa para el listado de pedidos en el panel admin, permitiendo al dueño alternar mediante un toggle entre vista de cards y vista de tabla según su preferencia de gestión.

### TODO/FIXME encontrados en el código
- Ningún comentario `// TODO` o `// FIXME` hallado en backend (src/) ni frontend (app/, components/, lib/, hooks/).