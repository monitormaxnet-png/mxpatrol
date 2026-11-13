-- Fix production drift where some clients request patrol_session_id while the
-- canonical patrol_session_checkpoints column is session_id.
alter table if exists public.patrol_session_checkpoints
  add column if not exists patrol_session_id uuid references public.patrol_sessions(id) on delete cascade;

update public.patrol_session_checkpoints
set patrol_session_id = session_id
where patrol_session_id is null and session_id is not null;

update public.patrol_session_checkpoints
set session_id = patrol_session_id
where session_id is null and patrol_session_id is not null;

create index if not exists idx_patrol_session_checkpoints_patrol_session_id
on public.patrol_session_checkpoints(patrol_session_id)
where patrol_session_id is not null;

create or replace function public.sync_patrol_session_checkpoint_session_aliases()
returns trigger
language plpgsql
as $$
begin
  if new.session_id is null and new.patrol_session_id is not null then
    new.session_id := new.patrol_session_id;
  elsif new.patrol_session_id is null and new.session_id is not null then
    new.patrol_session_id := new.session_id;
  elsif new.session_id is not null and new.patrol_session_id is not null and new.session_id is distinct from new.patrol_session_id then
    new.patrol_session_id := new.session_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_patrol_session_checkpoint_session_aliases on public.patrol_session_checkpoints;
create trigger trg_sync_patrol_session_checkpoint_session_aliases
before insert or update of session_id, patrol_session_id
on public.patrol_session_checkpoints
for each row
execute function public.sync_patrol_session_checkpoint_session_aliases();

-- For All Sites dashboard acknowledgements, site_id is intentionally null.
-- PostgreSQL unique constraints treat nulls as distinct, so add a partial
-- unique index and remove older duplicates before enforcing it.
with ranked as (
  select id,
         row_number() over (
           partition by user_id, company_id, activity_type
           order by acknowledged_at desc, updated_at desc, created_at desc, id desc
         ) as rn
  from public.user_activity_acknowledgements
  where site_id is null
)
delete from public.user_activity_acknowledgements ack
using ranked
where ack.id = ranked.id and ranked.rn > 1;

create unique index if not exists user_activity_acknowledgements_unique_all_sites
on public.user_activity_acknowledgements(user_id, company_id, activity_type)
where site_id is null;

notify pgrst, 'reload schema';
