-- Supabase schema for WiFi portal payment tracking and admin data

-- Payment log entries for completed and pending payments
CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  checkout_id TEXT,
  package_id TEXT,
  package_name TEXT,
  amount NUMERIC,
  phone TEXT,
  ip TEXT,
  mac TEXT,
  mpesa_code TEXT,
  paystack_reference TEXT,
  paystack_authorization_url TEXT,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  paid_at BIGINT,
  rejected_at BIGINT,
  expires_at BIGINT,
  source TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_checkout_id_idx ON payments (checkout_id);

-- Pending payments waiting for confirmation
CREATE TABLE IF NOT EXISTS pending_payments (
  checkout_id TEXT PRIMARY KEY,
  package_id TEXT,
  package_name TEXT,
  amount NUMERIC,
  phone TEXT,
  ip TEXT,
  mac TEXT,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  paid_at BIGINT,
  rejected_at BIGINT,
  mpesa_code TEXT,
  paystack_reference TEXT,
  paystack_authorization_url TEXT,
  source TEXT
);

-- Used M-Pesa codes to prevent reuse
CREATE TABLE IF NOT EXISTS used_codes (
  code TEXT PRIMARY KEY,
  package_id TEXT,
  ip TEXT,
  used_at BIGINT NOT NULL,
  meta JSONB
);

-- Authorized devices currently allowed through the portal
CREATE TABLE IF NOT EXISTS authorized_devices (
  ip TEXT PRIMARY KEY,
  package_id TEXT,
  authorized_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  phone TEXT,
  amount NUMERIC,
  source TEXT,
  mac TEXT,
  device_name TEXT,
  purchased_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

-- Optional indexes for faster admin queries
CREATE INDEX IF NOT EXISTS payments_created_at_idx ON payments (created_at DESC);
CREATE INDEX IF NOT EXISTS pending_payments_created_at_idx ON pending_payments (created_at DESC);
CREATE INDEX IF NOT EXISTS authorized_devices_expires_at_idx ON authorized_devices (expires_at DESC);
