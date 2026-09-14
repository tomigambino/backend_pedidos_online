# Performance Testing Infrastructure

This folder contains the isolated infrastructure for performance testing, completely separate from production code.

## Structure

```
perf-testing/
├── docker-compose.yml    # PostgreSQL 16 container for testing
├── seed.ts              # Deterministic seed script
├── k6/                  # k6 load test scripts (to be added)
└── README.md            # This file
```

## Prerequisites

- Docker & Docker Compose
- Node.js with project dependencies installed (`npm install` from backend root)

## Quick Start

### 1. Start the PostgreSQL test database

```bash
cd perf-testing
docker-compose up -d
```

This starts PostgreSQL 16 on **port 5433** (to avoid conflicts with development DB on 5432):
- Database: `pedilo_perf_test`
- User: `perf_user`
- Password: `perf_pass`
- Data persists in named volume `perf_test_pgdata`

### 2. Run the deterministic seed

```bash
# From the backend root (backend_pedidos/)
DATABASE_URL_PERF="postgresql://perf_user:perf_pass@localhost:5433/pedilo_perf_test" npm run seed:perf
```

This creates:
- 1 tenant: `perf-test`
- 20 categories: "Categoría 1"..."Categoría 20"
- 100 products: "Producto 1"..."Producto 100" (5 per category, deterministic prices)
- 1000 customers: "Cliente 1"..."Cliente 1000" (deterministic phones)
- 1000 orders distributed over last 60 days with 1-5 items each, deterministic statuses

The seed is **idempotent** - running it again cleans up existing `perf-test` tenant data and re-inserts fresh data.

### 3. Verify the data

```bash
# Connect to the test DB
docker exec -it pedilo-perf-test-db psql -U perf_user -d pedilo_perf_test

# Example queries
SELECT COUNT(*) FROM tenants WHERE slug = 'perf-test';
SELECT COUNT(*) FROM categories WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'perf-test');
SELECT COUNT(*) FROM products WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'perf-test');
SELECT COUNT(*) FROM orders WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'perf-test');
SELECT COUNT(*) FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'perf-test'));
SELECT COUNT(*) FROM customers WHERE id IN (SELECT customer_id FROM orders WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'perf-test'));
```

### 4. Tear down completely (clean slate)

```bash
cd perf-testing
docker-compose down -v
```

The `-v` flag removes the named volume, wiping all data.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL_PERF` | Connection string for seed script | Required |

## Expected Seed Duration

Typical run: **~44 seconds** for full 1000 orders + items + customers on local hardware.

## Next Steps

Add k6 load test scripts in `perf-testing/k6/` to run performance benchmarks against the seeded data.