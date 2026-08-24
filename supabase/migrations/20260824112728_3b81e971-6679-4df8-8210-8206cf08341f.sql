CREATE TABLE public.device_pairing_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pairing_code text NOT NULL,
  device_identifier text NOT NULL,
  device_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '30 minutes'),
  claimed_at timestamp with time zone,
  claimed_device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
  claimed_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX device_pairing_requests_active_code_idx
  ON public.device_pairing_requests (pairing_code)
  WHERE status = 'pending';

CREATE UNIQUE INDEX device_pairing_requests_active_device_idx
  ON public.device_pairing_requests (device_identifier)
  WHERE status = 'pending';

GRANT SELECT ON public.device_pairing_requests TO authenticated;
GRANT ALL ON public.device_pairing_requests TO service_role;

ALTER TABLE public.device_pairing_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can view claimed pairing requests for their company"
ON public.device_pairing_requests
FOR SELECT
TO authenticated
USING (
  claimed_company_id IS NOT NULL
  AND claimed_company_id = public.get_user_company_id(auth.uid())
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
);

CREATE TRIGGER trg_device_pairing_requests_updated_at
BEFORE UPDATE ON public.device_pairing_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();