-- Enable Supabase Realtime for the portal tables so the admin dashboard updates immediately
-- when payments, pending sessions, authorized devices, or used codes change.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payments') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pending_payments') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_payments;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'authorized_devices') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.authorized_devices;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'used_codes') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.used_codes;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'voucher_redemptions') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.voucher_redemptions;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'mpesa_code_connections') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.mpesa_code_connections;
    END IF;
  END IF;
END $$;
