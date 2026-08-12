-- Supabase migration to add Paystack reference columns

ALTER TABLE IF EXISTS payments
  ADD COLUMN IF NOT EXISTS paystack_reference TEXT;

ALTER TABLE IF EXISTS pending_payments
  ADD COLUMN IF NOT EXISTS paystack_reference TEXT;

ALTER TABLE IF EXISTS payments
  ADD COLUMN IF NOT EXISTS paystack_authorization_url TEXT;

ALTER TABLE IF EXISTS pending_payments
  ADD COLUMN IF NOT EXISTS paystack_authorization_url TEXT;

ALTER TABLE IF EXISTS payments
  ADD COLUMN IF NOT EXISTS mac TEXT;

ALTER TABLE IF EXISTS pending_payments
  ADD COLUMN IF NOT EXISTS mac TEXT;

ALTER TABLE IF EXISTS authorized_devices
  ADD COLUMN IF NOT EXISTS mac TEXT;
