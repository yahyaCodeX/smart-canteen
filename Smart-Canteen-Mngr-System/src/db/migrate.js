// src/db/migrate.js
// Creates all tables in the correct dependency order.
// Run: npm run db:push

import pool from './pool.js';

const SQL = `
-- ─────────────────────────────────────────────────────────────
-- ENUM TYPES (safe to run multiple times)
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('CUSTOMER', 'STAFF', 'MANAGER', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE account_status AS ENUM ('ACTIVE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM (
    'PLACED', 'ACCEPTED', 'PREPARING', 'READY',
    'COLLECTED', 'COMPLETED', 'CANCELLED', 'REJECTED',
    'DELAYED', 'NOT_COLLECTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('PAID', 'PENDING', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE item_status AS ENUM (
    'AVAILABLE', 'LIMITED', 'SOLD_OUT', 'TEMPORARILY_UNAVAILABLE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE slot_status AS ENUM ('AVAILABLE', 'FULL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────
-- TABLE: users
-- PDF Section 8 — User Data
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255)   NOT NULL,
  email         VARCHAR(255)   UNIQUE NOT NULL,
  password_hash VARCHAR(255)   NOT NULL,
  role          user_role      NOT NULL DEFAULT 'CUSTOMER',
  account_status account_status NOT NULL DEFAULT 'ACTIVE',
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- TABLE: menu_items
-- PDF Section 8 — Menu Item Data
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_items (
  item_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name          VARCHAR(255)  NOT NULL,
  category           VARCHAR(100)  NOT NULL,
  price              NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  available_quantity INTEGER       NOT NULL DEFAULT 0 CHECK (available_quantity >= 0),
  preparation_time   INTEGER       NOT NULL DEFAULT 5,  -- in minutes
  status             item_status   NOT NULL DEFAULT 'AVAILABLE',
  image              TEXT,
  description        TEXT,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- TABLE: pickup_slots
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pickup_slots (
  slot_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_time      TIMESTAMPTZ   NOT NULL,
  max_orders     INTEGER       NOT NULL DEFAULT 20,
  current_orders INTEGER       NOT NULL DEFAULT 0 CHECK (current_orders >= 0),
  status         slot_status   NOT NULL DEFAULT 'AVAILABLE',
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- TABLE: orders
-- PDF Section 8 — Order Data
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  order_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID          NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  slot_id             UUID          REFERENCES pickup_slots(slot_id),
  token_number        VARCHAR(20)   UNIQUE NOT NULL,
  idempotency_key     VARCHAR(255)  UNIQUE NOT NULL,
  total_amount        NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
  order_time          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  pickup_time         TIMESTAMPTZ,
  estimated_ready_time TIMESTAMPTZ,
  order_status        order_status  NOT NULL DEFAULT 'PLACED',
  payment_status      payment_status NOT NULL DEFAULT 'PENDING',
  is_collected        BOOLEAN       NOT NULL DEFAULT FALSE,  -- Single-collection lock
  collected_at        TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- TABLE: order_items
-- PDF Section 8 — Order Item Data
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  order_item_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID          NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  item_id             UUID          NOT NULL REFERENCES menu_items(item_id),
  quantity            INTEGER       NOT NULL CHECK (quantity > 0),
  price               NUMERIC(10,2) NOT NULL,  -- Price snapshot at order time
  special_instruction TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- TABLE: idempotency_keys (Duplicate Submission Guard)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS idempotency_cache (
  key           VARCHAR(255) PRIMARY KEY,
  user_id       UUID         NOT NULL,
  response_body JSONB,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

-- ─────────────────────────────────────────────────────────────
-- TABLE: staff_activity_logs (Audit Trail)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_activity_logs (
  log_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   UUID        NOT NULL REFERENCES users(user_id),
  action     VARCHAR(255) NOT NULL,
  entity     VARCHAR(100),
  entity_id  UUID,
  details    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- INDEXES for performance
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_customer      ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status        ON orders(order_status);
CREATE INDEX IF NOT EXISTS idx_orders_slot          ON orders(slot_id);
CREATE INDEX IF NOT EXISTS idx_orders_idempotency   ON orders(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_order_items_order    ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_category  ON menu_items(category);
CREATE INDEX IF NOT EXISTS idx_menu_items_status    ON menu_items(status);
CREATE INDEX IF NOT EXISTS idx_logs_staff           ON staff_activity_logs(staff_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires  ON idempotency_cache(expires_at);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🚀 Running database migrations...');
    await client.query(SQL);
    console.log('✅ All tables created / already exist.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
