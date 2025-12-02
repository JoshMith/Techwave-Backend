-- Create enum types for fixed-value fields
CREATE TYPE user_role AS ENUM ('customer', 'seller', 'admin');
CREATE TYPE order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled');
CREATE TYPE payment_method AS ENUM ('mpesa', 'card', 'cash_on_delivery');
CREATE TYPE cart_status AS ENUM ('active', 'abandoned', 'converted');

-- Users table (base for all accounts)
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    role user_role NOT NULL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(13) UNIQUE CHECK (phone LIKE '+254%'),
    verified BOOLEAN DEFAULT false,
    password_hash VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users
ADD COLUMN last_login TIMESTAMP WITH TIME ZONE,
ADD COLUMN terms BOOLEAN DEFAULT false,
ADD COLUMN newsletter BOOLEAN DEFAULT false;

-- Sellers table (extends users)
CREATE TABLE sellers (
    seller_id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    business_name VARCHAR(100) NOT NULL,
    tax_id VARCHAR(50),
    business_license VARCHAR(100),
    total_sales NUMERIC(12, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Shopping carts table
CREATE TABLE carts (
    cart_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
    session_id VARCHAR(100),
    status cart_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT cart_owner CHECK (
        (user_id IS NOT NULL AND session_id IS NULL) OR
        (user_id IS NULL AND session_id IS NOT NULL)
    )
);

-- User addresses
CREATE TABLE addresses (
    address_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    city VARCHAR(50) NOT NULL,
    street VARCHAR(255) NOT NULL,
    building VARCHAR(50),
    postal_code VARCHAR(20),
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Product categories
CREATE TABLE categories (
    category_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    featured BOOLEAN DEFAULT false,
    icon_path VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Products
CREATE TABLE products (
    product_id SERIAL PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES sellers(seller_id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(category_id) ON DELETE RESTRICT,
    title VARCHAR(100) NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL CHECK (price > 0),
    sale_price NUMERIC(10, 2) CHECK (sale_price > 0),
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    specs JSONB,
    rating NUMERIC(3, 2) DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
    review_count INTEGER DEFAULT 0 CHECK (review_count >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Product images
CREATE TABLE product_images (
    image_id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    image_url VARCHAR(255) NOT NULL,
    alt_text VARCHAR(100),
    is_primary BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0
);

-- Cart items table
CREATE TABLE cart_items (
    cart_item_id SERIAL PRIMARY KEY,
    cart_id INTEGER NOT NULL REFERENCES carts(cart_id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price > 0),
    UNIQUE (cart_id, product_id)
);

-- Orders
CREATE TABLE orders (
    order_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    cart_id INTEGER REFERENCES carts(cart_id),
    address_id INTEGER NOT NULL REFERENCES addresses(address_id) ON DELETE RESTRICT,
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount > 0),
    status order_status NOT NULL DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'failed';

-- Order items
CREATE TABLE order_items (
    order_item_id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price > 0),
    discount NUMERIC(10, 2) DEFAULT 0
);

    -- Payments
    CREATE TABLE payments (
        payment_id SERIAL PRIMARY KEY,
        order_id INTEGER UNIQUE NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
        method payment_method NOT NULL,
        amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
        mpesa_code VARCHAR(20),
        mpesa_phone VARCHAR(13) CHECK (mpesa_phone LIKE '+254%'),
        transaction_reference VARCHAR(100),
        is_confirmed BOOLEAN DEFAULT false,
        confirmed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'cash';


-- Reviews
CREATE TABLE reviews (
    review_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_product_review UNIQUE (user_id, product_id)
);

-- Delivery pricing rules
CREATE TABLE delivery_pricing (
    rule_id SERIAL PRIMARY KEY,
    city VARCHAR(50) NOT NULL,
    min_free_delivery NUMERIC(10, 2) DEFAULT 0,
    standard_fee NUMERIC(10, 2) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (city)
);

-- Special offers
CREATE TABLE special_offers (
    offer_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(100) NOT NULL,
    description TEXT,
    discount_type VARCHAR(20) CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value NUMERIC(10, 2) CHECK (discount_value > 0),
    discount_percent NUMERIC(5, 2) CHECK (discount_percent > 0 AND discount_percent <= 100),
    banner_image_url VARCHAR(255),
    valid_from TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    valid_until TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Product-offer relationship
CREATE TABLE product_offers (
    product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    offer_id INTEGER NOT NULL REFERENCES special_offers(offer_id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, offer_id)
);

-- Create indexes for performance
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_seller ON products(seller_id);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_reviews_product ON reviews(product_id);
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_carts_user ON carts(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_carts_session ON carts(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_cart_items_cart ON cart_items(cart_id);
CREATE INDEX idx_cart_items_product ON cart_items(product_id);