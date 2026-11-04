alter table public.companies add column if not exists registration_code text;
alter table public.sites add column if not exists registration_code text;
alter table public.guards add column if not exists employee_number text;
alter table public.guards add column if not exists site_id uuid references public.sites(id) on delete set null;

update public.companies
set registration_code = upper(left(regexp_replace(name, '[^A-Za-z0-9]', '', 'g') || 'XXX', 3)) || '-' || upper(left(id::text, 8))
where nullif(btrim(registration_code), '') is null;
update public.sites
set registration_code = upper(left(regexp_replace(name, '[^A-Za-z0-9]', '', 'g') || 'SITE', 8)) || '-' || upper(left(id::text, 8))
where nullif(btrim(registration_code), '') is null;
with unique_badges as (
  select id, count(*) over (partition by company_id, upper(btrim(badge_number))) as matches
  from public.guards
)
update public.guards as guard
set employee_number = guard.badge_number
from unique_badges
where guard.id = unique_badges.id and nullif(btrim(guard.employee_number), '') is null
  and nullif(btrim(guard.badge_number), '') is not null and unique_badges.matches = 1;

create unique index if not exists companies_registration_code_key on public.companies (upper(btrim(registration_code))) where nullif(btrim(registration_code), '') is not null;
create unique index if not exists sites_company_registration_code_key on public.sites (company_id, upper(btrim(registration_code))) where nullif(btrim(registration_code), '') is not null;
create unique index if not exists guards_company_employee_number_key on public.guards (company_id, upper(btrim(employee_number))) where nullif(btrim(employee_number), '') is not null;
create unique index if not exists devices_serial_number_registration_key on public.devices (upper(btrim(serial_number))) where nullif(btrim(serial_number), '') is not null;
create unique index if not exists checkpoints_company_nfc_registration_key on public.checkpoints (company_id, upper(btrim(nfc_tag_id))) where nullif(btrim(nfc_tag_id), '') is not null;

create or replace function public.lookup_bulk_registration_identifier(p_kind text, p_value text, p_company_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
declare v_value text := upper(btrim(p_value));
begin
  if nullif(v_value, '') is null then return null; end if;
  case p_kind
    when 'company_code' then
      select to_jsonb(c) into v_result from public.companies c where upper(btrim(c.registration_code)) = v_value limit 1;
    when 'site_code' then
      select to_jsonb(s) into v_result from public.sites s where s.company_id = p_company_id and upper(btrim(s.registration_code)) = v_value limit 1;
    when 'device_serial' then
      select to_jsonb(d) into v_result from public.devices d where upper(btrim(d.serial_number)) = v_value limit 1;
    when 'device_identity' then
      select to_jsonb(d) into v_result from public.devices d where d.company_id = p_company_id and upper(btrim(d.device_identifier)) = v_value limit 1;
    when 'checkpoint_nfc' then
      select to_jsonb(c) into v_result from public.checkpoints c where c.company_id = p_company_id and upper(btrim(c.nfc_tag_id)) = v_value limit 1;
    when 'guard_employee' then
      select to_jsonb(g) into v_result from public.guards g where g.company_id = p_company_id and upper(btrim(g.employee_number)) = v_value limit 1;
    else raise exception 'Unsupported bulk registration identifier';
  end case;
  return v_result;
end $$;

revoke all on function public.lookup_bulk_registration_identifier(text, text, uuid) from public, anon, authenticated;
grant execute on function public.lookup_bulk_registration_identifier(text, text, uuid) to service_role;

create table if not exists public.bulk_registration_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  is_platform_owner boolean not null default false,
  rows jsonb not null,
  result_rows jsonb not null default '[]'::jsonb,
  cursor integer not null default 0,
  claimed_count integer not null default 0,
  claim_token uuid,
  status text not null default 'preview' check (status in ('preview', 'processing', 'completed')),
  processing_started_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  constraint bulk_registration_jobs_rows_array check (jsonb_typeof(rows) = 'array'),
  constraint bulk_registration_jobs_results_array check (jsonb_typeof(result_rows) = 'array'),
  constraint bulk_registration_jobs_company_required check (company_id is not null or is_platform_owner),
  constraint bulk_registration_jobs_claimed_count check (claimed_count between 0 and 40),
  constraint bulk_registration_jobs_cursor check (cursor >= 0 and cursor <= jsonb_array_length(rows)),
  constraint bulk_registration_jobs_result_count check (jsonb_array_length(result_rows) = cursor),
  constraint bulk_registration_jobs_claim_state check (
    (status = 'processing' and claimed_count > 0 and claim_token is not null)
    or (status <> 'processing' and claimed_count = 0 and claim_token is null)
  )
);

