alter table public.incident_report_photos
  add column if not exists media_type text not null default 'photo',
  add column if not exists content_type text,
  add column if not exists filename text,
  add column if not exists duration_seconds integer;

alter table public.incident_report_photos
  drop constraint if exists incident_report_photos_media_type_check;

alter table public.incident_report_photos
  add constraint incident_report_photos_media_type_check
  check (media_type in ('photo', 'audio'));

create index if not exists idx_incident_report_photos_media_type_time
on public.incident_report_photos(company_id, media_type, captured_at desc);

notify pgrst, 'reload schema';