-- R002: immutable prospective policy versions and the per-location IANA time zone.

create table rewards.reward_policy_versions (
  id bigint generated always as identity primary key,
  effective_from timestamptz not null unique,
  spendable_per_visit integer not null check (spendable_per_visit > 0),
  lifetime_first_daily integer not null check (lifetime_first_daily >= 0),
  max_rewarded_per_location_day integer not null check (max_rewarded_per_location_day > 0),
  max_spendable_per_user_utc_day integer not null check (max_spendable_per_user_utc_day > 0),
  created_by text not null default current_user,
  created_at timestamptz not null default clock_timestamp()
);

-- A change is always prospective: after the first (seed) version, effective_from must be in the future.
create function rewards.policy_versions_prospective() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from rewards.reward_policy_versions) and new.effective_from <= clock_timestamp() then
    raise exception 'a policy version must take effect in the future (changes are prospective)' using errcode = '22023';
  end if;
  return new;
end $$;
-- MUTABLE:prospective_policy begin
create trigger reward_policy_versions_prospective before insert on rewards.reward_policy_versions
  for each row execute function rewards.policy_versions_prospective();
-- MUTABLE:prospective_policy end
create trigger reward_policy_versions_immutable before update or delete on rewards.reward_policy_versions
  for each row execute function rewards.guard_append_only();
create trigger reward_policy_versions_no_truncate before truncate on rewards.reward_policy_versions
  for each statement execute function rewards.guard_truncate();

-- Approved parameters (Jake, 2026-10-11): +5 spendable per rewarded visit, +5 lifetime on the first visit of the local
-- day, at most 4 rewarded visits per user/location/local day, provisional 60 spendable per account per UTC day.
-- No cooldown column exists: nothing in this design measures an interval between visits.
insert into rewards.reward_policy_versions
  (effective_from, spendable_per_visit, lifetime_first_daily, max_rewarded_per_location_day, max_spendable_per_user_utc_day, created_by)
values ('2000-01-01 00:00:00+00', 5, 5, 4, 60, 'seed');

alter table rewards.reward_policy_versions enable row level security;
alter table rewards.reward_policy_versions force row level security;
revoke all on rewards.reward_policy_versions from public, anon, authenticated, service_role;
grant select on rewards.reward_policy_versions to reward_writer_owner;
create policy writer_reads_policy on rewards.reward_policy_versions for select to reward_writer_owner using (true);

-- IANA zone per location. There is no zone column on public.locations and P1 must not alter it, so the zone lives here.
-- A location without a valid zone fails closed: the visit is recorded and nothing is awarded.
create table rewards.reward_location_zones (
  location_id uuid primary key references public.locations (id) on delete cascade,
  time_zone text not null check (char_length(time_zone) between 1 and 64)
);
create trigger reward_location_zones_no_truncate before truncate on rewards.reward_location_zones
  for each statement execute function rewards.guard_truncate();
alter table rewards.reward_location_zones enable row level security;
alter table rewards.reward_location_zones force row level security;
revoke all on rewards.reward_location_zones from public, anon, authenticated, service_role;
grant select on rewards.reward_location_zones to reward_writer_owner;
create policy writer_reads_zones on rewards.reward_location_zones for select to reward_writer_owner using (true);

create function rewards.is_valid_time_zone(p_zone text) returns boolean
language sql stable set search_path = pg_catalog as $$
  select p_zone is not null and exists (select 1 from pg_catalog.pg_timezone_names n where n.name = p_zone)
$$;
