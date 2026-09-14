import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

const DATABASE_URL_PERF = process.env.DATABASE_URL_PERF ?? '';

if (!DATABASE_URL_PERF) {
  console.error('DATABASE_URL_PERF environment variable is required');
  process.exit(1);
}

const dataSource = new DataSource({
  type: 'postgres',
  url: DATABASE_URL_PERF,
  synchronize: true,
  logging: false,
  entities: [
    'C:\\Users\\Usuario\\Desktop\\UTN\\Proyectos\\Sistema de Pedidos Online\\backend_pedidos_online\\backend_pedidos\\src\\**\\*.entity{.ts,.js}',
  ],
});

const ORDER_STATUSES = [
  'PENDIENTE',
  'EN_PREPARACION',
  'LISTO',
  'ENTREGADO',
  'CANCELADO',
  'NO_RETIRADO',
];

const PAYMENT_METHODS = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA_DEBITO'];
const DELIVERY_TYPES = ['RETIRO_LOCAL', 'ENVIO_DOMICILIO'];

async function getOrCreateTenant(): Promise<string> {
  const existing = await dataSource.query(
    `SELECT id FROM tenants WHERE slug = 'perf-test'`
  );

  if (existing.length > 0) {
    console.log('Tenant "perf-test" already exists, cleaning up data...');
    const tenantId = existing[0].id;
    await cleanupTenantData(tenantId);
    return tenantId;
  }

  const tenantId = uuidv4();
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, logo, banner, primary_color, secondary_color, whatsapp, address, delivery_cost_enabled, delivery_cost, description, is_open, cbu, alias, account_holder, bank, created_at, updated_at)
     VALUES ($1, 'perf-test', 'Performance Test Tenant', null, null, null, null, null, null, false, null, null, true, null, null, null, null, NOW(), NOW())`,
    [tenantId]
  );
  console.log(`Created tenant: ${tenantId}`);
  return tenantId;
}

async function cleanupTenantData(tenantId: string): Promise<void> {
  await dataSource.query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE tenant_id = $1)`, [tenantId]);
  await dataSource.query(`DELETE FROM deliveries WHERE id IN (SELECT delivery_id FROM orders WHERE tenant_id = $1 AND delivery_id IS NOT NULL)`, [tenantId]);
  await dataSource.query(`DELETE FROM orders WHERE tenant_id = $1`, [tenantId]);
  await dataSource.query(`DELETE FROM customers WHERE id IN (SELECT customer_id FROM orders WHERE tenant_id = $1)`, [tenantId]);
  await dataSource.query(`DELETE FROM products WHERE tenant_id = $1`, [tenantId]);
  await dataSource.query(`DELETE FROM categories WHERE tenant_id = $1`, [tenantId]);
  console.log(`Cleaned up data for tenant: ${tenantId}`);
}

async function seedCategories(tenantId: string): Promise<string[]> {
  const categoryIds: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const id = uuidv4();
    await dataSource.query(
      `INSERT INTO categories (id, tenant_id, name, is_active, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, true, NOW(), NOW(), null)`,
      [id, tenantId, `Categoría ${i}`]
    );
    categoryIds.push(id);
  }
  console.log(`Created ${categoryIds.length} categories`);
  return categoryIds;
}

async function seedProducts(tenantId: string, categoryIds: string[]): Promise<Array<{ id: string; name: string; price: number }>> {
  const products: Array<{ id: string; name: string; price: number }> = [];
  for (let i = 1; i <= 100; i++) {
    const id = uuidv4();
    const categoryId = categoryIds[(i - 1) % 20];
    const price = 500 + (i * 37);
    await dataSource.query(
      `INSERT INTO products (id, tenant_id, category_id, name, description, price, is_active, image_url, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, null, $5, true, null, NOW(), NOW(), null)`,
      [id, tenantId, categoryId, `Producto ${i}`, price]
    );
    products.push({ id, name: `Producto ${i}`, price });
  }
  console.log(`Created ${products.length} products`);
  return products;
}

async function seedCustomers(count: number): Promise<string[]> {
  const customerIds: string[] = [];
  for (let i = 1; i <= count; i++) {
    const id = uuidv4();
    const phone = `11${String(10000000 + i).padStart(8, '0')}`;
    await dataSource.query(
      `INSERT INTO customers (id, name, phone, address)
       VALUES ($1, $2, $3, null)`,
      [id, `Cliente ${i}`, phone]
    );
    customerIds.push(id);
  }
  console.log(`Created ${customerIds.length} customers`);
  return customerIds;
}

async function seedOrders(
  tenantId: string,
  products: Array<{ id: string; name: string; price: number }>,
  customerIds: string[]
): Promise<void> {
  const now = new Date();
  for (let i = 1; i <= 1000; i++) {
    const orderId = uuidv4();
    const customerId = customerIds[(i - 1) % 1000];
    const status = ORDER_STATUSES[(i - 1) % 6];
    const paymentMethod = PAYMENT_METHODS[(i - 1) % 3];
    const deliveryType = DELIVERY_TYPES[(i - 1) % 2];
    const daysAgo = (i - 1) % 60;
    const createdAt = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const trackingUuid = uuidv4();
    const cancellationReason = status === 'CANCELADO' ? `Cancellation reason for order ${i}` : null;

    const itemCount = 1 + ((i - 1) % 5);
    let total = 0;
    const orderItems: Array<{ productId: string; name: string; price: number; quantity: number }> = [];

    for (let j = 0; j < itemCount; j++) {
      const productIndex = (i - 1 + j) % 100;
      const product = products[productIndex];
      const quantity = 1 + ((i + j - 1) % 5);
      total += product.price * quantity;
      orderItems.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity,
      });
    }

    await dataSource.query(
      `INSERT INTO orders (id, tenant_id, status, tracking_uuid, cancellation_reason, total, "paymentMethod", delivery_type, customer_id, delivery_id, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, null, null, $10, $10)`,
      [orderId, tenantId, status, trackingUuid, cancellationReason, total, paymentMethod, deliveryType, customerId, createdAt]
    );

    for (const item of orderItems) {
      await dataSource.query(
        `INSERT INTO order_items (id, order_id, product_id, name, price, quantity)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uuidv4(), orderId, item.productId, item.name, item.price, item.quantity]
      );
    }

    if (i % 100 === 0) {
      console.log(`Created ${i} orders...`);
    }
  }
  console.log(`Created 1000 orders with items`);
}

async function main(): Promise<void> {
  const startTime = Date.now();
  console.log('Starting performance test seed...');
  console.log(`Connecting to: ${DATABASE_URL_PERF.replace(/:[^:@]+@/, ':****@')}`);

  try {
    await dataSource.initialize();
    console.log('Database connection established');

    const tenantId = await getOrCreateTenant();
    const categoryIds = await seedCategories(tenantId);
    const products = await seedProducts(tenantId, categoryIds);
    const customerIds = await seedCustomers(1000);
    await seedOrders(tenantId, products, customerIds);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✅ Seed completed successfully in ${duration}s`);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

main();