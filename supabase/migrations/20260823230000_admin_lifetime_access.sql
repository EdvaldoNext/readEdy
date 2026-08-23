-- Admin da conta tem acesso vitalício (is_subscription_active).

create or replace function public.is_subscription_active(p_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    (
      p_user_id is not null
      and p_user_id = (select auth.uid())
      and (select public.is_admin())
    )
    or exists (
      select 1
      from public.subscriptions s
      where s.user_id = p_user_id
        and s.status in ('active', 'past_due')
        and coalesce(s.current_period_end, now()) > now() - interval '3 days'
    );
$$;
