-- Add missing portal columns to match current app service expectations
ALTER TABLE IF EXISTS payments
  ADD COLUMN IF NOT EXISTS mac TEXT,
  ADD COLUMN IF NOT EXISTS paystack_authorization_url TEXT,
  ADD COLUMN IF NOT EXISTS transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS expires_at BIGINT;

ALTER TABLE IF EXISTS pending_payments
  ADD COLUMN IF NOT EXISTS mac TEXT,
  ADD COLUMN IF NOT EXISTS paystack_authorization_url TEXT,
  ADD COLUMN IF NOT EXISTS transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS paid_at BIGINT,
  ADD COLUMN IF NOT EXISTS rejected_at BIGINT,
  ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE IF EXISTS authorized_devices
  ADD COLUMN IF NOT EXISTS mac TEXT,
  ADD COLUMN IF NOT EXISTS transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS device_name TEXT,
  ADD COLUMN IF NOT EXISTS purchased_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000;

ALTER TABLE IF EXISTS used_codes
  ADD COLUMN IF NOT EXISTS mac TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS transaction_id TEXT;

ALTER TABLE IF EXISTS voucher_redemptions
  ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE IF EXISTS mpesa_code_connections
  ADD COLUMN IF NOT EXISTS phone TEXT;

-- Create indexes for the newly-added fields
CREATE INDEX IF NOT EXISTS payments_mac_idx ON payments (mac);
CREATE INDEX IF NOT EXISTS pending_payments_mac_idx ON pending_payments (mac);
CREATE INDEX IF NOT EXISTS authorized_devices_mac_idx ON authorized_devices (mac);
CREATE INDEX IF NOT EXISTS payments_transaction_id_idx ON payments (transaction_id);
CREATE INDEX IF NOT EXISTS pending_payments_transaction_id_idx ON pending_payments (transaction_id);
CREATE INDEX IF NOT EXISTS authorized_devices_package_id_idx ON authorized_devices (package_id);

-- Ensure RLS is enabled on portal tables
ALTER TABLE IF EXISTS payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS pending_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS authorized_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS used_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS voucher_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS mpesa_code_connections ENABLE ROW LEVEL SECURITY;

-- Add permissive read policies for the admin dashboard client using anon key
DROP POLICY IF EXISTS anon_select_payments ON public.payments;
CREATE POLICY anon_select_payments ON public.payments
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS anon_select_pending_payments ON public.pending_payments;
CREATE POLICY anon_select_pending_payments ON public.pending_payments
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS anon_select_authorized_devices ON public.authorized_devices;
CREATE POLICY anon_select_authorized_devices ON public.authorized_devices
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS anon_select_used_codes ON public.used_codes;
CREATE POLICY anon_select_used_codes ON public.used_codes
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS anon_select_voucher_redemptions ON public.voucher_redemptions;
CREATE POLICY anon_select_voucher_redemptions ON public.voucher_redemptions
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS anon_select_mpesa_code_connections ON public.mpesa_code_connections;
CREATE POLICY anon_select_mpesa_code_connections ON public.mpesa_code_connections
  FOR SELECT TO public USING (true);

GRANT SELECT ON public.payments, public.pending_payments, public.authorized_devices,
  public.used_codes, public.voucher_redemptions, public.mpesa_code_connections TO public;

CREATE VIEW IF NOT EXISTS public.admin_dashboard_summary AS
SELECT
  (SELECT COUNT(*) FROM public.authorized_devices WHERE expires_at > EXTRACT(EPOCH FROM NOW()) * 1000) AS active_devices,
  (SELECT COUNT(*) FROM public.pending_payments WHERE status = 'pending') AS pending_payments,
  (SELECT COUNT(*) FROM public.payments WHERE status = 'paid') AS total_paid_transactions,
  COALESCE((SELECT SUM(amount) FROM public.payments WHERE status = 'paid'), 0) AS revenue_total,
  COALESCE((SELECT SUM(amount) FROM public.payments WHERE status = 'paid' AND to_timestamp(paid_at / 1000) >= date_trunc('day', now())), 0) AS revenue_today,
  (SELECT COUNT(*) FROM public.payments WHERE status = 'paid' AND to_timestamp(paid_at / 1000) >= date_trunc('day', now())) AS payments_today,
  (SELECT COUNT(*) FROM public.used_codes) AS total_used_codes,
  (SELECT COUNT(*) FROM public.voucher_redemptions) AS total_voucher_redemptions,
  (SELECT COUNT(*) FROM public.mpesa_code_connections) AS total_mpesa_connections;

GRANT SELECT ON public.admin_dashboard_summary TO public;
