-- Extend the portal schema for payment lifecycle tracking and MAC/phone-based device binding.

ALTER TABLE IF EXISTS payments
  ADD COLUMN IF NOT EXISTS package_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS ip TEXT,
  ADD COLUMN IF NOT EXISTS mac TEXT,
  ADD COLUMN IF NOT EXISTS mpesa_code TEXT,
  ADD COLUMN IF NOT EXISTS paystack_reference TEXT,
  ADD COLUMN IF NOT EXISTS paystack_authorization_url TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS created_at BIGINT,
  ADD COLUMN IF NOT EXISTS paid_at BIGINT,
  ADD COLUMN IF NOT EXISTS rejected_at BIGINT,
  ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE IF EXISTS pending_payments
  ADD COLUMN IF NOT EXISTS package_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS ip TEXT,
  ADD COLUMN IF NOT EXISTS mac TEXT,
  ADD COLUMN IF NOT EXISTS mpesa_code TEXT,
  ADD COLUMN IF NOT EXISTS paystack_reference TEXT,
  ADD COLUMN IF NOT EXISTS paystack_authorization_url TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS created_at BIGINT,
  ADD COLUMN IF NOT EXISTS expires_at BIGINT,
  ADD COLUMN IF NOT EXISTS paid_at BIGINT,
  ADD COLUMN IF NOT EXISTS rejected_at BIGINT,
  ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE IF EXISTS authorized_devices
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS mac TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT;

CREATE INDEX IF NOT EXISTS payments_phone_idx ON payments (phone);
CREATE INDEX IF NOT EXISTS payments_mac_idx ON payments (mac);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status);
CREATE INDEX IF NOT EXISTS payments_created_at_idx ON payments (created_at DESC);

CREATE INDEX IF NOT EXISTS pending_payments_phone_idx ON pending_payments (phone);
CREATE INDEX IF NOT EXISTS pending_payments_mac_idx ON pending_payments (mac);
CREATE INDEX IF NOT EXISTS pending_payments_status_idx ON pending_payments (status);
CREATE INDEX IF NOT EXISTS pending_payments_created_at_idx ON pending_payments (created_at DESC);

CREATE INDEX IF NOT EXISTS authorized_devices_phone_idx ON authorized_devices (phone);
CREATE INDEX IF NOT EXISTS authorized_devices_mac_idx ON authorized_devices (mac);
CREATE INDEX IF NOT EXISTS authorized_devices_package_id_idx ON authorized_devices (package_id);
CREATE INDEX IF NOT EXISTS authorized_devices_expires_at_idx ON authorized_devices (expires_at DESC);
