-- Active: 1773836451436@@127.0.0.1@5432@techwavedb
-- ============================================================
-- TECHWAVE ELECTRONICS KENYA
-- Complete Database Schema v2.0
-- March 2026
--
-- Changes from v1.0:
--   - Removed marketplace model (sellers table dropped)
--   - user_role enum: 'seller' replaced with 'agent'
--   - products.seller_id replaced with created_by (admin user)
--   - orders: added agent_id, referral_code, commission_total
--   - Added: agents, commission_rates, commissions tables
--   - Added: Ex-UK/Grade B product condition support
--   - Added: order refund/complaint tracking
--   - Confirmed payment methods: mpesa, card, cash_on_delivery
--   - Guest checkout removed: carts require user_id (not session)
-- ============================================================


-- ============================================================
-- EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for fast text search on products


-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM (
    'customer',
    'agent',
    'admin'
); 

CREATE TYPE order_status AS ENUM (
    'pending',       -- placed, not yet paid (COD) or awaiting M-Pesa
    'paid',          -- M-Pesa confirmed or COD payment confirmed by admin
    'processing',    -- admin has acknowledged and is preparing
    'shipped',       -- dispatched for delivery
    'delivered',     -- confirmed delivered to customer
    'cancelled',     -- cancelled before delivery
    'failed'         -- payment failed or fulfilment failed
);

CREATE TYPE payment_method AS ENUM (
    'mpesa',
    'cash_on_delivery',
    'card'           -- Phase 2 - included in enum now to avoid future migration
);

CREATE TYPE cart_status AS ENUM (
    'active',
    'abandoned',
    'converted'
);

CREATE TYPE product_condition AS ENUM (
    'new',
    'ex_uk'          -- Ex-UK / Grade B pre-owned imports
);

CREATE TYPE refund_status AS ENUM (
    'none',
    'requested',
    'approved',
    'rejected',
    'completed'
);


-- ============================================================
-- USERS
-- Base table for all account types (customers, agents, admins)
-- ============================================================

