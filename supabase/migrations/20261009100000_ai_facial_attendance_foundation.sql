-- MX Patrol AI Facial Attendance foundation. Biometric matching is disabled until a dedicated provider is configured.

alter table public.guards add column if not exists biometric_enrollment_status text not null default 'not_enrolled';
alter table public.guards add column if not exists biometric_enrolled_at timestamptz;
alter table public.guards add column if not exists biometric_template_version integer not null default 0;
alter table public.guards drop constraint if exists guards_biometric_enrollment_status_check;
alter table public.guards add constraint guards_biometric_enrollment_status_check check (biometric_enrollment_status in ('not_enrolled','pending','active','revoked','deleted'));

create table if not exists public.guard_biometric_enrollments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  guard_id uuid not null references public.guards(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  provider_name text not null,
  provider_reference text,
  template_version integer not null default 1,
  enrollment_status text not null default 'pending' check (enrollment_status in ('pending','active','revoked','deleted','failed')),
  quality_status text,
  liveness_status text,
  sample_count integer not null default 0,
  enrolled_at timestamptz,
  revoked_at timestamptz,
  deleted_at timestamptz,
  authorized_by uuid references auth.users(id) on delete set null,
  privacy_notice_version text,
  lawful_basis text,
  retention_policy text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_guard_biometric_enrollments_company_guard on public.guard_biometric_enrollments(company_id, guard_id, enrollment_status);

create table if not exists public.attendance_shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  guard_id uuid not null references public.guards(id) on delete cascade,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  timezone text not null default 'Africa/Gaborone',
  grace_start_minutes integer not null default 0,
  grace_end_minutes integer not null default 0,
  shift_status text not null default 'scheduled' check (shift_status in ('scheduled','active','completed','cancelled','missed','review')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scheduled_end > scheduled_start)
);
create index if not exists idx_attendance_shifts_company_site_time on public.attendance_shifts(company_id, site_id, scheduled_start desc);

create table if not exists public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  guard_id uuid references public.guards(id) on delete set null,
  device_id uuid references public.devices(id) on delete set null,
  device_identifier text not null,
  event_type text not null check (event_type in ('clock_in','clock_out')),
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','unmatched','ambiguous','poor_quality','spoof_suspected','provider_unconfigured','failed','review_required')),
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  verified_at timestamptz,
  latitude double precision,
  longitude double precision,
  gps_accuracy double precision,
  photo_reference text,
  biometric_provider_reference text,
  provider_name text,
  provider_result jsonb not null default '{}'::jsonb,
  candidate_summary jsonb not null default '[]'::jsonb,
  liveness_result jsonb not null default '{}'::jsonb,
  shift_id uuid references public.attendance_shifts(id) on delete set null,
  review_status text not null default 'not_required' check (review_status in ('not_required','pending','approved','rejected','corrected')),
  offline_sync_status text not null default 'online' check (offline_sync_status in ('online','queued','synced','delayed','replayed')),
  idempotency_key text,
  source_event_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists attendance_events_company_idempotency on public.attendance_events(company_id, idempotency_key) where idempotency_key is not null;
create index if not exists idx_attendance_events_company_site_time on public.attendance_events(company_id, site_id, captured_at desc);
create index if not exists idx_attendance_events_review on public.attendance_events(company_id, review_status, captured_at desc);

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  guard_id uuid not null references public.guards(id) on delete cascade,
  shift_id uuid references public.attendance_shifts(id) on delete set null,
  clock_in_event_id uuid references public.attendance_events(id) on delete set null,
  clock_out_event_id uuid references public.attendance_events(id) on delete set null,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  gross_minutes integer,
  late_minutes integer not null default 0,
  overtime_minutes integer not null default 0,
  session_status text not null default 'open' check (session_status in ('open','closed','exception','void')),
  payroll_ready boolean not null default false,
  reconciliation_status text not null default 'pending' check (reconciliation_status in ('pending','approved','rejected','adjusted')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_attendance_sessions_guard_time on public.attendance_sessions(company_id, guard_id, clock_in_at desc nulls last);

create table if not exists public.attendance_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  attendance_event_id uuid not null references public.attendance_events(id) on delete cascade,
  reviewer_id uuid references auth.users(id) on delete set null,
  decision text not null check (decision in ('approved_match','rejected_match','poor_quality','spoof_suspected','manual_correction','delete_requested')),
  guard_id uuid references public.guards(id) on delete set null,
  reason text not null,
  reviewed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.guard_biometric_enrollments enable row level security;
alter table public.attendance_shifts enable row level security;
alter table public.attendance_events enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_reviews enable row level security;

create policy "Company users can view attendance events" on public.attendance_events for select to authenticated using (company_id = public.get_user_company_id(auth.uid()));
create policy "Admins update attendance events" on public.attendance_events for update to authenticated using (company_id = public.get_user_company_id(auth.uid()) and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'supervisor'))) with check (company_id = public.get_user_company_id(auth.uid()) and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'supervisor')));
create policy "Company users can view attendance sessions" on public.attendance_sessions for select to authenticated using (company_id = public.get_user_company_id(auth.uid()));
create policy "Admins manage attendance sessions" on public.attendance_sessions for all to authenticated using (company_id = public.get_user_company_id(auth.uid()) and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'supervisor'))) with check (company_id = public.get_user_company_id(auth.uid()) and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'supervisor')));
create policy "Company users can view attendance shifts" on public.attendance_shifts for select to authenticated using (company_id = public.get_user_company_id(auth.uid()));
create policy "Admins manage attendance shifts" on public.attendance_shifts for all to authenticated using (company_id = public.get_user_company_id(auth.uid()) and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'supervisor'))) with check (company_id = public.get_user_company_id(auth.uid()) and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'supervisor')));
create policy "Company users can view attendance reviews" on public.attendance_reviews for select to authenticated using (company_id = public.get_user_company_id(auth.uid()));
create policy "Admins manage attendance reviews" on public.attendance_reviews for all to authenticated using (company_id = public.get_user_company_id(auth.uid()) and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'supervisor'))) with check (company_id = public.get_user_company_id(auth.uid()) and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'supervisor')));
create policy "Company users can view biometric enrollment metadata" on public.guard_biometric_enrollments for select to authenticated using (company_id = public.get_user_company_id(auth.uid()));
create policy "Admins manage biometric enrollment metadata" on public.guard_biometric_enrollments for all to authenticated using (company_id = public.get_user_company_id(auth.uid()) and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'supervisor'))) with check (company_id = public.get_user_company_id(auth.uid()) and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'supervisor')));

insert into storage.buckets (id, name, public) values ('attendance-evidence', 'attendance-evidence', false) on conflict (id) do update set public = false;
notify pgrst, 'reload schema';
