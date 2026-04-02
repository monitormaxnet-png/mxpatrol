
-- Add new columns for enhanced device management
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS device_type text NOT NULL DEFAULT 'mobile',
  ADD COLUMN IF NOT EXISTS serial_number text,
  ADD COLUMN IF NOT EXISTS site_location text,
  ADD COLUMN IF NOT EXISTS pairing_code text,
  ADD COLUMN IF NOT EXISTS pairing_status text NOT NULL DEFAULT 'unpaired',
  ADD COLUMN IF NOT EXISTS pairing_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS registration_date timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS notes text;

-- Create unique index on pairing_code (only non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS devices_pairing_code_unique ON public.devices (pairing_code) WHERE pairing_code IS NOT NULL;

-- Create index for filtering
CREATE INDEX IF NOT EXISTS devices_device_type_idx ON public.devices (device_type);
CREATE INDEX IF NOT EXISTS devices_pairing_status_idx ON public.devices (pairing_status);

-- Enable realtime for devices
ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
