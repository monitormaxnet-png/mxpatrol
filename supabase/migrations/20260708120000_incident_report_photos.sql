create table if not exists public.incident_report_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  site_id uuid references public.sites(id),
  device_identifier text not null,
  gps_lat double precision,
  gps_lng double precision,
  gps_accuracy double precision,
  captured_at timestamptz not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_incident_report_photos_company_time
on public.incident_report_photos(company_id, captured_at desc);

create index if not exists idx_incident_report_photos_site_time
on public.incident_report_photos(site_id, captured_at desc)
where site_id is not null;

insert into storage.buckets (id, name, public)
values ('incident-reports', 'incident-reports', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