CREATE TABLE users (
    user_id         SERIAL PRIMARY KEY,
    role            user_role NOT NULL,
    name            VARCHAR(100) NOT NULL,
    email           VARCHAR(100) UNIQUE NOT NULL,
    phone           VARCHAR(13) UNIQUE CHECK (phone ~ '^\+254[0-9]{9}$'),
    password_hash   VARCHAR(255) NOT NULL,
    verified        BOOLEAN DEFAULT FALSE,
    terms           BOOLEAN DEFAULT FALSE,
    newsletter      BOOLEAN DEFAULT FALSE,
    last_login      TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  users IS 'Base account table for all roles: customers, agents, and admins';
COMMENT ON COLUMN users.role IS 'customer: public shopper | agent: referral sales agent | admin: platform administrator';
COMMENT ON COLUMN users.phone IS 'Kenyan format: +254XXXXXXXXX';


-- ============================================================
-- AGENTS
-- Internal sales agents. Each has a unique referral link.
-- Created exclusively by admin — no public registration.
-- ============================================================

CREATE TABLE agents (
    agent_id        SERIAL PRIMARY KEY,
    user_id         INTEGER UNIQUE NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    agent_code      VARCHAR(20) UNIQUE NOT NULL,    -- e.g. AGT001, AGT002
    full_name       VARCHAR(100) NOT NULL,
    phone           VARCHAR(20) NOT NULL,
    id_number       VARCHAR(30) NOT NULL,            -- National ID or Passport
    referral_link   VARCHAR(255) UNIQUE NOT NULL,    -- full URL e.g. https://techwaveelectronics.co.ke?ref=AGT001
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deactivated_at  TIMESTAMP WITH TIME ZONE NULL,   -- set when admin deactivates agent
    created_by      INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT
);

COMMENT ON TABLE  agents IS 'Sales agents who earn commission by sharing referral links. Created by admin only.';
COMMENT ON COLUMN agents.agent_code IS 'Auto-generated sequential code: AGT001, AGT002, etc. Never reused.';
COMMENT ON COLUMN agents.referral_link IS 'Full URL. Goes dead immediately when is_active = FALSE.';
COMMENT ON COLUMN agents.deactivated_at IS 'Timestamp of deactivation. Historical orders and commissions remain visible.';


-- ============================================================
-- ADDRESSES
-- Delivery addresses saved by customers
-- ============================================================

CREATE TABLE addresses (
    address_id      SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    label           VARCHAR(50),                     -- e.g. "Home", "Office"
    city            VARCHAR(50) NOT NULL,
    street          VARCHAR(255) NOT NULL,
    building        VARCHAR(100),
    postal_code     VARCHAR(20),
    is_default      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE addresses IS 'Customer delivery addresses. Multiple addresses per customer supported.';


-- ============================================================
-- CATEGORIES
-- Product categories managed by admin
-- ============================================================

CREATE TABLE categories (
    category_id     SERIAL PRIMARY KEY,
    name            VARCHAR(50) NOT NULL UNIQUE,
    description     TEXT,
    featured        BOOLEAN DEFAULT FALSE,
    icon_path       VARCHAR(255),
    sort_order      INTEGER DEFAULT 0,               -- for ordering in nav/storefront
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  categories IS 'Product categories. Managed by admin. Changes reflect immediately on storefront.';
COMMENT ON COLUMN categories.sort_order IS 'Lower number = shown first in navigation.';


-- ============================================================
-- COMMISSION RATES
-- Category-based commission rates. Configurable by admin.
-- Accessories: 8% | All other categories: 2.5%
-- ============================================================

CREATE TABLE commission_rates (
    rate_id         SERIAL PRIMARY KEY,
    category_id     INTEGER NOT NULL REFERENCES categories(category_id) ON DELETE RESTRICT,
    rate_percent    NUMERIC(5,2) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
    set_by          INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    effective_from  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active       BOOLEAN DEFAULT TRUE,
    notes           TEXT
);

COMMENT ON TABLE  commission_rates IS 'Commission rates per category. Confirmed: Accessories=8%, all others=2.5%.';
COMMENT ON COLUMN commission_rates.rate_percent IS 'Percentage applied to order_item subtotal. e.g. 8.00 = 8%.';
COMMENT ON COLUMN commission_rates.is_active IS 'Only one active rate per category at a time (enforced by application).';
COMMENT ON COLUMN commission_rates.notes IS 'Admin notes on why rate was set or changed.';


-- ============================================================
-- PRODUCTS
-- All products owned and managed by TechWave admin.
-- No seller/marketplace model.
-- ============================================================

CREATE TABLE products (
    product_id      SERIAL PRIMARY KEY,
    created_by      INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    category_id     INTEGER NOT NULL REFERENCES categories(category_id) ON DELETE RESTRICT,
    title           VARCHAR(150) NOT NULL,
    description     TEXT,
    price           NUMERIC(10,2) NOT NULL CHECK (price > 0),
    sale_price      NUMERIC(10,2) CHECK (sale_price > 0 AND sale_price < price),
    is_on_sale      BOOLEAN DEFAULT FALSE,
    stock           INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    condition       product_condition NOT NULL DEFAULT 'new',
    condition_notes TEXT,                            -- e.g. "Grade A — barely used, no scratches"
    specs           JSONB,                           -- flexible key-value specs per product type
    warranty_info   TEXT,
    rating          NUMERIC(3,2) DEFAULT 0.00 CHECK (rating >= 0 AND rating <= 5),
    review_count    INTEGER DEFAULT 0 CHECK (review_count >= 0),
    is_active       BOOLEAN DEFAULT TRUE,            -- admin can hide without deleting
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  products IS 'All products. TechWave-owned only — no third-party sellers.';
COMMENT ON COLUMN products.created_by IS 'Admin user who added the product.';
COMMENT ON COLUMN products.sale_price IS 'If set and is_on_sale=TRUE, storefront shows strikethrough on price.';
COMMENT ON COLUMN products.is_on_sale IS 'Admin toggles this to activate/deactivate the sale price.';
COMMENT ON COLUMN products.condition IS 'new: brand new | ex_uk: pre-owned import (Ex-UK/Grade B).';
COMMENT ON COLUMN products.condition_notes IS 'Human-readable condition description for Ex-UK products.';
COMMENT ON COLUMN products.specs IS 'JSONB: flexible specs e.g. {"RAM":"8GB","Storage":"256GB","Color":"Black"}.';
COMMENT ON COLUMN products.is_active IS 'FALSE = hidden from storefront but not deleted. Orders retain reference.';


-- ============================================================
-- PRODUCT IMAGES
-- Multiple images per product. One marked as primary.
-- ============================================================

CREATE TABLE product_images (
    image_id        SERIAL PRIMARY KEY,
    product_id      INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    image_url       VARCHAR(255) NOT NULL,
    alt_text        VARCHAR(150),
    is_primary      BOOLEAN DEFAULT FALSE,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  product_images IS 'Product images. sort_order controls display order. is_primary = main thumbnail.';


-- ============================================================
-- SPECIAL OFFERS
-- Sitewide promotions and discount campaigns. Admin-managed.
-- ============================================================

CREATE TABLE special_offers (
    offer_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title           VARCHAR(100) NOT NULL,
    description     TEXT,
    discount_type   VARCHAR(20) CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value  NUMERIC(10,2) CHECK (discount_value > 0),
    discount_percent NUMERIC(5,2) CHECK (discount_percent > 0 AND discount_percent <= 100),
    banner_image_url VARCHAR(255),
    valid_from      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    valid_until     TIMESTAMP WITH TIME ZONE,
    is_active       BOOLEAN DEFAULT TRUE,
    created_by      INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE special_offers IS 'Sitewide promotional campaigns. Linked to products via product_offers.';


-- ============================================================
-- PRODUCT OFFERS
-- Many-to-many: products <-> special offers
-- ============================================================

CREATE TABLE product_offers (
    product_id      INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    offer_id        UUID NOT NULL REFERENCES special_offers(offer_id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, offer_id)
);


-- ============================================================
-- CARTS
-- Shopping carts. Requires user_id — no guest carts.
-- Guest checkout is not permitted on this platform.
-- ============================================================

CREATE TABLE carts (
    cart_id         SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    status          cart_status NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE carts ADD COLUMN session_id VARCHAR(100) UNIQUE; -- for future use if we allow guest checkout (currently not used)

COMMENT ON TABLE  carts IS 'Shopping carts. user_id required — no anonymous/guest carts. One active cart per user.';
COMMENT ON COLUMN carts.status IS 'active: in use | abandoned: not completed | converted: order placed.';


-- ============================================================
-- CART ITEMS
-- Products added to a cart
-- ============================================================

CREATE TABLE cart_items (
    cart_item_id    SERIAL PRIMARY KEY,
    cart_id         INTEGER NOT NULL REFERENCES carts(cart_id) ON DELETE CASCADE,
    product_id      INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    unit_price      NUMERIC(10,2) NOT NULL CHECK (unit_price > 0),  -- price at time of adding to cart
    added_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (cart_id, product_id)
);

COMMENT ON TABLE  cart_items IS 'Items in a cart. unit_price captured at time of adding to prevent price-change issues.';


-- ============================================================
-- ORDERS
-- Customer orders. Linked to agent if placed via referral link.
-- ============================================================

CREATE TABLE orders (
    order_id        SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    cart_id         INTEGER REFERENCES carts(cart_id) ON DELETE SET NULL,
    address_id      INTEGER NOT NULL REFERENCES addresses(address_id) ON DELETE RESTRICT,
    agent_id        INTEGER REFERENCES agents(agent_id) ON DELETE SET NULL,
    referral_code   VARCHAR(20),                     -- agent_code captured at checkout
    commission_total NUMERIC(10,2) DEFAULT 0.00,     -- sum of all commission rows for this order
    total_amount    NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
    delivery_fee    NUMERIC(10,2) DEFAULT 0.00,
    status          order_status NOT NULL DEFAULT 'pending',
    payment_method  payment_method NOT NULL,
    notes           TEXT,                            -- customer notes at checkout
    refund_status   refund_status NOT NULL DEFAULT 'none',
    refund_amount   NUMERIC(10,2),
    refund_notes    TEXT,
    refund_resolved_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    refund_resolved_at TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  orders IS 'Customer orders. agent_id set if order placed via referral link (session-only tracking).';
COMMENT ON COLUMN orders.agent_id IS 'NULL if customer came directly. Set from session referral code at checkout.';
COMMENT ON COLUMN orders.referral_code IS 'Stored for audit trail. Matches agents.agent_code.';
COMMENT ON COLUMN orders.commission_total IS 'Sum of commissions.amount_earned for this order. Denormalised for fast reporting.';
COMMENT ON COLUMN orders.payment_method IS 'mpesa: STK Push | cash_on_delivery: pay on arrival | card: Phase 2.';
COMMENT ON COLUMN orders.refund_status IS 'none: no refund | requested | approved | rejected | completed.';


-- ============================================================
-- ORDER ITEMS
-- Individual line items within an order
-- ============================================================

CREATE TABLE order_items (
    order_item_id   SERIAL PRIMARY KEY,
    order_id        INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    product_id      INTEGER NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
    category_id     INTEGER NOT NULL REFERENCES categories(category_id) ON DELETE RESTRICT,
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    unit_price      NUMERIC(10,2) NOT NULL CHECK (unit_price > 0),  -- price at time of order
    sale_price_applied NUMERIC(10,2),               -- if sale was active, record it here
    discount        NUMERIC(10,2) DEFAULT 0.00,
    subtotal        NUMERIC(10,2) NOT NULL           -- (unit_price * quantity) - discount
);

COMMENT ON TABLE  order_items IS 'Line items per order. category_id denormalised here for fast commission calculation.';
COMMENT ON COLUMN order_items.category_id IS 'Denormalised from products.category_id at time of order. Used for commission rate lookup.';
COMMENT ON COLUMN order_items.sale_price_applied IS 'Records the sale_price if the product was on sale at time of purchase.';
COMMENT ON COLUMN order_items.subtotal IS 'Pre-calculated: (unit_price * quantity) - discount.';


-- ============================================================
-- COMMISSIONS
-- Per order-item commission records.
-- Commission is CATEGORY-BASED: Accessories 8%, all others 2.5%.
-- One row per order_item — not per order.
-- ============================================================

CREATE TABLE commissions (
    commission_id   SERIAL PRIMARY KEY,
    agent_id        INTEGER NOT NULL REFERENCES agents(agent_id) ON DELETE RESTRICT,
    order_id        INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE RESTRICT,
    order_item_id   INTEGER NOT NULL REFERENCES order_items(order_item_id) ON DELETE RESTRICT,
    category_id     INTEGER NOT NULL REFERENCES categories(category_id) ON DELETE RESTRICT,
    item_subtotal   NUMERIC(10,2) NOT NULL,          -- the order_item subtotal commission was applied to
    rate_applied    NUMERIC(5,2) NOT NULL,            -- rate at time of order (from commission_rates)
    amount_earned   NUMERIC(10,2) NOT NULL,           -- item_subtotal * (rate_applied / 100)
    is_bonus        BOOLEAN DEFAULT FALSE,            -- TRUE only for manually-set bonus commissions
    notes           TEXT,                             -- admin notes (e.g. reason for manual bonus)
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  commissions IS 'Per-item commission records. Category-based: Accessories=8%, Electronics/others=2.5%.';
COMMENT ON COLUMN commissions.order_item_id IS 'One commission row per order_item — not one per order.';
COMMENT ON COLUMN commissions.rate_applied IS 'Rate locked at time of order. Changing commission_rates does not affect past commissions.';
COMMENT ON COLUMN commissions.amount_earned IS 'item_subtotal * (rate_applied / 100). Stored for reporting without recalculation.';
COMMENT ON COLUMN commissions.is_bonus IS 'Manual bonus commissions set by admin. Not auto-calculated.';


-- ============================================================
-- PAYMENTS
-- One payment record per order
-- ============================================================

CREATE TABLE payments (
    payment_id      SERIAL PRIMARY KEY,
    order_id        INTEGER UNIQUE NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    method          payment_method NOT NULL,
    amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    mpesa_code      VARCHAR(20),                     -- M-Pesa receipt number e.g. QGR9ABCDEF
    mpesa_phone     VARCHAR(13) CHECK (mpesa_phone ~ '^\+254[0-9]{9}$'),
    transaction_reference VARCHAR(100),
    is_confirmed    BOOLEAN DEFAULT FALSE,
    confirmed_at    TIMESTAMP WITH TIME ZONE,
    confirmed_by    INTEGER REFERENCES users(user_id) ON DELETE SET NULL, -- admin for COD
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  payments IS 'One payment record per order. M-Pesa confirmation auto via Daraja. COD confirmed manually by admin.';
COMMENT ON COLUMN payments.confirmed_by IS 'NULL for M-Pesa (auto). Admin user_id for Cash on Delivery manual confirmation.';


-- ============================================================
-- M-PESA TRANSACTIONS
-- STK Push transaction tracking (Daraja API)
-- ============================================================

CREATE TABLE mpesa_transactions (
    transaction_id          SERIAL PRIMARY KEY,
    order_id                INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    checkout_request_id     VARCHAR(100) UNIQUE NOT NULL,   -- from Daraja STK Push response
    merchant_request_id     VARCHAR(100) NOT NULL,
    phone_number            VARCHAR(15) NOT NULL,
    amount                  NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    mpesa_receipt_number    VARCHAR(50),                    -- e.g. QGR9ABCDEF (from callback)
    transaction_date        BIGINT,                         -- YYYYMMDDHHmmss format from Daraja
    status                  VARCHAR(20) DEFAULT 'pending'
                                CHECK (status IN ('pending','completed','failed','cancelled')),
    result_code             VARCHAR(10),
    result_desc             TEXT,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  mpesa_transactions IS 'M-Pesa STK Push transaction log. Updated by Daraja callback webhook.';
COMMENT ON COLUMN mpesa_transactions.checkout_request_id IS 'Unique Daraja identifier. Used to match callback to original request.';
COMMENT ON COLUMN mpesa_transactions.transaction_date IS 'Daraja timestamp in YYYYMMDDHHmmss format — convert when displaying.';


-- ============================================================
-- REVIEWS
-- Product reviews from verified buyers only
-- ============================================================

CREATE TABLE reviews (
    review_id       SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    product_id      INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    order_id        INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,  -- must have delivered order
    rating          INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment         TEXT,
    is_verified     BOOLEAN DEFAULT TRUE,            -- always true (only delivered buyers can review)
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_product_review UNIQUE (user_id, product_id)
);

COMMENT ON TABLE  reviews IS 'Product reviews. Only customers with a delivered order containing the product can review.';
COMMENT ON COLUMN reviews.order_id IS 'Enforces verified purchase. API checks order status = delivered before allowing submission.';


-- ============================================================
-- DELIVERY PRICING
-- Configurable delivery fees by city/area
-- ============================================================

CREATE TABLE delivery_pricing (
    rule_id             SERIAL PRIMARY KEY,
    city                VARCHAR(50) NOT NULL UNIQUE,
    standard_fee        NUMERIC(10,2) NOT NULL CHECK (standard_fee >= 0),
    min_free_delivery   NUMERIC(10,2) DEFAULT 0.00, -- order total above this = free delivery
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  delivery_pricing IS 'Delivery fee rules per city. Admin-configurable. min_free_delivery=0 means no free delivery threshold.';


-- ============================================================
-- ORDER STATUS HISTORY
-- Audit trail of every status change on every order
-- ============================================================

CREATE TABLE order_status_history (
    history_id      SERIAL PRIMARY KEY,
    order_id        INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    from_status     order_status,
    to_status       order_status NOT NULL,
    changed_by      INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    notes           TEXT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  order_status_history IS 'Immutable audit log of all order status changes. Used for dispute resolution.';


-- ============================================================
-- INDEXES
-- ============================================================

-- Users
CREATE INDEX idx_users_role          ON users(role);
CREATE INDEX idx_users_email         ON users(email);

-- Agents
CREATE INDEX idx_agents_code         ON agents(agent_code);
CREATE INDEX idx_agents_user         ON agents(user_id);
CREATE INDEX idx_agents_active       ON agents(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_agents_referral     ON agents(referral_link);

-- Products
CREATE INDEX idx_products_category   ON products(category_id);
CREATE INDEX idx_products_admin      ON products(created_by);
CREATE INDEX idx_products_active     ON products(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_products_condition  ON products(condition);
CREATE INDEX idx_products_on_sale    ON products(is_on_sale) WHERE is_on_sale = TRUE;
CREATE INDEX idx_products_title      ON products USING gin(title gin_trgm_ops); -- fast text search

-- Product images
CREATE INDEX idx_product_images_product ON product_images(product_id);
CREATE INDEX idx_product_images_primary ON product_images(product_id) WHERE is_primary = TRUE;

-- Carts
CREATE INDEX idx_carts_user          ON carts(user_id);
CREATE INDEX idx_carts_active        ON carts(user_id, status) WHERE status = 'active';

-- Cart items
CREATE INDEX idx_cart_items_cart     ON cart_items(cart_id);
CREATE INDEX idx_cart_items_product  ON cart_items(product_id);

-- Orders
CREATE INDEX idx_orders_user         ON orders(user_id);
CREATE INDEX idx_orders_agent        ON orders(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_orders_status       ON orders(status);
CREATE INDEX idx_orders_referral     ON orders(referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX idx_orders_created      ON orders(created_at DESC);
CREATE INDEX idx_orders_payment      ON orders(payment_method);

-- Order items
CREATE INDEX idx_order_items_order   ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
CREATE INDEX idx_order_items_category ON order_items(category_id);

-- Commissions
CREATE INDEX idx_commissions_agent   ON commissions(agent_id);
CREATE INDEX idx_commissions_order   ON commissions(order_id);
CREATE INDEX idx_commissions_item    ON commissions(order_item_id);
CREATE INDEX idx_commissions_created ON commissions(created_at DESC);

-- Commission rates
CREATE INDEX idx_commission_rates_category ON commission_rates(category_id);
CREATE INDEX idx_commission_rates_active   ON commission_rates(category_id) WHERE is_active = TRUE;

-- Payments
CREATE INDEX idx_payments_order      ON payments(order_id);

-- M-Pesa
CREATE INDEX idx_mpesa_checkout      ON mpesa_transactions(checkout_request_id);
CREATE INDEX idx_mpesa_order         ON mpesa_transactions(order_id);
CREATE INDEX idx_mpesa_status        ON mpesa_transactions(status);
CREATE INDEX idx_mpesa_status_date   ON mpesa_transactions(status, created_at DESC);
CREATE INDEX idx_mpesa_created       ON mpesa_transactions(created_at DESC);
CREATE INDEX idx_mpesa_phone         ON mpesa_transactions(phone_number);

-- Reviews
CREATE INDEX idx_reviews_product     ON reviews(product_id);
CREATE INDEX idx_reviews_user        ON reviews(user_id);
CREATE INDEX idx_reviews_order       ON reviews(order_id);

-- Order status history
CREATE INDEX idx_status_history_order ON order_status_history(order_id);
CREATE INDEX idx_status_history_date  ON order_status_history(created_at DESC);

-- Addresses
CREATE INDEX idx_addresses_user      ON addresses(user_id);
CREATE INDEX idx_addresses_default   ON addresses(user_id) WHERE is_default = TRUE;


-- ============================================================
-- SEED DATA
-- ============================================================

-- Categories
INSERT INTO categories (name, description, featured, icon_path, sort_order) VALUES
    ('Phones',           'Smartphones and feature phones',                   TRUE,  '/icons/phones.png',       1),
    ('Laptops',          'Laptops and notebooks',                            TRUE,  '/icons/laptops.png',      2),
    ('Accessories',      'Phone cases, chargers, cables, and peripherals',   TRUE,  '/icons/accessories.png',  3),
    ('Home Appliances',  'TVs, fridges, cookers, and sound systems',         TRUE,  '/icons/appliances.png',   4),
    ('Gaming',           'Consoles, controllers, and gaming accessories',    TRUE,  '/icons/gaming.png',       5),
    ('Audio & Sound',    'Wireless headphones, Bluetooth speakers, earbuds', TRUE,  '/icons/audio-sound.png',  6);

-- Commission rates (seeded after categories so we can reference category_id by name)
-- NOTE: requires at least one admin user to exist for set_by FK.
-- Run this INSERT after creating the first admin account, or use a placeholder:
-- INSERT INTO users (role, name, email, password_hash, verified, terms)
--     VALUES ('admin', 'TechWave Admin', 'admin@techwaveelectronics.co.ke', 'CHANGEME', TRUE, TRUE);

-- Then seed commission rates (replace 1 with actual admin user_id):
INSERT INTO commission_rates (category_id, rate_percent, set_by, notes)
SELECT category_id, 8.00, 1, 'Confirmed rate — Accessories (March 2026)'
FROM categories WHERE name = 'Accessories';

INSERT INTO commission_rates (category_id, rate_percent, set_by, notes)
SELECT category_id, 2.50, 1, 'Confirmed rate — Electronics/all other categories (March 2026)'
FROM categories WHERE name = 'Phones';

INSERT INTO commission_rates (category_id, rate_percent, set_by, notes)
SELECT category_id, 2.50, 1, 'Confirmed rate — Electronics/all other categories (March 2026)'
FROM categories WHERE name = 'Laptops';

INSERT INTO commission_rates (category_id, rate_percent, set_by, notes)
SELECT category_id, 2.50, 1, 'Confirmed rate — Electronics/all other categories (March 2026)'
FROM categories WHERE name = 'Home Appliances';

INSERT INTO commission_rates (category_id, rate_percent, set_by, notes)
SELECT category_id, 2.50, 1, 'Confirmed rate — Electronics/all other categories (March 2026)'
FROM categories WHERE name = 'Gaming';

INSERT INTO commission_rates (category_id, rate_percent, set_by, notes)
SELECT category_id, 2.50, 1, 'Confirmed rate — Electronics/all other categories (March 2026)'
FROM categories WHERE name = 'Audio & Sound';


-- ============================================================
-- USEFUL FUNCTIONS
-- ============================================================

-- Auto-update updated_at on any table that has it
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to all tables with updated_at
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_carts_updated_at
    BEFORE UPDATE ON carts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_mpesa_updated_at
    BEFORE UPDATE ON mpesa_transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Recalculate product average rating when a review is added or deleted
CREATE OR REPLACE FUNCTION refresh_product_rating()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE products
    SET
        rating = (
            SELECT COALESCE(ROUND(AVG(rating)::NUMERIC, 2), 0.00)
            FROM reviews
            WHERE product_id = COALESCE(NEW.product_id, OLD.product_id)
        ),
        review_count = (
            SELECT COUNT(*)
            FROM reviews
            WHERE product_id = COALESCE(NEW.product_id, OLD.product_id)
        ),
        updated_at = CURRENT_TIMESTAMP
    WHERE product_id = COALESCE(NEW.product_id, OLD.product_id);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_refresh_rating_insert
    AFTER INSERT ON reviews
    FOR EACH ROW EXECUTE FUNCTION refresh_product_rating();

CREATE TRIGGER trg_refresh_rating_delete
    AFTER DELETE ON reviews
    FOR EACH ROW EXECUTE FUNCTION refresh_product_rating();

-- Log every order status change automatically
CREATE OR REPLACE FUNCTION log_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO order_status_history (order_id, from_status, to_status)
        VALUES (NEW.order_id, OLD.status, NEW.status);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_status_history
    AFTER UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION log_order_status_change();


-- ============================================================
-- M-PESA TRANSACTION FUNCTIONS (carried over from v1.0)
-- ============================================================

-- Get full transaction details by transaction_id
CREATE OR REPLACE FUNCTION get_transaction_details(p_transaction_id INTEGER)
RETURNS TABLE(
    transaction_id          INTEGER,
    order_id                INTEGER,
    phone_number            VARCHAR,
    amount                  NUMERIC,
    status                  VARCHAR,
    mpesa_receipt_number    VARCHAR,
    result_code             VARCHAR,
    result_desc             TEXT,
    created_at              TIMESTAMP WITH TIME ZONE,
    time_pending            INTERVAL
) AS $$
SELECT
    t.transaction_id, t.order_id, t.phone_number, t.amount, t.status,
    t.mpesa_receipt_number, t.result_code, t.result_desc,
    t.created_at, NOW() - t.created_at AS time_pending
FROM mpesa_transactions t
WHERE t.transaction_id = p_transaction_id;
$$ LANGUAGE SQL STABLE;

-- Update transaction status from Daraja callback
CREATE OR REPLACE FUNCTION update_transaction_status(
    p_checkout_request_id   VARCHAR,
    p_status                VARCHAR,
    p_mpesa_receipt         VARCHAR DEFAULT NULL,
    p_result_code           VARCHAR DEFAULT NULL,
    p_result_desc           TEXT    DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message VARCHAR, transaction_id INTEGER) AS $$
DECLARE
    v_transaction_id INTEGER;
BEGIN
    UPDATE mpesa_transactions
    SET
        status               = p_status,
        mpesa_receipt_number = COALESCE(p_mpesa_receipt, mpesa_receipt_number),
        result_code          = COALESCE(p_result_code,   result_code),
        result_desc          = COALESCE(p_result_desc,   result_desc),
        updated_at           = CURRENT_TIMESTAMP
    WHERE checkout_request_id = p_checkout_request_id
    RETURNING transaction_id INTO v_transaction_id;

    IF v_transaction_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Transaction not found'::VARCHAR, NULL::INTEGER;
    ELSE
        RETURN QUERY SELECT TRUE, 'Updated successfully'::VARCHAR, v_transaction_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Count pending transactions (monitoring)
CREATE OR REPLACE FUNCTION count_pending_transactions()
RETURNS TABLE(
    pending_count           INTEGER,
    total_pending_amount    NUMERIC,
    oldest_pending_age      INTERVAL
) AS $$
SELECT COUNT(*)::INTEGER, SUM(amount), NOW() - MIN(created_at)
FROM mpesa_transactions
WHERE status = 'pending';
$$ LANGUAGE SQL STABLE;

-- Auto-fail stale pending M-Pesa transactions (run via cron or pg_cron)
CREATE OR REPLACE FUNCTION timeout_stale_mpesa_transactions()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE mpesa_transactions
    SET
        status      = 'failed',
        result_code = 'TIMEOUT',
        result_desc = 'Transaction timeout — no response from M-Pesa within 30 minutes',
        updated_at  = CURRENT_TIMESTAMP
    WHERE status    = 'pending'
      AND created_at < NOW() - INTERVAL '30 minutes';

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- MAINTENANCE HELPERS
-- ============================================================

-- Archive M-Pesa transactions older than 90 days (run periodically)
CREATE TABLE IF NOT EXISTS mpesa_transactions_archive
    (LIKE mpesa_transactions INCLUDING ALL);

COMMENT ON TABLE mpesa_transactions_archive IS 'Archive of M-Pesa transactions older than 90 days. Moved here for performance.';

-- Verify referential integrity across agents and orders
CREATE OR REPLACE VIEW v_agent_commission_summary AS
SELECT
    a.agent_id,
    a.agent_code,
    a.full_name,
    a.is_active,
    COUNT(DISTINCT c.order_id)                          AS total_orders,
    COALESCE(SUM(c.amount_earned), 0.00)                AS total_commission,
    COALESCE(SUM(CASE WHEN cat.name = 'Accessories'
                 THEN c.amount_earned ELSE 0 END), 0.00) AS accessories_commission,
    COALESCE(SUM(CASE WHEN cat.name != 'Accessories'
                 THEN c.amount_earned ELSE 0 END), 0.00) AS electronics_commission,
    COUNT(DISTINCT o.user_id)                           AS unique_customers,
    COALESCE(SUM(o.total_amount), 0.00)                 AS total_revenue_generated
FROM agents a
LEFT JOIN commissions c      ON c.agent_id   = a.agent_id AND c.is_bonus = FALSE
LEFT JOIN categories cat     ON cat.category_id = c.category_id
LEFT JOIN orders o           ON o.agent_id   = a.agent_id
GROUP BY a.agent_id, a.agent_code, a.full_name, a.is_active;

COMMENT ON VIEW v_agent_commission_summary IS 'Pre-built agent performance view. Used by admin commission report and agent leaderboard.';

-- Analytics: daily revenue summary
CREATE OR REPLACE VIEW v_daily_revenue AS
SELECT
    DATE(o.created_at)                                  AS order_date,
    COUNT(*)                                            AS total_orders,
    SUM(o.total_amount)                                 AS gross_revenue,
    COUNT(CASE WHEN o.payment_method = 'mpesa'
               THEN 1 END)                              AS mpesa_orders,
    COUNT(CASE WHEN o.payment_method = 'cash_on_delivery'
               THEN 1 END)                              AS cod_orders,
    COUNT(CASE WHEN o.agent_id IS NOT NULL
               THEN 1 END)                              AS agent_referred_orders,
    SUM(CASE WHEN o.agent_id IS NOT NULL
             THEN o.commission_total ELSE 0 END)        AS total_commissions_paid
FROM orders o
WHERE o.status NOT IN ('cancelled', 'failed')
GROUP BY DATE(o.created_at)
ORDER BY order_date DESC;

COMMENT ON VIEW v_daily_revenue IS 'Daily revenue summary for analytics dashboard. Excludes cancelled and failed orders.';


-- ============================================================
-- END OF SCHEMA
-- TechWave Electronics Kenya — Database Schema v2.0
-- All confirmed decisions as of March 2026
-- ============================================================
-- Active: 1773836451436@@127.0.0.1@5432@techwavedb
-- ============================================================
-- TECHWAVE ELECTRONICS KENYA
-- Complete Database Schema v2.0
-- March 2026
--
-- Changes from v1.0:
--   - Removed marketplace model (sellers table dropped)
--   - user_role enum: 'seller' replaced with 'agent'
--   - products.seller_id replaced with created_by (admin user)
--   - orders: added agent_id, referral_code, commission_total
--   - Added: agents, commission_rates, commissions tables
--   - Added: Ex-UK/Grade B product condition support
--   - Added: order refund/complaint tracking
--   - Confirmed payment methods: mpesa, card, cash_on_delivery
--   - Guest checkout removed: carts require user_id (not session)
-- ============================================================


-- ============================================================
-- EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for fast text search on products


-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM (
    'customer',
    'agent',
    'admin'
); 

CREATE TYPE order_status AS ENUM (
    'pending',       -- placed, not yet paid (COD) or awaiting M-Pesa
    'paid',          -- M-Pesa confirmed or COD payment confirmed by admin
    'processing',    -- admin has acknowledged and is preparing
    'shipped',       -- dispatched for delivery
    'delivered',     -- confirmed delivered to customer
    'cancelled',     -- cancelled before delivery
    'failed'         -- payment failed or fulfilment failed
);

CREATE TYPE payment_method AS ENUM (
    'mpesa',
    'cash_on_delivery',
    'card'           -- Phase 2 - included in enum now to avoid future migration
);

CREATE TYPE cart_status AS ENUM (
    'active',
    'abandoned',
    'converted'
);

CREATE TYPE product_condition AS ENUM (
    'new',
    'ex_uk'          -- Ex-UK / Grade B pre-owned imports
);

CREATE TYPE refund_status AS ENUM (
    'none',
    'requested',
    'approved',
    'rejected',
    'completed'
);


-- ============================================================
-- USERS
-- Base table for all account types (customers, agents, admins)
-- ============================================================

CREATE TABLE users (
    user_id         SERIAL PRIMARY KEY,
    role            user_role NOT NULL,
    name            VARCHAR(100) NOT NULL,
    email           VARCHAR(100) UNIQUE NOT NULL,
    phone           VARCHAR(13) UNIQUE CHECK (phone ~ '^\+254[0-9]{9}$'),
    password_hash   VARCHAR(255) NOT NULL,
    verified        BOOLEAN DEFAULT FALSE,
    terms           BOOLEAN DEFAULT FALSE,
    newsletter      BOOLEAN DEFAULT FALSE,
    last_login      TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  users IS 'Base account table for all roles: customers, agents, and admins';
COMMENT ON COLUMN users.role IS 'customer: public shopper | agent: referral sales agent | admin: platform administrator';
COMMENT ON COLUMN users.phone IS 'Kenyan format: +254XXXXXXXXX';


-- ============================================================
-- AGENTS
-- Internal sales agents. Each has a unique referral link.
-- Created exclusively by admin — no public registration.
-- ============================================================

CREATE TABLE agents (
    agent_id        SERIAL PRIMARY KEY,
    user_id         INTEGER UNIQUE NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    agent_code      VARCHAR(20) UNIQUE NOT NULL,    -- e.g. AGT001, AGT002
    full_name       VARCHAR(100) NOT NULL,
    phone           VARCHAR(20) NOT NULL,
    id_number       VARCHAR(30) NOT NULL,            -- National ID or Passport
    referral_link   VARCHAR(255) UNIQUE NOT NULL,    -- full URL e.g. https://techwaveelectronics.co.ke?ref=AGT001
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deactivated_at  TIMESTAMP WITH TIME ZONE NULL,   -- set when admin deactivates agent
    created_by      INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT
);

COMMENT ON TABLE  agents IS 'Sales agents who earn commission by sharing referral links. Created by admin only.';
COMMENT ON COLUMN agents.agent_code IS 'Auto-generated sequential code: AGT001, AGT002, etc. Never reused.';
COMMENT ON COLUMN agents.referral_link IS 'Full URL. Goes dead immediately when is_active = FALSE.';
COMMENT ON COLUMN agents.deactivated_at IS 'Timestamp of deactivation. Historical orders and commissions remain visible.';


-- ============================================================
-- ADDRESSES
-- Delivery addresses saved by customers
-- ============================================================

CREATE TABLE addresses (
    address_id      SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    label           VARCHAR(50),                     -- e.g. "Home", "Office"
    city            VARCHAR(50) NOT NULL,
    street          VARCHAR(255) NOT NULL,
    building        VARCHAR(100),
    postal_code     VARCHAR(20),
    is_default      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE addresses IS 'Customer delivery addresses. Multiple addresses per customer supported.';


-- ============================================================
-- CATEGORIES
-- Product categories managed by admin
-- ============================================================

CREATE TABLE categories (
    category_id     SERIAL PRIMARY KEY,
    name            VARCHAR(50) NOT NULL UNIQUE,
    description     TEXT,
    featured        BOOLEAN DEFAULT FALSE,
    icon_path       VARCHAR(255),
    sort_order      INTEGER DEFAULT 0,               -- for ordering in nav/storefront
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  categories IS 'Product categories. Managed by admin. Changes reflect immediately on storefront.';
COMMENT ON COLUMN categories.sort_order IS 'Lower number = shown first in navigation.';


-- ============================================================
-- COMMISSION RATES
-- Category-based commission rates. Configurable by admin.
-- Accessories: 8% | All other categories: 2.5%
-- ============================================================

CREATE TABLE commission_rates (
    rate_id         SERIAL PRIMARY KEY,
    category_id     INTEGER NOT NULL REFERENCES categories(category_id) ON DELETE RESTRICT,
    rate_percent    NUMERIC(5,2) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
    set_by          INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    effective_from  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active       BOOLEAN DEFAULT TRUE,
    notes           TEXT
);

COMMENT ON TABLE  commission_rates IS 'Commission rates per category. Confirmed: Accessories=8%, all others=2.5%.';
COMMENT ON COLUMN commission_rates.rate_percent IS 'Percentage applied to order_item subtotal. e.g. 8.00 = 8%.';
COMMENT ON COLUMN commission_rates.is_active IS 'Only one active rate per category at a time (enforced by application).';
COMMENT ON COLUMN commission_rates.notes IS 'Admin notes on why rate was set or changed.';


-- ============================================================
-- PRODUCTS
-- All products owned and managed by TechWave admin.
-- No seller/marketplace model.
-- ============================================================

CREATE TABLE products (
    product_id      SERIAL PRIMARY KEY,
    created_by      INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    category_id     INTEGER NOT NULL REFERENCES categories(category_id) ON DELETE RESTRICT,
    title           VARCHAR(150) NOT NULL,
    description     TEXT,
    price           NUMERIC(10,2) NOT NULL CHECK (price > 0),
    sale_price      NUMERIC(10,2) CHECK (sale_price > 0 AND sale_price < price),
    is_on_sale      BOOLEAN DEFAULT FALSE,
    stock           INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    condition       product_condition NOT NULL DEFAULT 'new',
    condition_notes TEXT,                            -- e.g. "Grade A — barely used, no scratches"
    specs           JSONB,                           -- flexible key-value specs per product type
    warranty_info   TEXT,
    rating          NUMERIC(3,2) DEFAULT 0.00 CHECK (rating >= 0 AND rating <= 5),
    review_count    INTEGER DEFAULT 0 CHECK (review_count >= 0),
    is_active       BOOLEAN DEFAULT TRUE,            -- admin can hide without deleting
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  products IS 'All products. TechWave-owned only — no third-party sellers.';
COMMENT ON COLUMN products.created_by IS 'Admin user who added the product.';
COMMENT ON COLUMN products.sale_price IS 'If set and is_on_sale=TRUE, storefront shows strikethrough on price.';
COMMENT ON COLUMN products.is_on_sale IS 'Admin toggles this to activate/deactivate the sale price.';
COMMENT ON COLUMN products.condition IS 'new: brand new | ex_uk: pre-owned import (Ex-UK/Grade B).';
COMMENT ON COLUMN products.condition_notes IS 'Human-readable condition description for Ex-UK products.';
COMMENT ON COLUMN products.specs IS 'JSONB: flexible specs e.g. {"RAM":"8GB","Storage":"256GB","Color":"Black"}.';
COMMENT ON COLUMN products.is_active IS 'FALSE = hidden from storefront but not deleted. Orders retain reference.';


-- ============================================================
-- PRODUCT IMAGES
-- Multiple images per product. One marked as primary.
-- ============================================================

CREATE TABLE product_images (
    image_id        SERIAL PRIMARY KEY,
    product_id      INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    image_url       VARCHAR(255) NOT NULL,
    alt_text        VARCHAR(150),
    is_primary      BOOLEAN DEFAULT FALSE,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  product_images IS 'Product images. sort_order controls display order. is_primary = main thumbnail.';


-- ============================================================
-- SPECIAL OFFERS
-- Sitewide promotions and discount campaigns. Admin-managed.
-- ============================================================

CREATE TABLE special_offers (
    offer_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title           VARCHAR(100) NOT NULL,
    description     TEXT,
    discount_type   VARCHAR(20) CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value  NUMERIC(10,2) CHECK (discount_value > 0),
    discount_percent NUMERIC(5,2) CHECK (discount_percent > 0 AND discount_percent <= 100),
    banner_image_url VARCHAR(255),
    valid_from      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    valid_until     TIMESTAMP WITH TIME ZONE,
    is_active       BOOLEAN DEFAULT TRUE,
    created_by      INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE special_offers IS 'Sitewide promotional campaigns. Linked to products via product_offers.';


-- ============================================================
-- PRODUCT OFFERS
-- Many-to-many: products <-> special offers
-- ============================================================

CREATE TABLE product_offers (
    product_id      INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    offer_id        UUID NOT NULL REFERENCES special_offers(offer_id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, offer_id)
);


-- ============================================================
-- CARTS
-- Shopping carts. Requires user_id — no guest carts.
-- Guest checkout is not permitted on this platform.
-- ============================================================

CREATE TABLE carts (
    cart_id         SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    status          cart_status NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE carts ADD COLUMN session_id VARCHAR(100) UNIQUE; -- for future use if we allow guest checkout (currently not used)

COMMENT ON TABLE  carts IS 'Shopping carts. user_id required — no anonymous/guest carts. One active cart per user.';
COMMENT ON COLUMN carts.status IS 'active: in use | abandoned: not completed | converted: order placed.';

-- Modify carts table to allow guest checkout
ALTER TABLE carts 
ALTER COLUMN user_id DROP NOT NULL;

-- Add constraint to ensure either user_id OR session_id is present
ALTER TABLE carts 
DROP CONSTRAINT IF EXISTS cart_owner_constraint;

ALTER TABLE carts 
ADD CONSTRAINT cart_owner_constraint CHECK (
    (user_id IS NOT NULL AND session_id IS NULL) OR
    (user_id IS NULL AND session_id IS NOT NULL)
);

-- Delete abandoned carts older than 30 days
DELETE FROM carts 
WHERE status = 'abandoned' 
  AND created_at < NOW() - INTERVAL '30 days'
  AND user_id IS NULL;  -- Only guest carts

-- ============================================================
-- CART ITEMS
-- Products added to a cart
-- ============================================================

CREATE TABLE cart_items (
    cart_item_id    SERIAL PRIMARY KEY,
    cart_id         INTEGER NOT NULL REFERENCES carts(cart_id) ON DELETE CASCADE,
    product_id      INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    unit_price      NUMERIC(10,2) NOT NULL CHECK (unit_price > 0),  -- price at time of adding to cart
    added_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (cart_id, product_id)
);

COMMENT ON TABLE  cart_items IS 'Items in a cart. unit_price captured at time of adding to prevent price-change issues.';


-- ============================================================
-- ORDERS
-- Customer orders. Linked to agent if placed via referral link.
-- ============================================================

CREATE TABLE orders (
    order_id        SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    cart_id         INTEGER REFERENCES carts(cart_id) ON DELETE SET NULL,
    address_id      INTEGER NOT NULL REFERENCES addresses(address_id) ON DELETE RESTRICT,
    agent_id        INTEGER REFERENCES agents(agent_id) ON DELETE SET NULL,
    referral_code   VARCHAR(20),                     -- agent_code captured at checkout
    commission_total NUMERIC(10,2) DEFAULT 0.00,     -- sum of all commission rows for this order
    total_amount    NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
    delivery_fee    NUMERIC(10,2) DEFAULT 0.00,
    status          order_status NOT NULL DEFAULT 'pending',
    payment_method  payment_method NOT NULL,
    notes           TEXT,                            -- customer notes at checkout
    refund_status   refund_status NOT NULL DEFAULT 'none',
    refund_amount   NUMERIC(10,2),
    refund_notes    TEXT,
    refund_resolved_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    refund_resolved_at TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  orders IS 'Customer orders. agent_id set if order placed via referral link (session-only tracking).';
COMMENT ON COLUMN orders.agent_id IS 'NULL if customer came directly. Set from session referral code at checkout.';
COMMENT ON COLUMN orders.referral_code IS 'Stored for audit trail. Matches agents.agent_code.';
COMMENT ON COLUMN orders.commission_total IS 'Sum of commissions.amount_earned for this order. Denormalised for fast reporting.';
COMMENT ON COLUMN orders.payment_method IS 'mpesa: STK Push | cash_on_delivery: pay on arrival | card: Phase 2.';
COMMENT ON COLUMN orders.refund_status IS 'none: no refund | requested | approved | rejected | completed.';


-- ============================================================
-- ORDER ITEMS
-- Individual line items within an order
-- ============================================================

CREATE TABLE order_items (
    order_item_id   SERIAL PRIMARY KEY,
    order_id        INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    product_id      INTEGER NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
    category_id     INTEGER NOT NULL REFERENCES categories(category_id) ON DELETE RESTRICT,
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    unit_price      NUMERIC(10,2) NOT NULL CHECK (unit_price > 0),  -- price at time of order
    sale_price_applied NUMERIC(10,2),               -- if sale was active, record it here
    discount        NUMERIC(10,2) DEFAULT 0.00,
    subtotal        NUMERIC(10,2) NOT NULL           -- (unit_price * quantity) - discount
);

COMMENT ON TABLE  order_items IS 'Line items per order. category_id denormalised here for fast commission calculation.';
COMMENT ON COLUMN order_items.category_id IS 'Denormalised from products.category_id at time of order. Used for commission rate lookup.';
COMMENT ON COLUMN order_items.sale_price_applied IS 'Records the sale_price if the product was on sale at time of purchase.';
COMMENT ON COLUMN order_items.subtotal IS 'Pre-calculated: (unit_price * quantity) - discount.';


-- ============================================================
-- COMMISSIONS
-- Per order-item commission records.
-- Commission is CATEGORY-BASED: Accessories 8%, all others 2.5%.
-- One row per order_item — not per order.
-- ============================================================

CREATE TABLE commissions (
    commission_id   SERIAL PRIMARY KEY,
    agent_id        INTEGER NOT NULL REFERENCES agents(agent_id) ON DELETE RESTRICT,
    order_id        INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE RESTRICT,
    order_item_id   INTEGER NOT NULL REFERENCES order_items(order_item_id) ON DELETE RESTRICT,
    category_id     INTEGER NOT NULL REFERENCES categories(category_id) ON DELETE RESTRICT,
    item_subtotal   NUMERIC(10,2) NOT NULL,          -- the order_item subtotal commission was applied to
    rate_applied    NUMERIC(5,2) NOT NULL,            -- rate at time of order (from commission_rates)
    amount_earned   NUMERIC(10,2) NOT NULL,           -- item_subtotal * (rate_applied / 100)
    is_bonus        BOOLEAN DEFAULT FALSE,            -- TRUE only for manually-set bonus commissions
    notes           TEXT,                             -- admin notes (e.g. reason for manual bonus)
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  commissions IS 'Per-item commission records. Category-based: Accessories=8%, Electronics/others=2.5%.';
COMMENT ON COLUMN commissions.order_item_id IS 'One commission row per order_item — not one per order.';
COMMENT ON COLUMN commissions.rate_applied IS 'Rate locked at time of order. Changing commission_rates does not affect past commissions.';
COMMENT ON COLUMN commissions.amount_earned IS 'item_subtotal * (rate_applied / 100). Stored for reporting without recalculation.';
COMMENT ON COLUMN commissions.is_bonus IS 'Manual bonus commissions set by admin. Not auto-calculated.';


-- ============================================================
-- PAYMENTS
-- One payment record per order
-- ============================================================

CREATE TABLE payments (
    payment_id      SERIAL PRIMARY KEY,
    order_id        INTEGER UNIQUE NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    method          payment_method NOT NULL,
    amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    mpesa_code      VARCHAR(20),                     -- M-Pesa receipt number e.g. QGR9ABCDEF
    mpesa_phone     VARCHAR(13) CHECK (mpesa_phone ~ '^\+254[0-9]{9}$'),
    transaction_reference VARCHAR(100),
    is_confirmed    BOOLEAN DEFAULT FALSE,
    confirmed_at    TIMESTAMP WITH TIME ZONE,
    confirmed_by    INTEGER REFERENCES users(user_id) ON DELETE SET NULL, -- admin for COD
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  payments IS 'One payment record per order. M-Pesa confirmation auto via Daraja. COD confirmed manually by admin.';
COMMENT ON COLUMN payments.confirmed_by IS 'NULL for M-Pesa (auto). Admin user_id for Cash on Delivery manual confirmation.';


-- ============================================================
-- M-PESA TRANSACTIONS
-- STK Push transaction tracking (Daraja API)
-- ============================================================

CREATE TABLE mpesa_transactions (
    transaction_id          SERIAL PRIMARY KEY,
    order_id                INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    checkout_request_id     VARCHAR(100) UNIQUE NOT NULL,   -- from Daraja STK Push response
    merchant_request_id     VARCHAR(100) NOT NULL,
    phone_number            VARCHAR(15) NOT NULL,
    amount                  NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    mpesa_receipt_number    VARCHAR(50),                    -- e.g. QGR9ABCDEF (from callback)
    transaction_date        BIGINT,                         -- YYYYMMDDHHmmss format from Daraja
    status                  VARCHAR(20) DEFAULT 'pending'
                                CHECK (status IN ('pending','completed','failed','cancelled')),
    result_code             VARCHAR(10),
    result_desc             TEXT,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  mpesa_transactions IS 'M-Pesa STK Push transaction log. Updated by Daraja callback webhook.';
COMMENT ON COLUMN mpesa_transactions.checkout_request_id IS 'Unique Daraja identifier. Used to match callback to original request.';
COMMENT ON COLUMN mpesa_transactions.transaction_date IS 'Daraja timestamp in YYYYMMDDHHmmss format — convert when displaying.';


-- ============================================================
-- REVIEWS
-- Product reviews from verified buyers only
-- ============================================================

CREATE TABLE reviews (
    review_id       SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    product_id      INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    order_id        INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,  -- must have delivered order
    rating          INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment         TEXT,
    is_verified     BOOLEAN DEFAULT TRUE,            -- always true (only delivered buyers can review)
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_product_review UNIQUE (user_id, product_id)
);

COMMENT ON TABLE  reviews IS 'Product reviews. Only customers with a delivered order containing the product can review.';
COMMENT ON COLUMN reviews.order_id IS 'Enforces verified purchase. API checks order status = delivered before allowing submission.';


-- ============================================================
-- DELIVERY PRICING
-- Configurable delivery fees by city/area
-- ============================================================

CREATE TABLE delivery_pricing (
    rule_id             SERIAL PRIMARY KEY,
    city                VARCHAR(50) NOT NULL UNIQUE,
    standard_fee        NUMERIC(10,2) NOT NULL CHECK (standard_fee >= 0),
    min_free_delivery   NUMERIC(10,2) DEFAULT 0.00, -- order total above this = free delivery
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  delivery_pricing IS 'Delivery fee rules per city. Admin-configurable. min_free_delivery=0 means no free delivery threshold.';


-- ============================================================
-- ORDER STATUS HISTORY
-- Audit trail of every status change on every order
-- ============================================================

CREATE TABLE order_status_history (
    history_id      SERIAL PRIMARY KEY,
    order_id        INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    from_status     order_status,
    to_status       order_status NOT NULL,
    changed_by      INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    notes           TEXT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  order_status_history IS 'Immutable audit log of all order status changes. Used for dispute resolution.';


-- ============================================================
-- INDEXES
-- ============================================================

-- Users
CREATE INDEX idx_users_role          ON users(role);
CREATE INDEX idx_users_email         ON users(email);

-- Agents
CREATE INDEX idx_agents_code         ON agents(agent_code);
CREATE INDEX idx_agents_user         ON agents(user_id);
CREATE INDEX idx_agents_active       ON agents(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_agents_referral     ON agents(referral_link);

-- Products
CREATE INDEX idx_products_category   ON products(category_id);
CREATE INDEX idx_products_admin      ON products(created_by);
CREATE INDEX idx_products_active     ON products(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_products_condition  ON products(condition);
CREATE INDEX idx_products_on_sale    ON products(is_on_sale) WHERE is_on_sale = TRUE;
CREATE INDEX idx_products_title      ON products USING gin(title gin_trgm_ops); -- fast text search

-- Product images
CREATE INDEX idx_product_images_product ON product_images(product_id);
CREATE INDEX idx_product_images_primary ON product_images(product_id) WHERE is_primary = TRUE;

-- Carts
CREATE INDEX idx_carts_user          ON carts(user_id);
CREATE INDEX idx_carts_active        ON carts(user_id, status) WHERE status = 'active';

-- Cart items
CREATE INDEX idx_cart_items_cart     ON cart_items(cart_id);
CREATE INDEX idx_cart_items_product  ON cart_items(product_id);

-- Orders
CREATE INDEX idx_orders_user         ON orders(user_id);
CREATE INDEX idx_orders_agent        ON orders(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_orders_status       ON orders(status);
CREATE INDEX idx_orders_referral     ON orders(referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX idx_orders_created      ON orders(created_at DESC);
CREATE INDEX idx_orders_payment      ON orders(payment_method);

-- Order items
CREATE INDEX idx_order_items_order   ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
CREATE INDEX idx_order_items_category ON order_items(category_id);

-- Commissions
CREATE INDEX idx_commissions_agent   ON commissions(agent_id);
CREATE INDEX idx_commissions_order   ON commissions(order_id);
CREATE INDEX idx_commissions_item    ON commissions(order_item_id);
CREATE INDEX idx_commissions_created ON commissions(created_at DESC);

-- Commission rates
CREATE INDEX idx_commission_rates_category ON commission_rates(category_id);
CREATE INDEX idx_commission_rates_active   ON commission_rates(category_id) WHERE is_active = TRUE;

-- Payments
CREATE INDEX idx_payments_order      ON payments(order_id);

-- M-Pesa
CREATE INDEX idx_mpesa_checkout      ON mpesa_transactions(checkout_request_id);
CREATE INDEX idx_mpesa_order         ON mpesa_transactions(order_id);
CREATE INDEX idx_mpesa_status        ON mpesa_transactions(status);
CREATE INDEX idx_mpesa_status_date   ON mpesa_transactions(status, created_at DESC);
CREATE INDEX idx_mpesa_created       ON mpesa_transactions(created_at DESC);
CREATE INDEX idx_mpesa_phone         ON mpesa_transactions(phone_number);

-- Reviews
CREATE INDEX idx_reviews_product     ON reviews(product_id);
CREATE INDEX idx_reviews_user        ON reviews(user_id);
CREATE INDEX idx_reviews_order       ON reviews(order_id);

-- Order status history
CREATE INDEX idx_status_history_order ON order_status_history(order_id);
CREATE INDEX idx_status_history_date  ON order_status_history(created_at DESC);

-- Addresses
CREATE INDEX idx_addresses_user      ON addresses(user_id);
CREATE INDEX idx_addresses_default   ON addresses(user_id) WHERE is_default = TRUE;


-- ============================================================
-- SEED DATA
-- ============================================================

-- Categories
INSERT INTO categories (name, description, featured, icon_path, sort_order) VALUES
    ('Phones',           'Smartphones and feature phones',                   TRUE,  '/icons/phones.png',       1),
    ('Laptops',          'Laptops and notebooks',                            TRUE,  '/icons/laptops.png',      2),
    ('Accessories',      'Phone cases, chargers, cables, and peripherals',   TRUE,  '/icons/accessories.png',  3),
    ('Home Appliances',  'TVs, fridges, cookers, and sound systems',         TRUE,  '/icons/appliances.png',   4),
    ('Gaming',           'Consoles, controllers, and gaming accessories',    TRUE,  '/icons/gaming.png',       5),
    ('Audio & Sound',    'Wireless headphones, Bluetooth speakers, earbuds', TRUE,  '/icons/audio-sound.png',  6);

-- Commission rates (seeded after categories so we can reference category_id by name)
-- NOTE: requires at least one admin user to exist for set_by FK.
-- Run this INSERT after creating the first admin account, or use a placeholder:
-- INSERT INTO users (role, name, email, password_hash, verified, terms)
--     VALUES ('admin', 'TechWave Admin', 'admin@techwaveelectronics.co.ke', 'CHANGEME', TRUE, TRUE);

-- Then seed commission rates (replace 1 with actual admin user_id):
INSERT INTO commission_rates (category_id, rate_percent, set_by, notes)
SELECT category_id, 8.00, 1, 'Confirmed rate — Accessories (March 2026)'
FROM categories WHERE name = 'Accessories';

INSERT INTO commission_rates (category_id, rate_percent, set_by, notes)
SELECT category_id, 2.50, 1, 'Confirmed rate — Electronics/all other categories (March 2026)'
FROM categories WHERE name = 'Phones';

INSERT INTO commission_rates (category_id, rate_percent, set_by, notes)
SELECT category_id, 2.50, 1, 'Confirmed rate — Electronics/all other categories (March 2026)'
FROM categories WHERE name = 'Laptops';

INSERT INTO commission_rates (category_id, rate_percent, set_by, notes)
SELECT category_id, 2.50, 1, 'Confirmed rate — Electronics/all other categories (March 2026)'
FROM categories WHERE name = 'Home Appliances';

INSERT INTO commission_rates (category_id, rate_percent, set_by, notes)
SELECT category_id, 2.50, 1, 'Confirmed rate — Electronics/all other categories (March 2026)'
FROM categories WHERE name = 'Gaming';

INSERT INTO commission_rates (category_id, rate_percent, set_by, notes)
SELECT category_id, 2.50, 1, 'Confirmed rate — Electronics/all other categories (March 2026)'
FROM categories WHERE name = 'Audio & Sound';


-- ============================================================
-- USEFUL FUNCTIONS
-- ============================================================

-- Auto-update updated_at on any table that has it
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to all tables with updated_at
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_carts_updated_at
    BEFORE UPDATE ON carts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_mpesa_updated_at
    BEFORE UPDATE ON mpesa_transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Recalculate product average rating when a review is added or deleted
CREATE OR REPLACE FUNCTION refresh_product_rating()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE products
    SET
        rating = (
            SELECT COALESCE(ROUND(AVG(rating)::NUMERIC, 2), 0.00)
            FROM reviews
            WHERE product_id = COALESCE(NEW.product_id, OLD.product_id)
        ),
        review_count = (
            SELECT COUNT(*)
            FROM reviews
            WHERE product_id = COALESCE(NEW.product_id, OLD.product_id)
        ),
        updated_at = CURRENT_TIMESTAMP
    WHERE product_id = COALESCE(NEW.product_id, OLD.product_id);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_refresh_rating_insert
    AFTER INSERT ON reviews
    FOR EACH ROW EXECUTE FUNCTION refresh_product_rating();

CREATE TRIGGER trg_refresh_rating_delete
    AFTER DELETE ON reviews
    FOR EACH ROW EXECUTE FUNCTION refresh_product_rating();

-- Log every order status change automatically
CREATE OR REPLACE FUNCTION log_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO order_status_history (order_id, from_status, to_status)
        VALUES (NEW.order_id, OLD.status, NEW.status);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_status_history
    AFTER UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION log_order_status_change();


-- ============================================================
-- M-PESA TRANSACTION FUNCTIONS (carried over from v1.0)
-- ============================================================

-- Get full transaction details by transaction_id
CREATE OR REPLACE FUNCTION get_transaction_details(p_transaction_id INTEGER)
RETURNS TABLE(
    transaction_id          INTEGER,
    order_id                INTEGER,
    phone_number            VARCHAR,
    amount                  NUMERIC,
    status                  VARCHAR,
    mpesa_receipt_number    VARCHAR,
    result_code             VARCHAR,
    result_desc             TEXT,
    created_at              TIMESTAMP WITH TIME ZONE,
    time_pending            INTERVAL
) AS $$
SELECT
    t.transaction_id, t.order_id, t.phone_number, t.amount, t.status,
    t.mpesa_receipt_number, t.result_code, t.result_desc,
    t.created_at, NOW() - t.created_at AS time_pending
FROM mpesa_transactions t
WHERE t.transaction_id = p_transaction_id;
$$ LANGUAGE SQL STABLE;

-- Update transaction status from Daraja callback
CREATE OR REPLACE FUNCTION update_transaction_status(
    p_checkout_request_id   VARCHAR,
    p_status                VARCHAR,
    p_mpesa_receipt         VARCHAR DEFAULT NULL,
    p_result_code           VARCHAR DEFAULT NULL,
    p_result_desc           TEXT    DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message VARCHAR, transaction_id INTEGER) AS $$
DECLARE
    v_transaction_id INTEGER;
BEGIN
    UPDATE mpesa_transactions
    SET
        status               = p_status,
        mpesa_receipt_number = COALESCE(p_mpesa_receipt, mpesa_receipt_number),
        result_code          = COALESCE(p_result_code,   result_code),
        result_desc          = COALESCE(p_result_desc,   result_desc),
        updated_at           = CURRENT_TIMESTAMP
    WHERE checkout_request_id = p_checkout_request_id
    RETURNING transaction_id INTO v_transaction_id;

    IF v_transaction_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Transaction not found'::VARCHAR, NULL::INTEGER;
    ELSE
        RETURN QUERY SELECT TRUE, 'Updated successfully'::VARCHAR, v_transaction_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Count pending transactions (monitoring)
CREATE OR REPLACE FUNCTION count_pending_transactions()
RETURNS TABLE(
    pending_count           INTEGER,
    total_pending_amount    NUMERIC,
    oldest_pending_age      INTERVAL
) AS $$
SELECT COUNT(*)::INTEGER, SUM(amount), NOW() - MIN(created_at)
FROM mpesa_transactions
WHERE status = 'pending';
$$ LANGUAGE SQL STABLE;

-- Auto-fail stale pending M-Pesa transactions (run via cron or pg_cron)
CREATE OR REPLACE FUNCTION timeout_stale_mpesa_transactions()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE mpesa_transactions
    SET
        status      = 'failed',
        result_code = 'TIMEOUT',
        result_desc = 'Transaction timeout — no response from M-Pesa within 30 minutes',
        updated_at  = CURRENT_TIMESTAMP
    WHERE status    = 'pending'
      AND created_at < NOW() - INTERVAL '30 minutes';

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- MAINTENANCE HELPERS
-- ============================================================

-- Archive M-Pesa transactions older than 90 days (run periodically)
CREATE TABLE IF NOT EXISTS mpesa_transactions_archive
    (LIKE mpesa_transactions INCLUDING ALL);

COMMENT ON TABLE mpesa_transactions_archive IS 'Archive of M-Pesa transactions older than 90 days. Moved here for performance.';

-- Verify referential integrity across agents and orders
CREATE OR REPLACE VIEW v_agent_commission_summary AS
SELECT
    a.agent_id,
    a.agent_code,
    a.full_name,
    a.is_active,
    COUNT(DISTINCT c.order_id)                          AS total_orders,
    COALESCE(SUM(c.amount_earned), 0.00)                AS total_commission,
    COALESCE(SUM(CASE WHEN cat.name = 'Accessories'
                 THEN c.amount_earned ELSE 0 END), 0.00) AS accessories_commission,
    COALESCE(SUM(CASE WHEN cat.name != 'Accessories'
                 THEN c.amount_earned ELSE 0 END), 0.00) AS electronics_commission,
    COUNT(DISTINCT o.user_id)                           AS unique_customers,
    COALESCE(SUM(o.total_amount), 0.00)                 AS total_revenue_generated
FROM agents a
LEFT JOIN commissions c      ON c.agent_id   = a.agent_id AND c.is_bonus = FALSE
LEFT JOIN categories cat     ON cat.category_id = c.category_id
LEFT JOIN orders o           ON o.agent_id   = a.agent_id
GROUP BY a.agent_id, a.agent_code, a.full_name, a.is_active;

COMMENT ON VIEW v_agent_commission_summary IS 'Pre-built agent performance view. Used by admin commission report and agent leaderboard.';

-- Analytics: daily revenue summary
CREATE OR REPLACE VIEW v_daily_revenue AS
SELECT
    DATE(o.created_at)                                  AS order_date,
    COUNT(*)                                            AS total_orders,
    SUM(o.total_amount)                                 AS gross_revenue,
    COUNT(CASE WHEN o.payment_method = 'mpesa'
               THEN 1 END)                              AS mpesa_orders,
    COUNT(CASE WHEN o.payment_method = 'cash_on_delivery'
               THEN 1 END)                              AS cod_orders,
    COUNT(CASE WHEN o.agent_id IS NOT NULL
               THEN 1 END)                              AS agent_referred_orders,
    SUM(CASE WHEN o.agent_id IS NOT NULL
             THEN o.commission_total ELSE 0 END)        AS total_commissions_paid
FROM orders o
WHERE o.status NOT IN ('cancelled', 'failed')
GROUP BY DATE(o.created_at)
ORDER BY order_date DESC;

COMMENT ON VIEW v_daily_revenue IS 'Daily revenue summary for analytics dashboard. Excludes cancelled and failed orders.';


-- ============================================================
-- END OF SCHEMA
-- TechWave Electronics Kenya — Database Schema v2.0
-- All confirmed decisions as of March 2026
-- ============================================================