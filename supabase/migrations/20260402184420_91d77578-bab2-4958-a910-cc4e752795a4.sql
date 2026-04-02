
-- Add verification_level to patrols (standard = NFC+GPS only, enhanced = NFC+GPS+Face)
ALTER TABLE public.patrols ADD COLUMN IF NOT EXISTS verification_level text NOT NULL DEFAULT 'standard';

-- Add face verification tracking to scan_logs
ALTER TABLE public.scan_logs ADD COLUMN IF NOT EXISTS face_verified boolean DEFAULT NULL;
ALTER TABLE public.scan_logs ADD COLUMN IF NOT EXISTS face_confidence numeric DEFAULT NULL;

-- Add reference photo URL to guards table
ALTER TABLE public.guards ADD COLUMN IF NOT EXISTS photo_url text DEFAULT NULL;

-- Create storage bucket for guard photos
INSERT INTO storage.buckets (id, name, public) VALUES ('guard-photos', 'guard-photos', false)
ON CONFLICT (id) DO NOTHING;

-- RLS for guard-photos bucket: company members can view, admins/supervisors can upload
CREATE POLICY "Company members can view guard photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'guard-photos');

CREATE POLICY "Admins/supervisors can upload guard photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'guard-photos' AND
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'supervisor'))
  );

CREATE POLICY "Admins/supervisors can update guard photos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'guard-photos' AND
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'supervisor'))
  );

CREATE POLICY "Admins/supervisors can delete guard photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'guard-photos' AND
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'supervisor'))
  );
