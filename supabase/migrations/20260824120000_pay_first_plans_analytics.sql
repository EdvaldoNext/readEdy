-- ReadEdy: pay-first billing, checkout guest, analytics, admin views

-- ---------------------------------------------------------------------------
-- plans: max_pdfs + new pricing
-- ---------------------------------------------------------------------------
alter table public.plans add column if not exists max_pdfs integer;

update public.plans set active = false
where slug in ('trial', 'pro_monthly', 'pro_annual');

insert into public.plans (slug, name, price_brl, billing_interval, storage_mb, max_pdfs, active)
values
  ('basic_monthly', 'ReadEdy Básico', 9.99, 'month', 45, 3, true),
  ('premium_monthly', 'ReadEdy Premium', 19.99, 'month', 120, 10, true)
on conflict (slug) do update set
  name = excluded.name,
  price_brl = excluded.price_brl,
  billing_interval = excluded.billing_interval,
  storage_mb = excluded.storage_mb,
  max_pdfs = excluded.max_pdfs,
  active = true;

-- Expire existing trials (no free access)
update public.subscriptions
set status = 'expired', updated_at = now()
where status = 'trialing';

-- ---------------------------------------------------------------------------
-- subscriptions: allow guest checkout (user_id null until Google link)
-- ---------------------------------------------------------------------------
alter table public.subscriptions alter column user_id drop not null;

alter table public.subscriptions drop constraint if exists subscriptions_user_id_fkey;
alter table public.subscriptions
  add constraint subscriptions_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

drop index if exists subscriptions_one_active_per_user_idx;
create unique index subscriptions_one_active_per_user_idx
  on public.subscriptions (user_id)
  where user_id is not null
    and status in ('pending', 'trialing', 'active', 'past_due');

-- ---------------------------------------------------------------------------
-- checkout_sessions (pay before auth)
-- ---------------------------------------------------------------------------
create table if not exists public.checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  plan_id uuid not null references public.plans (id),
  payer_email text,
  mp_preapproval_id text,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'expired', 'linked')),
  user_id uuid references auth.users (id) on delete set null,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists checkout_sessions_token_idx on public.checkout_sessions (token);
create index if not exists checkout_sessions_mp_idx on public.checkout_sessions (mp_preapproval_id);

alter table public.subscriptions add column if not exists checkout_session_id uuid
  references public.checkout_sessions (id) on delete set null;

drop trigger if exists checkout_sessions_set_updated_at on public.checkout_sessions;
create trigger checkout_sessions_set_updated_at
  before update on public.checkout_sessions
  for each row execute function public.readera_touch_updated_at ();

alter table public.checkout_sessions enable row level security;
-- No client policies — edge functions use service_role

-- ---------------------------------------------------------------------------
-- site_visits (analytics)
-- ---------------------------------------------------------------------------
create table if not exists public.site_visits (
  id uuid primary key default gen_random_uuid(),
  visitor_id text not null,
  user_id uuid references auth.users (id) on delete set null,
  path text not null default '/',
  country text,
  city text,
  referrer text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists site_visits_created_idx on public.site_visits (created_at desc);
create index if not exists site_visits_visitor_idx on public.site_visits (visitor_id, created_at desc);
create index if not exists site_visits_country_idx on public.site_visits (country, created_at desc);

alter table public.site_visits enable row level security;

drop policy if exists "site_visits_admin_select" on public.site_visits;
create policy "site_visits_admin_select"
  on public.site_visits for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- is_subscription_active: pay-only, linked user required
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
      and s.status in ('active', 'past_due')
      and coalesce(s.current_period_end, now()) > now() - interval '3 days'
  );
$$;

-- ---------------------------------------------------------------------------
-- handle_new_user: profile only, no trial
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin views
-- ---------------------------------------------------------------------------
create or replace view public.admin_visits_daily
with (security_invoker = true)
as
select
  date_trunc('day', created_at)::date as day,
  count(*) as visits,
  count(distinct visitor_id) as unique_visitors,
  count(distinct user_id) filter (where user_id is not null) as logged_in_visits
from public.site_visits
group by 1
order by 1 desc;

create or replace view public.admin_visits_geo
with (security_invoker = true)
as
select
  coalesce(country, 'unknown') as country,
  coalesce(city, 'unknown') as city,
  count(*) as visits,
  count(distinct visitor_id) as unique_visitors
from public.site_visits
where created_at >= now() - interval '30 days'
group by 1, 2
order by visits desc;

create or replace view public.admin_clients_summary
with (security_invoker = true)
as
select
  (select count(*) from public.profiles) as total_clients,
  (select count(distinct s.user_id)
   from public.subscriptions s
   where s.user_id is not null
     and s.status = 'active'
     and coalesce(s.current_period_end, now()) > now()) as active_paying,
  (select count(distinct p.id)
   from public.profiles p
   where not exists (
     select 1 from public.subscriptions s
     where s.user_id = p.id
       and s.status = 'active'
       and coalesce(s.current_period_end, now()) > now()
   )) as inactive_or_unpaid,
  (select count(*)
   from public.profiles
   where created_at >= now() - interval '7 days') as new_clients_7d,
  (select count(*)
   from public.subscriptions s
   where s.user_id is not null
     and s.status in ('active', 'past_due')
     and coalesce(s.current_period_end, now()) > now()) as paid_subscribers,
  (select count(distinct p.id)
   from public.profiles p
   left join public.subscriptions s on s.user_id = p.id
     and s.status in ('active', 'past_due')
     and coalesce(s.current_period_end, now()) > now()
   where s.id is null) as unpaid_clients;

create or replace view public.admin_user_storage
with (security_invoker = true)
as
select
  p.id as user_id,
  p.email,
  p.display_name,
  coalesce(pl.name, 'Sem plano') as plan_name,
  coalesce(pl.slug, '') as plan_slug,
  coalesce(sub.status, 'none') as subscription_status,
  coalesce(pl.storage_mb, 0) as storage_mb_limit,
  coalesce(pl.max_pdfs, 0) as max_pdfs_limit,
  coalesce(doc_stats.pdf_count, 0) as pdf_count,
  coalesce(doc_stats.bytes_used, 0) as bytes_used,
  p.created_at as joined_at
from public.profiles p
left join lateral (
  select s.status, s.plan_id, s.current_period_end
  from public.subscriptions s
  where s.user_id = p.id
  order by s.created_at desc
  limit 1
) sub on true
left join public.plans pl on pl.id = sub.plan_id
left join lateral (
  select count(*)::bigint as pdf_count, coalesce(sum(d.bytes), 0)::bigint as bytes_used
  from public.documents d
  where d.user_id = p.id
) doc_stats on true
order by bytes_used desc;

create or replace view public.admin_project_storage
with (security_invoker = true)
as
select
  coalesce(sum(d.bytes), 0)::bigint as used_bytes,
  1073741824::bigint as limit_bytes,
  greatest(0, 1073741824 - coalesce(sum(d.bytes), 0))::bigint as remaining_bytes,
  count(d.id)::bigint as total_documents
from public.documents d;

grant select on public.admin_visits_daily to authenticated;
grant select on public.admin_visits_geo to authenticated;
grant select on public.admin_clients_summary to authenticated;
grant select on public.admin_user_storage to authenticated;
grant select on public.admin_project_storage to authenticated;

-- plans readable by anon for pricing page
drop policy if exists "plans_select_all" on public.plans;
create policy "plans_select_all"
  on public.plans for select to anon, authenticated
  using (active = true or (select public.is_admin()));
