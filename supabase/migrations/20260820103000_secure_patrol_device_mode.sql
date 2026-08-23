-- Secure Patrol Device Mode backend support.

alter table public.devices
  add column if not exists secure_mode_enabled boolean not null default false,
  add column if not exists secure_mode_status text not null default 'not_configured',
  add column if not exists public_key text,
  add column if not exists public_key_algorithm text,
  add column if not exists device_key_registered_at timestamptz,
  add column if not exists installation_id text,
  add column if not exists app_version text,
  add column if not exists app_build_number text,
  add column if not exists app_package_name text,
  add column if not exists app_signature_sha256 text,
  add column if not exists is_debug_build boolean not null default false,
  add column if not exists device_owner_active boolean not null default false,
  add column if not exists kiosk_active boolean not null default false,
  add column if not exists developer_mode_detected boolean not null default false,
  add column if not exists adb_detected boolean not null default false,
  add column if not exists root_risk_detected boolean not null default false,
  add column if not exists last_integrity_check_at timestamptz,
  add column if not exists last_secure_auth_at timestamptz,
  add column if not exists secure_offline_trust_expires_at timestamptz,
  add column if not exists minimum_app_version text,
  add column if not exists disabled_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid,
  add column if not exists maintenance_expires_at timestamptz;

alter table public.devices
  drop constraint if exists devices_secure_mode_status_check;

alter table public.devices
  add constraint devices_secure_mode_status_check check (
    secure_mode_status in (
      'not_configured', 'pending', 'active', 'maintenance', 'disabled',
      'revoked', 'integrity_failed', 'update_required'
    )
  );

create table if not exists public.device_request_nonces (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  nonce text not null,
  action text not null,
  request_timestamp timestamptz not null,
  payload_hash text,
  created_at timestamptz not null default now(),
  unique (device_id, nonce)
);

create index if not exists device_request_nonces_device_created_idx
  on public.device_request_nonces (device_id, created_at desc);

create table if not exists public.device_security_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  device_id uuid references public.devices(id) on delete set null,
  device_identifier text,
  event_type text not null,
  severity text not null default 'info',
  app_version text,
  metadata jsonb not null default '{}'::jsonb,
  initiated_by uuid,
  occurred_at timestamptz not null default now()
);

create index if not exists device_security_events_company_site_time_idx
  on public.device_security_events (company_id, site_id, occurred_at desc);

alter table public.device_request_nonces enable row level security;
alter table public.device_security_events enable row level security;

drop policy if exists "Company members can view device security events" on public.device_security_events;
create policy "Company members can view device security events"
  on public.device_security_events for select
  using (company_id in (select profiles.company_id from public.profiles where profiles.id = auth.uid()));

drop policy if exists "Company admins can manage device security events" on public.device_security_events;
create policy "Company admins can manage device security events"
  on public.device_security_events for all
  using (company_id in (select profiles.company_id from public.profiles where profiles.id = auth.uid()))
  with check (company_id in (select profiles.company_id from public.profiles where profiles.id = auth.uid()));

alter type public.command_type add value if not exists 'disable_device';
alter type public.command_type add value if not exists 'enable_device';
alter type public.command_type add value if not exists 'enter_maintenance';
alter type public.command_type add value if not exists 'exit_maintenance';
alter type public.command_type add value if not exists 'force_security_check';
alter type public.command_type add value if not exists 'require_app_update';
alter type public.command_type add value if not exists 'revoke_device';
