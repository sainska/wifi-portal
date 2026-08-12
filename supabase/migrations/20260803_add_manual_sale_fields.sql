-- Migration: add manual sale / audit fields and RLS policy for payments
-- Created: 2026-08-03

BEGIN;

-- Add manual-sale / audit fields to payments
ALTER TABLE IF EXISTS public.payments
  ADD COLUMN IF NOT EXISTS authorized_by TEXT,
  ADD COLUMN IF NOT EXISTS authorized_at BIGINT,
  ADD COLUMN IF NOT EXISTS is_manual BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT;

CREATE INDEX IF NOT EXISTS payments_authorized_at_idx ON public.payments (authorized_at DESC);
CREATE INDEX IF NOT EXISTS payments_is_manual_idx ON public.payments (is_manual);
CREATE INDEX IF NOT EXISTS payments_phone_idx ON public.payments (phone);
CREATE INDEX IF NOT EXISTS payments_ip_idx ON public.payments (ip);
CREATE INDEX IF NOT EXISTS payments_mac_idx ON public.payments (mac);
CREATE INDEX IF NOT EXISTS payments_package_name_idx ON public.payments (package_name);
CREATE INDEX IF NOT EXISTS payments_transaction_id_idx ON public.payments (transaction_id);
CREATE INDEX IF NOT EXISTS payments_source_idx ON public.payments (source);

-- Add complementary fields to pending_payments
ALTER TABLE IF EXISTS public.pending_payments
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS transaction_id TEXT;

CREATE INDEX IF NOT EXISTS pending_payments_phone_idx ON public.pending_payments (phone);
CREATE INDEX IF NOT EXISTS pending_payments_ip_idx ON public.pending_payments (ip);
CREATE INDEX IF NOT EXISTS pending_payments_mac_idx ON public.pending_payments (mac);
CREATE INDEX IF NOT EXISTS pending_payments_package_id_idx ON public.pending_payments (package_id);
CREATE INDEX IF NOT EXISTS pending_payments_transaction_id_idx ON public.pending_payments (transaction_id);
CREATE INDEX IF NOT EXISTS pending_payments_source_idx ON public.pending_payments (source);

-- Enable RLS on payments and add a server-only policy (idempotent)
ALTER TABLE IF EXISTS public.payments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p
    JOIN pg_class c ON p.polrelid = c.oid
    WHERE p.polname = 'payments_service_role_manage' AND c.relname = 'payments'
  ) THEN
    CREATE POLICY payments_service_role_manage
      ON public.payments
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

COMMIT;
