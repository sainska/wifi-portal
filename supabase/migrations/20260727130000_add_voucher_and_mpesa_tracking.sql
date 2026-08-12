-- Track voucher redemptions and M-Pesa-code based connections for the portal login flow.

CREATE TABLE IF NOT EXISTS voucher_redemptions (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  package_id TEXT,
  ip TEXT,
  mac TEXT,
  phone TEXT,
  used_at BIGINT NOT NULL,
  expires_at BIGINT,
  source TEXT DEFAULT 'voucher'
);

CREATE INDEX IF NOT EXISTS voucher_redemptions_code_idx ON voucher_redemptions (code);
CREATE INDEX IF NOT EXISTS voucher_redemptions_used_at_idx ON voucher_redemptions (used_at DESC);

CREATE TABLE IF NOT EXISTS mpesa_code_connections (
  id BIGSERIAL PRIMARY KEY,
  checkout_id TEXT,
  code TEXT NOT NULL,
  package_id TEXT,
  ip TEXT,
  mac TEXT,
  phone TEXT,
  created_at BIGINT NOT NULL,
  expires_at BIGINT,
  source TEXT DEFAULT 'mpesa_code'
);

CREATE INDEX IF NOT EXISTS mpesa_code_connections_code_idx ON mpesa_code_connections (code);
CREATE INDEX IF NOT EXISTS mpesa_code_connections_checkout_id_idx ON mpesa_code_connections (checkout_id);
CREATE INDEX IF NOT EXISTS mpesa_code_connections_created_at_idx ON mpesa_code_connections (created_at DESC);
