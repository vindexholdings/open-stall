-- OS-102 (revised): RLS and least-privilege grants.
-- Public (anon/authenticated) may read:
--   * verified locations that Open Stall confirmed, and
--   * unverified locations that have EXPLICIT external restroom evidence (client must badge them).
-- Candidates, pending submissions and closed locations are never readable.
-- Client roles cannot write. Only a defined set of public columns is readable.

alter table public.locations enable row level security;
alter table public.locations force row level security;

revoke all on table public.locations from public, anon, authenticated;
grant select (
  id, name, address_line, city, region, postal_code, country_code,
  latitude, longitude,
  status, restroom_evidence, restroom_verified, last_verified_at,
  source, source_license, source_attribution,
  wheelchair_accessible, gender_neutral, baby_changing, has_hot_water, has_cold_water,
  key_required, purchase_required, access_location,
  average_rating, rating_count, created_at, updated_at
) on table public.locations to anon, authenticated;

create policy "Public can read verified and displayable unverified locations"
  on public.locations
  for select
  to anon, authenticated
  using (
    (status = 'verified' and restroom_verified)
    or (status = 'unverified' and restroom_evidence = 'explicit' and not restroom_verified)
  );

-- No insert/update/delete policies for anon/authenticated: default deny.

-- Import bookkeeping is server-side only.
alter table public.import_runs enable row level security;
alter table public.import_runs force row level security;
revoke all on table public.import_runs from public, anon, authenticated;

revoke all on function public.set_updated_at() from public, anon, authenticated;
