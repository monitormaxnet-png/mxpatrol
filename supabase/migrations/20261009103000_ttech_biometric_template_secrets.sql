-- Server-only TTECH native biometric template storage.
-- No authenticated RLS policies are defined on purpose; service-role Edge Functions own all reads/writes.

create table if not exists public.ttech_biometric_template_secrets (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.guard_biometric_enrollments(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  guard_id uuid not null references public.guards(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  engine_version text not null,
  template_version integer not null default 1,
  vector jsonb not null,
  status text not null default 'active' check (status in ('active','revoked','deleted','pending')),
  quality jsonb not null default '{}'::jsonb,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ttech_biometric_template_secrets enable row level security;

create index if not exists idx_ttech_template_secrets_company_site
  on public.ttech_biometric_template_secrets(company_id, site_id, status);
create index if not exists idx_ttech_template_secrets_guard
  on public.ttech_biometric_template_secrets(company_id, guard_id, status);
create index if not exists idx_ttech_template_secrets_enrollment
  on public.ttech_biometric_template_secrets(enrollment_id, status);

notify pgrst, 'reload schema';
