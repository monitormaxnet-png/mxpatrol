-- Read-only preflight for 20261103120000_bulk_registration_phase2.sql.
-- Runs before the migration, even when registration_code/employee_number columns do not exist.
with required(table_name, column_name) as (
  values
    ('companies', 'id'), ('companies', 'name'),
    ('sites', 'id'), ('sites', 'company_id'), ('sites', 'name'),
    ('devices', 'id'), ('devices', 'company_id'), ('devices', 'site_id'),
    ('devices', 'serial_number'), ('devices', 'device_identifier'),
    ('checkpoints', 'id'), ('checkpoints', 'company_id'),
    ('checkpoints', 'site_id'), ('checkpoints', 'nfc_tag_id'),
    ('guards', 'id'), ('guards', 'company_id'), ('guards', 'badge_number'),
    ('profiles', 'id')
)
select r.table_name, r.column_name, c.column_name is not null as present
from required r
left join information_schema.columns c
  on c.table_schema = 'public' and c.table_name = r.table_name and c.column_name = r.column_name
order by r.table_name, r.column_name;

with guard_values as (
  select g.*, count(*) over (partition by g.company_id, upper(btrim(g.badge_number))) as badge_matches
  from public.guards g
), identifiers as (
  select 'device_serial' as identifier_type, 'global' as scope,
    d.id, d.company_id, d.site_id, d.serial_number as raw_value,
    upper(btrim(d.serial_number)) as normalized_value
  from public.devices d
  union all
  select 'checkpoint_nfc', c.company_id::text,
    c.id, c.company_id, c.site_id, c.nfc_tag_id,
    lower(regexp_replace(c.nfc_tag_id, '[[:space:]:.-]', '', 'g'))
  from public.checkpoints c
  union all
  select 'guard_employee', g.company_id::text,
    g.id, g.company_id, nullif(to_jsonb(g)->>'site_id', '')::uuid,
    coalesce(nullif(btrim(to_jsonb(g)->>'employee_number'), ''), case when g.badge_matches = 1 then nullif(btrim(g.badge_number), '') end),
    upper(btrim(coalesce(nullif(btrim(to_jsonb(g)->>'employee_number'), ''), case when g.badge_matches = 1 then nullif(btrim(g.badge_number), '') end)))
  from guard_values g
  union all
  select 'company_code', 'global',
    c.id, c.id, null::uuid,
    coalesce(nullif(btrim(to_jsonb(c)->>'registration_code'), ''), upper(left(regexp_replace(c.name, '[^A-Za-z0-9]', '', 'g') || 'XXX', 3)) || '-' || upper(left(c.id::text, 8))),
    upper(btrim(coalesce(nullif(btrim(to_jsonb(c)->>'registration_code'), ''), upper(left(regexp_replace(c.name, '[^A-Za-z0-9]', '', 'g') || 'XXX', 3)) || '-' || upper(left(c.id::text, 8)))))
  from public.companies c
  union all
  select 'site_code', s.company_id::text,
    s.id, s.company_id, s.id,
    coalesce(nullif(btrim(to_jsonb(s)->>'registration_code'), ''), upper(left(regexp_replace(s.name, '[^A-Za-z0-9]', '', 'g') || 'SITE', 8)) || '-' || upper(left(s.id::text, 8))),
    upper(btrim(coalesce(nullif(btrim(to_jsonb(s)->>'registration_code'), ''), upper(left(regexp_replace(s.name, '[^A-Za-z0-9]', '', 'g') || 'SITE', 8)) || '-' || upper(left(s.id::text, 8)))))
  from public.sites s
)
select identifier_type, scope, normalized_value, count(*) as duplicate_count,
  jsonb_agg(jsonb_build_object('id', id, 'company_id', company_id, 'site_id', site_id, 'stored_value', raw_value) order by id) as affected_records
from identifiers
where nullif(normalized_value, '') is not null
group by identifier_type, scope, normalized_value
having count(*) > 1
order by identifier_type, scope, normalized_value;

with guard_values as (
  select g.*, count(*) over (partition by g.company_id, upper(btrim(g.badge_number))) as badge_matches
  from public.guards g
), identifiers as (
  select 'device_serial' as identifier_type, d.id, d.company_id, d.site_id, d.serial_number as raw_value, 'serial_number' as field_name from public.devices d
  union all select 'device_identity', d.id, d.company_id, d.site_id, d.device_identifier, 'device_identifier' from public.devices d
  union all select 'checkpoint_nfc', c.id, c.company_id, c.site_id, c.nfc_tag_id, 'nfc_tag_id' from public.checkpoints c
  union all select 'guard_employee', g.id, g.company_id, nullif(to_jsonb(g)->>'site_id', '')::uuid, coalesce(nullif(btrim(to_jsonb(g)->>'employee_number'), ''), case when g.badge_matches = 1 then nullif(btrim(g.badge_number), '') end), 'employee_number/badge_number' from guard_values g
  union all select 'company_code', c.id, c.id, null::uuid, to_jsonb(c)->>'registration_code', 'registration_code' from public.companies c
  union all select 'site_code', s.id, s.company_id, s.id, to_jsonb(s)->>'registration_code', 'registration_code' from public.sites s
)
select identifier_type, id, company_id, site_id, field_name, raw_value,
  case when nullif(btrim(raw_value), '') is null then 'blank or missing'
       when identifier_type = 'checkpoint_nfc' and nullif(lower(regexp_replace(raw_value, '[[:space:]:.-]', '', 'g')), '') is null then 'NFC UID has no letters or digits after normalization'
       when raw_value ~ '[[:cntrl:]]' then 'control characters'
       when raw_value <> btrim(raw_value) then 'leading or trailing whitespace'
       when identifier_type in ('company_code', 'site_code') and upper(btrim(raw_value)) !~ '^[A-Z0-9][A-Z0-9_-]{1,39}$' then 'invalid code format'
       else 'valid' end as finding
from identifiers
where nullif(btrim(raw_value), '') is null
   or (identifier_type = 'checkpoint_nfc' and nullif(lower(regexp_replace(raw_value, '[[:space:]:.-]', '', 'g')), '') is null)
   or raw_value ~ '[[:cntrl:]]'
   or raw_value <> btrim(raw_value)
   or (identifier_type in ('company_code', 'site_code') and upper(btrim(raw_value)) !~ '^[A-Z0-9][A-Z0-9_-]{1,39}$')
order by identifier_type, company_id, id;

select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('companies', 'sites', 'devices', 'checkpoints', 'guards')
  and (indexname like '%registration%' or indexname like '%serial%' or indexname like '%nfc%' or indexname like '%employee%')
order by tablename, indexname;

select pa.user_id, pa.role
from public.platform_admins pa
left join public.profiles p on p.id = pa.user_id
where pa.role = 'owner' and p.id is null
order by pa.user_id;

select g.id as guard_id, g.company_id as guard_company_id,
  s.id as site_id, s.company_id as site_company_id
from public.guards g
join public.sites s on s.id = nullif(to_jsonb(g)->>'site_id', '')::uuid
where s.company_id <> g.company_id
order by g.company_id, g.id;