revoke all on public.bulk_registration_jobs from anon, authenticated;
grant all on public.bulk_registration_jobs to service_role;
alter table public.bulk_registration_jobs enable row level security;

create or replace function public.claim_bulk_registration_batch(p_job_id uuid, p_user_id uuid, p_company_id uuid, p_is_platform_owner boolean, p_limit integer default 40)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_job public.bulk_registration_jobs%rowtype;
declare v_count integer;
declare v_token uuid;
begin
  if p_limit is null or p_limit < 1 or p_limit > 40 then raise exception 'Invalid batch size'; end if;
  select * into v_job from public.bulk_registration_jobs
  where id = p_job_id and user_id = p_user_id
    and company_id is not distinct from p_company_id
    and is_platform_owner is not distinct from p_is_platform_owner
  for update;
  if not found then raise exception 'Import preview not found'; end if;
  if v_job.expires_at < now() then raise exception 'Import preview expired'; end if;
  if v_job.status = 'completed' then return jsonb_build_object('done', true, 'results', v_job.result_rows); end if;
  if v_job.status = 'processing' and v_job.processing_started_at > now() - interval '2 minutes' then
    raise exception 'Import batch is already processing';
  end if;
  v_count := least(p_limit, jsonb_array_length(v_job.rows) - v_job.cursor);
  if v_count < 1 then raise exception 'Import cursor is inconsistent'; end if;
  v_token := gen_random_uuid();
  update public.bulk_registration_jobs
  set status = 'processing', processing_started_at = now(), claimed_count = v_count, claim_token = v_token
  where id = p_job_id;
  return jsonb_build_object('done', false, 'cursor', v_job.cursor, 'claim_token', v_token, 'rows',
    (select coalesce(jsonb_agg(value order by n), '[]'::jsonb)
     from jsonb_array_elements(v_job.rows) with ordinality as t(value, n)
     where n > v_job.cursor and n <= v_job.cursor + v_count));
end $$;

revoke all on function public.claim_bulk_registration_batch(uuid, uuid, uuid, boolean, integer) from public, anon, authenticated;
grant execute on function public.claim_bulk_registration_batch(uuid, uuid, uuid, boolean, integer) to service_role;

create or replace function public.complete_bulk_registration_batch(p_job_id uuid, p_user_id uuid, p_company_id uuid, p_is_platform_owner boolean, p_cursor integer, p_claim_token uuid, p_results jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_job public.bulk_registration_jobs%rowtype;
declare v_next integer;
begin
  if p_results is null or jsonb_typeof(p_results) <> 'array' then raise exception 'Invalid batch result'; end if;
  select * into v_job from public.bulk_registration_jobs
  where id = p_job_id and user_id = p_user_id
    and company_id is not distinct from p_company_id
    and is_platform_owner is not distinct from p_is_platform_owner
  for update;
  if not found or v_job.status <> 'processing' or v_job.cursor <> p_cursor
     or v_job.claim_token is distinct from p_claim_token then raise exception 'Import batch changed'; end if;
  if v_job.claimed_count < 1 or jsonb_array_length(p_results) <> v_job.claimed_count then
    raise exception 'Incomplete batch result';
  end if;
  v_next := v_job.cursor + v_job.claimed_count;
  update public.bulk_registration_jobs
  set cursor = v_next,
      result_rows = v_job.result_rows || p_results,
      status = case when v_next >= jsonb_array_length(v_job.rows) then 'completed' else 'preview' end,
      processing_started_at = null, claimed_count = 0, claim_token = null
  where id = p_job_id;
  return jsonb_build_object('done', v_next >= jsonb_array_length(v_job.rows), 'cursor', v_next, 'results', v_job.result_rows || p_results);
end $$;

revoke all on function public.complete_bulk_registration_batch(uuid, uuid, uuid, boolean, integer, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_bulk_registration_batch(uuid, uuid, uuid, boolean, integer, uuid, jsonb) to service_role;
