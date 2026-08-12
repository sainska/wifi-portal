-- Automatically transition pending payments from Paystack lifecycle events.
-- This keeps the pending-payments table and payments table aligned without requiring admin confirmation/rejection.

ALTER TABLE IF EXISTS payments
  ADD COLUMN IF NOT EXISTS transaction_id TEXT;

ALTER TABLE IF EXISTS pending_payments
  ADD COLUMN IF NOT EXISTS transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS paid_at BIGINT,
  ADD COLUMN IF NOT EXISTS rejected_at BIGINT,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS package_name TEXT;

CREATE OR REPLACE FUNCTION public.sync_pending_payment_from_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'paid' THEN
    INSERT INTO public.pending_payments (
      checkout_id,
      package_id,
      package_name,
      amount,
      phone,
      ip,
      mac,
      status,
      created_at,
      expires_at,
      mpesa_code,
      paystack_reference,
      transaction_id,
      paid_at,
      source
    )
    VALUES (
      NEW.checkout_id,
      NEW.package_id,
      NEW.package_name,
      NEW.amount,
      NEW.phone,
      NEW.ip,
      NEW.mac,
      'paid',
      COALESCE(NEW.created_at, EXTRACT(EPOCH FROM NOW()) * 1000),
      COALESCE(NEW.created_at, EXTRACT(EPOCH FROM NOW()) * 1000) + 1800000,
      NEW.mpesa_code,
      NEW.paystack_reference,
      NEW.transaction_id,
      COALESCE(NEW.paid_at, EXTRACT(EPOCH FROM NOW()) * 1000),
      NEW.source
    )
    ON CONFLICT (checkout_id) DO UPDATE SET
      package_id = EXCLUDED.package_id,
      package_name = EXCLUDED.package_name,
      amount = EXCLUDED.amount,
      phone = EXCLUDED.phone,
      ip = EXCLUDED.ip,
      mac = EXCLUDED.mac,
      status = 'paid',
      expires_at = COALESCE(public.pending_payments.expires_at, EXCLUDED.created_at + 1800000),
      mpesa_code = EXCLUDED.mpesa_code,
      paystack_reference = EXCLUDED.paystack_reference,
      transaction_id = EXCLUDED.transaction_id,
      paid_at = EXCLUDED.paid_at,
      source = EXCLUDED.source;
  ELSIF NEW.status = 'failed' OR NEW.status = 'rejected' THEN
    INSERT INTO public.pending_payments (
      checkout_id,
      package_id,
      package_name,
      amount,
      phone,
      ip,
      mac,
      status,
      created_at,
      expires_at,
      mpesa_code,
      paystack_reference,
      transaction_id,
      rejected_at,
      source
    )
    VALUES (
      NEW.checkout_id,
      NEW.package_id,
      NEW.package_name,
      NEW.amount,
      NEW.phone,
      NEW.ip,
      NEW.mac,
      NEW.status,
      COALESCE(NEW.created_at, EXTRACT(EPOCH FROM NOW()) * 1000),
      COALESCE(NEW.created_at, EXTRACT(EPOCH FROM NOW()) * 1000) + 1800000,
      NEW.mpesa_code,
      NEW.paystack_reference,
      NEW.transaction_id,
      COALESCE(NEW.rejected_at, EXTRACT(EPOCH FROM NOW()) * 1000),
      NEW.source
    )
    ON CONFLICT (checkout_id) DO UPDATE SET
      status = EXCLUDED.status,
      rejected_at = EXCLUDED.rejected_at,
      source = EXCLUDED.source;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_auto_sync_pending
AFTER INSERT OR UPDATE OF status, paid_at, rejected_at, transaction_id, paystack_reference, package_id, package_name, amount, phone, ip, mac, mpesa_code, source
ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.sync_pending_payment_from_event();

CREATE INDEX IF NOT EXISTS payments_transaction_id_idx ON payments (transaction_id);
CREATE INDEX IF NOT EXISTS pending_payments_transaction_id_idx ON pending_payments (transaction_id);
