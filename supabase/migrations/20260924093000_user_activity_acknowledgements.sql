create table if not exists public.user_activity_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  site_id uuid references public.sites(id) on delete cascade,
  activity_type text not null,
  acknowledged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_activity_acknowledgements_activity_type_check
    check (activity_type in ('scans', 'photos', 'datalog', 'sos', 'recordings')),
  constraint user_activity_acknowledgements_unique_scope
    unique (user_id, company_id, site_id, activity_type)
);

create index if not exists idx_user_activity_ack_user_scope
on public.user_activity_acknowledgements(user_id, company_id, site_id, activity_type);

create index if not exists idx_user_activity_ack_company_site
on public.user_activity_acknowledgements(company_id, site_id, activity_type, acknowledged_at desc);

alter table public.user_activity_acknowledgements enable row level security;

drop policy if exists "Users can read their own activity acknowledgements" on public.user_activity_acknowledgements;
create policy "Users can read their own activity acknowledgements"
on public.user_activity_acknowledgements
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can create their own activity acknowledgements" on public.user_activity_acknowledgements;
create policy "Users can create their own activity acknowledgements"
on public.user_activity_acknowledgements
for insert
to authenticated
with check (
  user_id = auth.uid()
  and (
    company_id = public.get_user_company_id(auth.uid())
    or exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.role = 'owner')
  )
);

drop policy if exists "Users can update their own activity acknowledgements" on public.user_activity_acknowledgements;
create policy "Users can update their own activity acknowledgements"
on public.user_activity_acknowledgements
for update
to authenticated
using (
  user_id = auth.uid()
  and (
    company_id = public.get_user_company_id(auth.uid())
    or exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.role = 'owner')
  )
)
with check (
  user_id = auth.uid()
  and (
    company_id = public.get_user_company_id(auth.uid())
    or exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.role = 'owner')
  )
);

notify pgrst, 'reload schema';
