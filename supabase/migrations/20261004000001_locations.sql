-- OS-101: locations + amenities.
-- No data is inserted here. Real-world locations arrive via a separate, reviewed import.
-- Imported/external locations start as status 'candidate' (not restroom-verified, never public).

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

  -- candidate: external/imported, NOT restroom-verified. pending: user submission awaiting
  -- moderation. verified: restroom confirmed by admin. closed: no longer available.
  status text not null default 'candidate'
    check (status in ('candidate', 'pending', 'verified', 'closed')),
  restroom_verified boolean not null default false,
  last_verified_at timestamptz,

  -- Provenance and licensing (e.g. OpenStreetMap is ODbL; attribution must be preserved).
  source text not null check (source in ('osm', 'admin', 'user_submission', 'import')),
  source_reference text,
  source_license text,
  source_attribution text,

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

  -- A location can only be "verified" if a restroom was actually confirmed.
  constraint locations_verified_requires_confirmation check (
    status <> 'verified' or (restroom_verified and last_verified_at is not null)
  ),
  -- Unverified statuses can never claim restroom verification.
  constraint locations_unverified_not_confirmed check (
    status not in ('candidate', 'pending') or not restroom_verified
  )
);

comment on table public.locations is
  'Restroom locations. Only status=verified rows are publicly readable (see RLS migration).';

create unique index locations_source_ref_key
  on public.locations (source, source_reference)
  where source_reference is not null;

create index locations_status_lat_lng_idx on public.locations (status, latitude, longitude);

create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();
