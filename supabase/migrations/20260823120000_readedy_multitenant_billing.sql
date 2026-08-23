-- ReadEdy: multi-tenant por usuário, billing Mercado Pago, analytics e admin.

-- ---------------------------------------------------------------------------
-- Helper: verifica se usuário tem assinatura ativa ou trial válido
-- ---------------------------------------------------------------------------
create or replace function public.is_subscription_active(p_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = p_user_id
      and s.status in ('active', 'trialing')
      and coalesce(s.current_period_end, s.trial_ends_at, now()) > now()
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (select auth.jwt() -> 'app_metadata' ->> 'role'),
    ''
  ) = 'admin';
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.readera_touch_updated_at ();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- plans
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  price_brl numeric(10, 2) not null default 0,
  billing_interval text not null default 'month'
    check (billing_interval in ('month', 'year')),
  mp_plan_id text,
  tts_minutes_month integer,
  storage_mb integer,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.plans enable row level security;

drop policy if exists "plans_select_all" on public.plans;
create policy "plans_select_all"
  on public.plans for select to authenticated
  using (active = true or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  status text not null default 'trialing'
    check (status in ('pending', 'trialing', 'active', 'past_due', 'canceled', 'expired')),
  mp_preapproval_id text,
  mp_payer_id text,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_idx
  on public.subscriptions (user_id, created_at desc);

create index if not exists subscriptions_status_period_idx
  on public.subscriptions (status, current_period_end);

create unique index if not exists subscriptions_one_active_per_user_idx
  on public.subscriptions (user_id)
  where status in ('pending', 'trialing', 'active', 'past_due');

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.readera_touch_updated_at ();

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
  on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- inserts/updates only via service_role (edge functions) — no client policies

-- ---------------------------------------------------------------------------
-- billing_events (audit + idempotência webhook MP)
-- ---------------------------------------------------------------------------
create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  mp_event_id text not null unique,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  user_id uuid references auth.users (id) on delete set null,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists billing_events_created_idx
  on public.billing_events (created_at desc);

alter table public.billing_events enable row level security;

drop policy if exists "billing_events_admin_select" on public.billing_events;
create policy "billing_events_admin_select"
  on public.billing_events for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- usage_logs (analytics)
-- ---------------------------------------------------------------------------
create table if not exists public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_logs_user_created_idx
  on public.usage_logs (user_id, created_at desc);

create index if not exists usage_logs_event_created_idx
  on public.usage_logs (event_type, created_at desc);

alter table public.usage_logs enable row level security;

drop policy if exists "usage_logs_insert_own" on public.usage_logs;
create policy "usage_logs_insert_own"
  on public.usage_logs for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "usage_logs_select_own" on public.usage_logs;
create policy "usage_logs_select_own"
  on public.usage_logs for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Seed plans
-- ---------------------------------------------------------------------------
insert into public.plans (slug, name, price_brl, billing_interval, tts_minutes_month, storage_mb)
values
  ('trial', 'Trial 30 dias', 0, 'month', null, 512),
  ('pro_monthly', 'ReadEdy Pro Mensal', 19.90, 'month', null, 5120),
  ('pro_annual', 'ReadEdy Pro Anual', 199.00, 'year', null, 5120)
on conflict (slug) do update set
  name = excluded.name,
  price_brl = excluded.price_brl,
  billing_interval = excluded.billing_interval,
  tts_minutes_month = excluded.tts_minutes_month,
  storage_mb = excluded.storage_mb,
  active = true;

-- ---------------------------------------------------------------------------
-- Signup: profile + trial automático
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trial_plan_id uuid;
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name);

  select id into v_trial_plan_id from public.plans where slug = 'trial' limit 1;

  if v_trial_plan_id is not null then
    insert into public.subscriptions (user_id, plan_id, status, trial_ends_at, current_period_end)
    select
      new.id,
      v_trial_plan_id,
      'trialing',
      now() + interval '30 days',
      now() + interval '30 days'
    where not exists (
      select 1 from public.subscriptions s
      where s.user_id = new.id
        and s.status in ('pending', 'trialing', 'active', 'past_due')
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- documents: restaurar RLS por usuário (remover anon aberto)
-- ---------------------------------------------------------------------------
alter table public.documents drop constraint if exists documents_user_id_fkey;
alter table public.documents
  add constraint documents_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

drop policy if exists "documents_anon_select" on public.documents;
drop policy if exists "documents_anon_insert" on public.documents;
drop policy if exists "documents_anon_update" on public.documents;
drop policy if exists "documents_anon_delete" on public.documents;
drop policy if exists "documents_auth_select" on public.documents;
drop policy if exists "documents_auth_insert" on public.documents;
drop policy if exists "documents_auth_update" on public.documents;
drop policy if exists "documents_auth_delete" on public.documents;

drop policy if exists "documents_select_own" on public.documents;
create policy "documents_select_own"
  on public.documents for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "documents_insert_own" on public.documents;
create policy "documents_insert_own"
  on public.documents for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "documents_update_own" on public.documents;
create policy "documents_update_own"
  on public.documents for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "documents_delete_own" on public.documents;
create policy "documents_delete_own"
  on public.documents for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- user_preferences: RLS por usuário
-- ---------------------------------------------------------------------------
drop policy if exists "user_preferences_auth" on public.user_preferences;

drop policy if exists "user_preferences_all_own" on public.user_preferences;
create policy "user_preferences_all_own"
  on public.user_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Storage: bucket privado + policies por user_id
-- ---------------------------------------------------------------------------
update storage.buckets
set public = false
where id = 'pdfs';

drop policy if exists "pdfs_anon_select" on storage.objects;
drop policy if exists "pdfs_anon_insert" on storage.objects;
drop policy if exists "pdfs_anon_update" on storage.objects;
drop policy if exists "pdfs_anon_delete" on storage.objects;
drop policy if exists "pdfs_auth_all" on storage.objects;

drop policy if exists "pdfs_select_own" on storage.objects;
create policy "pdfs_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'pdfs'
    and (storage.foldername (name))[1] = (select auth.uid())::text
  );

drop policy if exists "pdfs_insert_own" on storage.objects;
create policy "pdfs_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pdfs'
    and (storage.foldername (name))[1] = (select auth.uid())::text
  );

drop policy if exists "pdfs_update_own" on storage.objects;
create policy "pdfs_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'pdfs'
    and (storage.foldername (name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'pdfs'
    and (storage.foldername (name))[1] = (select auth.uid())::text
  );

drop policy if exists "pdfs_delete_own" on storage.objects;
create policy "pdfs_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'pdfs'
    and (storage.foldername (name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- Views admin (security invoker)
-- ---------------------------------------------------------------------------
create or replace view public.admin_dashboard_daily
with (security_invoker = true)
as
select
  date_trunc('day', created_at)::date as day,
  count(*) filter (where event_type = 'session_start') as sessions,
  count(*) filter (where event_type = 'tts_request') as tts_requests,
  count(distinct user_id) filter (where event_type = 'session_start') as dau
from public.usage_logs
group by 1
order by 1 desc;

create or replace view public.admin_subscriptions_summary
with (security_invoker = true)
as
select
  s.status,
  p.slug as plan_slug,
  p.name as plan_name,
  p.price_brl,
  p.billing_interval,
  count(*) as total
from public.subscriptions s
join public.plans p on p.id = s.plan_id
group by s.status, p.slug, p.name, p.price_brl, p.billing_interval;

grant select on public.admin_dashboard_daily to authenticated;
grant select on public.admin_subscriptions_summary to authenticated;

grant execute on function public.is_subscription_active(uuid) to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
