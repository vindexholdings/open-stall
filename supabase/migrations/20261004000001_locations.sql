-- OS-101 (revised): locations + amenities + import bookkeeping.
-- No data is inserted here. Real-world locations arrive only via the reviewed importer.
--
-- Visibility/confidence states (status):
--   verified   confirmed by Open Stall (admin/approved process). Public.
--   unverified real location backed by EXPLICIT external restroom evidence, not yet confirmed
--              by Open Stall. Public, but clients must show an "Unverified" badge.
--   candidate  imported/inferred possible location without sufficient evidence. Hidden.
--   pending    user submission awaiting moderation. Hidden.
--   closed     no longer available. Hidden.
-- The existence of a business is never evidence of a publicly accessible restroom.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- One row per importer run; drives refresh (stale-record detection) and audit.
create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('osm', 'import')),
  area_name text,
  bounds jsonb not null,
  tool_version text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),

  name text not null check (char_length(btrim(name)) between 1 and 200),
  address_line text check (address_line is null or char_length(address_line) <= 300),
  city text check (city is null or char_length(city) <= 120),
  region text check (region is null or char_length(region) <= 120),
  postal_code text check (postal_code is null or char_length(postal_code) <= 20),
  country_code text not null default 'US' check (country_code ~ '^[A-Z]{2}$'),

  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),

  status text not null default 'candidate'
    check (status in ('candidate', 'pending', 'unverified', 'verified', 'closed')),
  -- Evidence that a restroom exists and may be publicly usable. 'explicit' means source data
  -- states a public restroom/toilet; 'inferred' means only that the place type often has one.
  restroom_evidence text not null default 'none'
    check (restroom_evidence in ('none', 'inferred', 'explicit')),
  -- True only when Open Stall itself confirmed the restroom.
  restroom_verified boolean not null default false,
  last_verified_at timestamptz,

  -- Provenance and licensing (e.g. OpenStreetMap is ODbL; attribution must be preserved).
  source text not null check (source in ('osm', 'admin', 'user_submission', 'import')),
  source_reference text,
  source_license text,
  source_attribution text,

  -- Importer bookkeeping (not exposed to public roles).
  source_tags jsonb,
  source_hash text,
  last_seen_run uuid references public.import_runs (id) on delete set null,
  last_seen_at timestamptz,
  source_missing_since timestamptz,
  -- Set when an admin edits the record; importers then only refresh provenance fields.
  manually_edited_at timestamptz,

  -- Nullable booleans: NULL means unknown, which is different from false.
  wheelchair_accessible boolean,
  gender_neutral boolean,
  baby_changing boolean,
  has_hot_water boolean,
  has_cold_water boolean,
  key_required boolean,
  purchase_required boolean,
  access_location text check (access_location is null or char_length(access_location) <= 300),

  average_rating numeric(3, 2) check (average_rating is null or average_rating between 1 and 5),
  rating_count integer not null default 0 check (rating_count >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint locations_verified_requires_confirmation check (
    status <> 'verified' or (restroom_verified and last_verified_at is not null)
  ),
  -- Only verified (or later-closed) records may claim Open Stall verification.
  constraint locations_only_verified_claim_verification check (
    not restroom_verified or status in ('verified', 'closed')
  ),
  -- Public "unverified" listings require explicit external restroom evidence.
  constraint locations_unverified_requires_explicit_evidence check (
    status <> 'unverified' or restroom_evidence = 'explicit'
  )
);

comment on table public.locations is
  'Restroom locations. Public roles read only verified rows and displayable unverified rows (see RLS migration).';

create unique index locations_source_ref_key
  on public.locations (source, source_reference)
  where source_reference is not null;

create index locations_status_lat_lng_idx on public.locations (status, latitude, longitude);

create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();
