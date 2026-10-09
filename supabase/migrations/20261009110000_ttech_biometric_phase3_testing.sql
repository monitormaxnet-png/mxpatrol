-- MX Patrol TTECH biometric Phase 3: real-world testing and calibration.
-- This keeps test captures separate from production attendance approval.

create table if not exists public.biometric_test_captures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  device_id uuid references public.devices(id) on delete set null,
  device_identifier text not null,
  attendance_event_id uuid references public.attendance_events(id) on delete set null,
  test_capture_identifier text not null,
  test_session_id text,
  testing_mode text not null default 'rg360_volume_up' check (testing_mode in ('rg360_volume_up','manual_upload','offline_sync')),
  expected_guard_id uuid references public.guards(id) on delete set null,
  candidate_guard_id uuid references public.guards(id) on delete set null,
  actual_guard_id uuid references public.guards(id) on delete set null,
  similarity_score double precision,
  candidate_margin double precision,
  candidate_count integer not null default 0,
  image_quality_status text,
  image_quality jsonb not null default '{}'::jsonb,
  liveness_status text,
  liveness_result jsonb not null default '{}'::jsonb,
  outcome_status text not null default 'review_required' check (outcome_status in ('match_candidate','no_match','review_required','poor_quality','ambiguous','provider_unconfigured','offline_queued','failed')),
  review_outcome text not null default 'unlabeled' check (review_outcome in ('unlabeled','correct_identification','false_identification','false_rejection','ambiguous','face_detection_failed','quality_rejected','spoof_test','ignore')),
  lighting_condition text,
  participant_reference text,
  device_model text,
  processing_duration_ms integer,
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  labeled_at timestamptz,
  labeled_by uuid references auth.users(id) on delete set null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, test_capture_identifier)
);

create index if not exists idx_biometric_test_captures_company_time on public.biometric_test_captures(company_id, captured_at desc);
create index if not exists idx_biometric_test_captures_review on public.biometric_test_captures(company_id, review_outcome, captured_at desc);
create index if not exists idx_biometric_test_captures_session on public.biometric_test_captures(company_id, test_session_id, captured_at desc) where test_session_id is not null;

alter table public.biometric_test_captures enable row level security;

create policy "Managers can view biometric test captures"
on public.biometric_test_captures for select to authenticated
using (company_id = public.get_user_company_id(auth.uid()) and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'supervisor')));

create policy "Managers can label biometric test captures"
on public.biometric_test_captures for update to authenticated
using (company_id = public.get_user_company_id(auth.uid()) and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'supervisor')))
with check (company_id = public.get_user_company_id(auth.uid()) and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'supervisor')));

create table if not exists public.biometric_threshold_evaluations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  evaluation_name text not null,
  threshold double precision not null,
  margin_threshold double precision not null default 0,
  sample_count integer not null default 0,
  correct_identification_rate double precision,
  false_identification_rate double precision,
  false_rejection_rate double precision,
  ambiguous_match_frequency double precision,
  face_detection_failure_rate double precision,
  image_quality_rejection_rate double precision,
  p50_processing_latency_ms integer,
  p95_processing_latency_ms integer,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.biometric_threshold_evaluations enable row level security;

create policy "Managers can view biometric threshold evaluations"
on public.biometric_threshold_evaluations for select to authenticated
using (company_id = public.get_user_company_id(auth.uid()) and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'supervisor')));

create policy "Managers can create biometric threshold evaluations"
on public.biometric_threshold_evaluations for insert to authenticated
with check (company_id = public.get_user_company_id(auth.uid()) and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'supervisor')));

notify pgrst, 'reload schema';
