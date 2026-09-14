-- Simplify checkpoint Datalog for Commercial V1.
-- Datalog is now one optional checkpoint value captured after a scan; it does not classify or complete patrols.

alter table public.checkpoints
  add column if not exists data_log_enabled boolean not null default false,
  add column if not exists data_log_label text;

alter table public.data_log_submissions
  add column if not exists datalog_value text;

alter table public.data_log_submissions
  alter column form_id drop not null;

with legacy_labels as (
  select distinct on (c.id)
    c.id as checkpoint_id,
    coalesce(nullif(fld.label, ''), nullif(f.name, ''), 'Datalog') as label
  from public.checkpoints c
  left join public.data_log_forms f on f.id = c.data_log_form_id
  left join public.data_log_form_fields fld on fld.form_id = f.id and fld.is_active = true
  where c.data_log_form_id is not null
  order by c.id, fld.sequence_order nulls last, fld.created_at nulls last
)
update public.checkpoints c
set
  data_log_enabled = true,
  data_log_label = coalesce(nullif(c.data_log_label, ''), legacy_labels.label, 'Datalog'),
  data_log_form_id = null
from legacy_labels
where c.id = legacy_labels.checkpoint_id;

create index if not exists idx_data_log_submissions_site_checkpoint_time
  on public.data_log_submissions(company_id, site_id, checkpoint_id, submitted_at desc);

create or replace function public.submit_data_log_submission(
  p_scan_log_id uuid,
  p_responses_json jsonb,
  p_submitted_by uuid default auth.uid()
)
returns table(
  submission_id uuid,
  patrol_session_id uuid,
  session_checkpoint_id uuid,
  status text,
  completed integer,
  required integer,
  progress_percent numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scan public.scan_logs%rowtype;
  v_checkpoint public.checkpoints%rowtype;
  v_session_checkpoint public.patrol_session_checkpoints%rowtype;
  v_value text;
  v_label text;
  v_submission_id uuid;
begin
  select * into v_scan
  from public.scan_logs
  where id = p_scan_log_id
  for update;

  if not found then
    raise exception 'Scan log was not found';
  end if;

  if auth.uid() is not null and v_scan.company_id not in (
    select company_id from public.profiles where id = auth.uid()
  ) then
    raise exception 'Not allowed to submit data for this scan';
  end if;

  if v_scan.checkpoint_id is null then
    raise exception 'This scan is not linked to a checkpoint';
  end if;

  select * into v_checkpoint
  from public.checkpoints
  where id = v_scan.checkpoint_id
    and company_id = v_scan.company_id;

  if not found then
    raise exception 'Checkpoint was not found for this scan';
  end if;

  if v_checkpoint.data_log_enabled is not true then
    raise exception 'This checkpoint does not require Datalog';
  end if;

  v_label := coalesce(nullif(v_checkpoint.data_log_label, ''), 'Datalog');
  v_value := nullif(trim(coalesce(
    p_responses_json ->> 'datalog_value',
    p_responses_json ->> v_label,
    p_responses_json ->> 'value'
  )), '');

  if v_value is null then
    select nullif(trim(value), '') into v_value
    from jsonb_each_text(p_responses_json)
    where nullif(trim(value), '') is not null
    limit 1;
  end if;

  if v_value is null then
    raise exception 'Datalog value is required';
  end if;

  select * into v_session_checkpoint
  from public.patrol_session_checkpoints
  where scan_log_id = v_scan.id
  order by updated_at desc
  limit 1;

  insert into public.data_log_submissions (
    company_id,
    site_id,
    checkpoint_id,
    form_id,
    patrol_session_id,
    patrol_session_checkpoint_id,
    scan_log_id,
    device_id,
    submitted_by,
    status,
    responses_json,
    datalog_value,
    validation_errors
  ) values (
    v_scan.company_id,
    v_scan.site_id,
    v_scan.checkpoint_id,
    null,
    coalesce(v_scan.patrol_session_id, v_session_checkpoint.session_id),
    v_session_checkpoint.id,
    v_scan.id,
    v_scan.device_id,
    p_submitted_by,
    'submitted',
    jsonb_build_object('label', v_label, 'datalog_value', v_value),
    v_value,
    '{}'::jsonb
  )
  on conflict (scan_log_id) do update set
    submitted_at = now(),
    submitted_by = excluded.submitted_by,
    responses_json = excluded.responses_json,
    datalog_value = excluded.datalog_value,
    validation_errors = '{}'::jsonb,
    status = 'submitted'
  returning id into v_submission_id;

  update public.scan_logs
  set data_log_required = true,
      data_log_status = 'submitted'
  where id = v_scan.id;

  if v_session_checkpoint.id is not null then
    update public.patrol_session_checkpoints
    set data_log_status = 'submitted',
        updated_at = now(),
        audit_meta = coalesce(audit_meta, '{}'::jsonb) || jsonb_build_object('datalog_value_captured_at', now())
    where id = v_session_checkpoint.id;
  end if;

  return query
  select
    v_submission_id,
    coalesce(v_scan.patrol_session_id, v_session_checkpoint.session_id),
    v_session_checkpoint.id,
    'submitted'::text,
    coalesce(ps.checkpoint_completed, 0)::integer,
    coalesce(ps.checkpoint_total, 0)::integer,
    coalesce(ps.progress_percent, 0)::numeric
  from (select 1) seed
  left join public.patrol_sessions ps on ps.id = coalesce(v_scan.patrol_session_id, v_session_checkpoint.session_id);
end;
$$;
