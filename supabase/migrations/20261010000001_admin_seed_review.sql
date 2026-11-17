-- Phase 3A follow-on: authenticated seeded-location review (replaces the browser-facing service-role path).
-- NOT APPLIED LIVE. Forward migration only; exercised on disposable local Postgres.
--
-- The admin /review pages previously read and wrote through a service-role client. They now call the
-- functions below with the admin's own session. Every function re-checks admin_users membership AND an
-- MFA (aal2) session inside the database via require_admin(); user metadata is never authority.
--   * Reads expose the same fields the validator already showed (hidden candidates, sources, review history).
--   * The write wraps the existing apply_location_review_v2 unchanged (verification semantics, source
--     provenance, community-only public ratings) and records the REAL admin id as the reviewer identity
--     ('admin:<uuid>'). Legacy 'local-admin' rows are left exactly as they are; no historical identity is invented.
--   * Each seed review also appends to moderation_log (append-only).
--   * An admin cannot review a restroom that they themselves contributed (self-adjudication protection).
-- apply_location_review / apply_location_review_v2 stay service_role-only for importer/manual tooling.

create or replace function public.admin_location_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := public.require_admin();
begin
  return (select jsonb_build_object(
    'candidate', count(*) filter (where status = 'candidate'),
    'unverified', count(*) filter (where status = 'unverified'),
    'verified', count(*) filter (where status = 'verified'),
    'closed', count(*) filter (where status = 'closed'))
  from public.locations);
end;
$$;

-- One location as the validator displays it (private fields included; admins only).
create or replace function public.admin_location_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id, 'name', l.name, 'address_line', l.address_line, 'city', l.city, 'region', l.region,
    'postal_code', l.postal_code, 'latitude', l.latitude, 'longitude', l.longitude, 'status', l.status,
    'restroom_evidence', l.restroom_evidence, 'restroom_verified', l.restroom_verified,
    'last_verified_at', l.last_verified_at, 'wheelchair_accessible', l.wheelchair_accessible,
    'gender_neutral', l.gender_neutral, 'baby_changing', l.baby_changing, 'has_hot_water', l.has_hot_water,
    'has_cold_water', l.has_cold_water, 'customers_only', l.customers_only, 'family_bathroom', l.family_bathroom,
    'key_required', l.key_required, 'purchase_required', l.purchase_required, 'fee_required', l.fee_required,
    'opening_hours', l.opening_hours, 'possible_duplicate_of', l.possible_duplicate_of,
    'location_sources', coalesce((select jsonb_agg(jsonb_build_object(
        'source', s.source, 'source_reference', s.source_reference, 'is_primary', s.is_primary,
        'tags', s.tags, 'license', s.license, 'attribution', s.attribution) order by s.is_primary desc, s.source)
      from public.location_sources s where s.location_id = l.id), '[]'::jsonb),
    'location_reviews', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'reviewer', r.reviewer, 'existence', r.existence, 'personally_verified', r.personally_verified,
        'verified_on', r.verified_on, 'notes', r.notes, 'resulting_status', r.resulting_status,
        'created_at', r.created_at, 'restroom_type', r.restroom_type, 'rating', r.rating,
        'cleanliness_score', r.cleanliness_score, 'public_comment', r.public_comment,
        'conditions', r.conditions, 'cleaning_log', r.cleaning_log, 'reviewer_identity', r.reviewer_identity)
        order by r.created_at desc, r.id)
      from public.location_reviews r where r.location_id = l.id), '[]'::jsonb))
  from public.locations l where l.id = p_id
$$;

create or replace function public.admin_list_locations(p_status text, p_limit integer default 500)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := public.require_admin();
begin
  if p_status is null or p_status not in ('candidate', 'unverified', 'verified', 'closed') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(public.admin_location_json(x.id) order by x.name, x.id)
    from (select l.id, l.name from public.locations l where l.status = p_status
          order by l.name, l.id limit least(greatest(coalesce(p_limit, 500), 1), 500)) x), '[]'::jsonb);
end;
$$;

create or replace function public.admin_get_location(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := public.require_admin();
begin
  -- Pending-community records are not seeded locations; they belong to the moderation queue.
  if not exists (select 1 from public.locations l where l.id = p_id and l.status in ('candidate', 'unverified', 'verified', 'closed')) then
    return null;
  end if;
  return public.admin_location_json(p_id);
end;
$$;

create or replace function public.admin_apply_location_review(
  p_location uuid, p_reviewer text, p_existence text, p_personally_verified boolean, p_verified_on date, p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_admin();
  result jsonb;
begin
  if not exists (select 1 from public.locations l where l.id = p_location and l.status in ('candidate', 'unverified', 'verified', 'closed')) then
    raise exception 'unknown location' using errcode = '22023';
  end if;
  -- Self-adjudication: an admin may not verify or close a restroom that their own submission created.
  if exists (select 1 from public.submissions s where s.result_location_id = p_location and s.user_id = uid) then
    raise exception 'cannot review a restroom you contributed' using errcode = '42501';
  end if;
  result := public.apply_location_review_v2(p_location, p_reviewer, 'admin:' || uid::text,
    p_existence, p_personally_verified, p_verified_on, p_answers);
  perform public.log_moderation(uid, 'seed_review', 'location', p_location, jsonb_build_object(
    'review_id', result->>'review_id', 'existence', p_existence, 'personally_verified', p_personally_verified,
    'resulting_status', result->>'status'));
  return result;
end;
$$;

revoke all on function public.admin_location_counts() from public, anon, authenticated;
revoke all on function public.admin_location_json(uuid) from public, anon, authenticated;
revoke all on function public.admin_list_locations(text, integer) from public, anon, authenticated;
revoke all on function public.admin_get_location(uuid) from public, anon, authenticated;
revoke all on function public.admin_apply_location_review(uuid, text, text, boolean, date, jsonb) from public, anon, authenticated;
grant execute on function public.admin_location_counts() to authenticated;
grant execute on function public.admin_list_locations(text, integer) to authenticated;
grant execute on function public.admin_get_location(uuid) to authenticated;
grant execute on function public.admin_apply_location_review(uuid, text, text, boolean, date, jsonb) to authenticated;
