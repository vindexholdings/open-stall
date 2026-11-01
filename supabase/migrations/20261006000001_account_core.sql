-- OS-203 / OS-208 foundation: profiles, preferences, shared abuse-control rate limiter.
-- Account data follows the same model as public data: tables have NO client access; signed-in
-- clients call SECURITY DEFINER functions that act only on auth.uid(), validate input, and
-- rate-limit. Anonymous users cannot call any of them.

-- ---------------------------------------------------------------- abuse control (OS-208)
create table public.action_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null check (char_length(action) between 1 and 40),
  created_at timestamptz not null default now()
);
create index action_log_user_action_idx on public.action_log (user_id, action, created_at desc);
alter table public.action_log enable row level security;
revoke all on table public.action_log from public, anon, authenticated;

-- Sliding-window limit per user and action. Serialised per user+action so concurrent requests cannot
-- slip past the limit. Old log rows are purged opportunistically.
create or replace function public.enforce_rate_limit(p_user uuid, p_action text, p_max integer, p_window interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_action, 0));
  delete from public.action_log where user_id = p_user and created_at < now() - interval '7 days';
  select count(*) into n from public.action_log
    where user_id = p_user and action = p_action and created_at > now() - p_window;
  if n >= p_max then
    raise exception 'rate limit exceeded for %', p_action using errcode = '54000';
  end if;
  insert into public.action_log (user_id, action) values (p_user, p_action);
end;
$$;
revoke all on function public.enforce_rate_limit(uuid, text, integer, interval) from public, anon, authenticated;

-- Helper: rows in the public API shape (used by account functions that return restrooms).
create or replace function public.public_location_row(l public.locations, dist double precision)
returns public.public_location
language sql
stable
security definer
set search_path = ''
as $$
  select row(
    l.id, l.name, l.address_line, l.city, l.region, l.postal_code, l.latitude, l.longitude,
    case when l.status = 'verified' then 'verified' else 'unverified' end,
    l.last_verified_at, l.opening_hours, l.fee_required, l.key_required, l.purchase_required,
    l.wheelchair_accessible, l.gender_neutral, l.baby_changing, l.has_hot_water, l.has_cold_water,
    l.access_location, l.average_rating, l.rating_count,
    (select string_agg(distinct s.attribution, '; ') from public.location_sources s
      where s.location_id = l.id and s.attribution is not null),
    dist
  )::public.public_location
$$;
revoke all on function public.public_location_row(public.locations, double precision) from public, anon, authenticated;

-- ---------------------------------------------------------------- profiles (OS-203)
-- Display names will appear on leaderboards later, so they are restricted now: no links, handles,
-- markup or impersonation of staff/brand.
create or replace function public.valid_display_name(t text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select t is not null
    and char_length(t) between 2 and 30
    and t = btrim(t)
    and t !~ '[<>@/\\:;{}\[\]|=+*&%$#^~`"[:cntrl:]]'
    and lower(t) !~ '(admin|moderator|support|staff|official|open ?stall|crapper ?mapper|https?|www\.|\.com|\.net|\.org)'
$$;

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or public.valid_display_name(display_name)),
  preferred_mode text not null default 'plain' check (preferred_mode in ('plain', 'risque')),
  default_transport text not null default 'walk' check (default_transport in ('walk', 'drive', 'bike')),
  -- Written only by server-side reward logic (Phase 4); clients can never set it.
  points_balance integer not null default 0 check (points_balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon, authenticated;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Existing accounts (created before this migration) get a profile too.
insert into public.profiles (user_id) select id from auth.users on conflict do nothing;

create or replace function public.get_my_profile()
returns table (display_name text, preferred_mode text, default_transport text, points_balance integer)
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  insert into public.profiles (user_id) values (uid) on conflict do nothing;
  return query select p.display_name, p.preferred_mode, p.default_transport, p.points_balance
    from public.profiles p where p.user_id = uid;
end;
$$;

create or replace function public.update_my_profile(p_display_name text, p_mode text, p_transport text)
returns table (display_name text, preferred_mode text, default_transport text, points_balance integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  name_v text := nullif(btrim(coalesce(p_display_name, '')), '');
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_mode not in ('plain', 'risque') then raise exception 'invalid mode' using errcode = '22023'; end if;
  if p_transport not in ('walk', 'drive', 'bike') then raise exception 'invalid transport' using errcode = '22023'; end if;
  if name_v is not null and not public.valid_display_name(name_v) then
    raise exception 'invalid display name' using errcode = '22023';
  end if;
  perform public.enforce_rate_limit(uid, 'profile_update', 30, interval '1 hour');
  insert into public.profiles (user_id, display_name, preferred_mode, default_transport)
    values (uid, name_v, p_mode, p_transport)
  on conflict (user_id) do update
    set display_name = excluded.display_name, preferred_mode = excluded.preferred_mode,
        default_transport = excluded.default_transport;
  return query select p.display_name, p.preferred_mode, p.default_transport, p.points_balance
    from public.profiles p where p.user_id = uid;
end;
$$;

revoke all on function public.get_my_profile() from public, anon, authenticated;
revoke all on function public.update_my_profile(text, text, text) from public, anon, authenticated;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.update_my_profile(text, text, text) to authenticated;
