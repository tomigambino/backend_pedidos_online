-- ============================================================================
-- SEED: Datos de prueba para desarrollo
-- Base de datos: PostgreSQL
-- Uso: psql -U postgres -d pedidos_online -f database/seed.sql
--
-- Contraseña en texto plano del usuario de prueba: test1234
-- Para loguearse: email = test@donpepe.com, password = test1234
-- ============================================================================

BEGIN;

-- ============================================================================
-- LIMPIEZA PREVIA (idempotencia)
-- Busca el tenant por slug 'don-pepe' o por el UUID predecible,
-- y elimina todos sus datos en orden inverso de dependencias.
-- ============================================================================

DO $$
DECLARE
    v_tenant_id UUID;
BEGIN
    SELECT id INTO v_tenant_id FROM tenants
    WHERE id = 'd1a2b3c4-0001-4000-8000-000000000001' OR slug = 'don-pepe'
    LIMIT 1;

    IF v_tenant_id IS NOT NULL THEN
        DELETE FROM order_items       WHERE order_id IN (SELECT id FROM orders WHERE tenant_id = v_tenant_id);
        DELETE FROM orders            WHERE tenant_id = v_tenant_id;
        DELETE FROM products          WHERE tenant_id = v_tenant_id;
        DELETE FROM categories        WHERE tenant_id = v_tenant_id;
        DELETE FROM regular_schedules WHERE tenant_id = v_tenant_id;
        DELETE FROM availability_exceptions WHERE tenant_id = v_tenant_id;
        DELETE FROM users             WHERE tenant_id = v_tenant_id;
        DELETE FROM tenants           WHERE id = v_tenant_id;
    END IF;
END $$;

-- ============================================================================
-- 1. TENANT
-- ============================================================================

INSERT INTO tenants (
    id,
    slug,
    name,
    primary_color,
    secondary_color,
    is_open,
    delivery_cost_enabled,
    delivery_cost,
    logo,
    banner,
    whatsapp,
    address,
    description,
    cbu,
    alias,
    account_holder,
    bank,
    created_at,
    updated_at
) VALUES (
    'd1a2b3c4-0001-4000-8000-000000000001',
    'don-pepe',
    'Don Pepe',
    '#EA580C',
    '#1E293B',
    TRUE,
    TRUE,
    500.00,
    NULL,
    NULL,
    NULL,
    'Av. Corrientes 1234, CABA',
    'Las mejores hamburguesas de la zona',
    NULL,
    NULL,
    NULL,
    NULL,
    NOW(),
    NOW()
);

-- ============================================================================
-- 2. USER (OWNER)
-- Password hasheado con bcrypt (salt rounds = 10)
-- Texto plano: test1234
-- Hash generado con: bcrypt.hash('test1234', 10)
-- ============================================================================

INSERT INTO users (
    id,
    tenant_id,
    email,
    password,
    role,
    created_at,
    updated_at
) VALUES (
    'd1a2b3c4-0002-4000-8000-000000000001',
    'd1a2b3c4-0001-4000-8000-000000000001',
    'test@donpepe.com',
    '$2b$10$VGQ7XrXGLNxyjXVBjxOPh.tp7LLVTV4sOo3.TfSyOC2FV4miT5w0C',
    'OWNER',
    NOW(),
    NOW()
);

-- ============================================================================
-- 3. CATEGORÍAS
-- ============================================================================

INSERT INTO categories (id, tenant_id, name, created_at, updated_at) VALUES
    ('d1a2b3c4-0003-4000-8000-000000000001', 'd1a2b3c4-0001-4000-8000-000000000001', 'Hamburguesas', NOW(), NOW()),
    ('d1a2b3c4-0003-4000-8000-000000000002', 'd1a2b3c4-0001-4000-8000-000000000001', 'Bebidas',      NOW(), NOW()),
    ('d1a2b3c4-0003-4000-8000-000000000003', 'd1a2b3c4-0001-4000-8000-000000000001', 'Postres',      NOW(), NOW());

-- ============================================================================
-- 4. PRODUCTOS (6)
-- isActive: true para los primeros 5, false para el flan (prueba de filtro)
-- ============================================================================

INSERT INTO products (id, tenant_id, category_id, name, description, price, is_active, image_url, created_at, updated_at) VALUES
    (
        'd1a2b3c4-0004-4000-8000-000000000001',
        'd1a2b3c4-0001-4000-8000-000000000001',
        'd1a2b3c4-0003-4000-8000-000000000001',
        'Hamburguesa Clásica',
        'Carne vacuna, lechuga, tomate, cebolla y salsa especial',
        1500.00,
        TRUE,
        NULL,
        NOW(),
        NOW()
    ),
    (
        'd1a2b3c4-0004-4000-8000-000000000002',
        'd1a2b3c4-0001-4000-8000-000000000001',
        'd1a2b3c4-0003-4000-8000-000000000001',
        'Hamburguesa con Queso',
        'Carne vacuna, cheddar, lechuga, tomate y salsa barbacoa',
        1800.00,
        TRUE,
        NULL,
        NOW(),
        NOW()
    ),
    (
        'd1a2b3c4-0004-4000-8000-000000000003',
        'd1a2b3c4-0001-4000-8000-000000000001',
        'd1a2b3c4-0003-4000-8000-000000000002',
        'Coca-Cola 500ml',
        'Gaseosa sabor cola',
        1500.00,
        TRUE,
        NULL,
        NOW(),
        NOW()
    ),
    (
        'd1a2b3c4-0004-4000-8000-000000000004',
        'd1a2b3c4-0001-4000-8000-000000000001',
        'd1a2b3c4-0003-4000-8000-000000000002',
        'Agua Mineral 500ml',
        'Agua sin gas',
        800.00,
        TRUE,
        NULL,
        NOW(),
        NOW()
    ),
    (
        'd1a2b3c4-0004-4000-8000-000000000005',
        'd1a2b3c4-0001-4000-8000-000000000001',
        'd1a2b3c4-0003-4000-8000-000000000003',
        'Tiramisú',
        'Clásico postre italiano con mascarpone y café',
        2000.00,
        TRUE,
        NULL,
        NOW(),
        NOW()
    ),
    (
        'd1a2b3c4-0004-4000-8000-000000000006',
        'd1a2b3c4-0001-4000-8000-000000000001',
        'd1a2b3c4-0003-4000-8000-000000000003',
        'Flan Casero',
        'Flan con dulce de leche y crema',
        1200.00,
        FALSE,  -- inactivo para probar filtro isActive
        NULL,
        NOW(),
        NOW()
    );

-- ============================================================================
-- 5. HORARIOS REGULARES (lunes a sábado)
-- dayOfWeek: 1 = lunes, 6 = sábado. Cerrado los domingos.
-- ============================================================================

INSERT INTO regular_schedules (id, tenant_id, day_of_week, opening_time, closing_time) VALUES
    (gen_random_uuid(), 'd1a2b3c4-0001-4000-8000-000000000001', 1, '09:00', '22:00'),
    (gen_random_uuid(), 'd1a2b3c4-0001-4000-8000-000000000001', 2, '09:00', '22:00'),
    (gen_random_uuid(), 'd1a2b3c4-0001-4000-8000-000000000001', 3, '09:00', '22:00'),
    (gen_random_uuid(), 'd1a2b3c4-0001-4000-8000-000000000001', 4, '09:00', '22:00'),
    (gen_random_uuid(), 'd1a2b3c4-0001-4000-8000-000000000001', 5, '09:00', '22:00'),
    (gen_random_uuid(), 'd1a2b3c4-0001-4000-8000-000000000001', 6, '09:00', '22:00');

COMMIT;
