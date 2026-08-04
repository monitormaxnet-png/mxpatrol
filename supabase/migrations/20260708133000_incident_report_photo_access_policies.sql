alter table public.incident_report_photos enable row level security;

drop policy if exists "Company members can view incident report photos" on public.incident_report_photos;
create policy "Company members can view incident report photos"
on public.incident_report_photos
for select
to authenticated
using (company_id = public.get_user_company_id(auth.uid()));

drop policy if exists "Company members can create incident report photos" on public.incident_report_photos;
create policy "Company members can create incident report photos"
on public.incident_report_photos
for insert
to authenticated
with check (company_id = public.get_user_company_id(auth.uid()));

drop policy if exists "Company members can view incident report photo objects" on storage.objects;
create policy "Company members can view incident report photo objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'incident-reports'
  and split_part(name, '/', 1) = public.get_user_company_id(auth.uid())::text
);

drop policy if exists "Company members can upload incident report photo objects" on storage.objects;
create policy "Company members can upload incident report photo objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'incident-reports'
  and split_part(name, '/', 1) = public.get_user_company_id(auth.uid())::text
);

notify pgrst, 'reload schema';
