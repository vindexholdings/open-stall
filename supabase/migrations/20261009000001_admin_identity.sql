-- Phase 3A / OS-301: real admin identity. Admins are ordinary authenticated Supabase users listed in
-- admin_users AND signed in with MFA (JWT aal = 'aal2'). User metadata is never authority, and no
-- service-role credential is needed by a hosted admin app: every admin capability is a narrowly scoped
-- SECURITY DEFINER function that re-checks the caller itself. Tables have no client access.
--
-- Bootstrap: the FIRST admin row is inserted by the project owner with SQL (postgres/service_role) after
-- that person has enrolled MFA; there is deliberately no function that can create admins.

create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'admin' check (role = 'admin'),
  created_at timestamptz not null default now(),
  -- A disabled admin keeps their row (decisions reference their id) but loses all capability.
  disabled_at timestamptz
);
alter table public.admin_users enable row level security;
revoke all on table public.admin_users from public, anon, authenticated;

-- Append-only record of material admin actions (no identity of contributors, only ids).
create table public.moderation_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid not null,
  action text not null check (char_length(action) between 1 and 60),
  target_type text not null check (target_type in ('submission', 'report', 'location')),
  target_id uuid not null,
  detail jsonb not null default '{}'::jsonb
);
create index moderation_log_target_idx on public.moderation_log (target_type, target_id);
alter table public.moderation_log enable row level security;
revoke all on table public.moderation_log from public, anon, authenticated;

create or replace function public.reject_append_only_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;
create trigger moderation_log_append_only before update or delete on public.moderation_log
  for each row execute function public.reject_append_only_change();
create trigger moderation_log_no_truncate before truncate on public.moderation_log
  for each statement execute function public.reject_append_only_change();

-- Internal gate used by every admin function: returns the admin's user id or raises.
create or replace function public.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.admin_users a where a.user_id = uid and a.disabled_at is null) then
    raise exception 'not an administrator' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'multi-factor authentication required' using errcode = '42501';
  end if;
  return uid;
end;
$$;

create or replace function public.log_moderation(p_actor uuid, p_action text, p_type text, p_target uuid, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.moderation_log (actor_id, action, target_type, target_id, detail) values (p_actor, p_action, p_type, p_target, coalesce(p_detail, '{}'::jsonb));
$$;

-- What the admin UI may know about the caller (only their own status).
create or replace function public.am_i_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  listed boolean;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select exists (select 1 from public.admin_users a where a.user_id = uid and a.disabled_at is null) into listed;
  return jsonb_build_object('admin', listed, 'mfa', coalesce(auth.jwt() ->> 'aal', '') = 'aal2');
end;
$$;

revoke all on function public.reject_append_only_change() from public, anon, authenticated;
revoke all on function public.require_admin() from public, anon, authenticated;
revoke all on function public.log_moderation(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.am_i_admin() from public, anon, authenticated;
grant execute on function public.am_i_admin() to authenticated;
