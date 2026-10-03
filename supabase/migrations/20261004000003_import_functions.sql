-- Importer merge logic, enforced in the database so no client or script can bypass it.
-- Callable ONLY by service_role (server-side). Rules:
--   * Sources are stored in location_sources; canonical locations are Open Stall's own records.
--   * New explicit-evidence record -> 'unverified' (public, badged); inferred, held, or possible
--     duplicate -> 'candidate' (hidden). Possible duplicates are FLAGGED, never merged.
--   * Existing verified/pending/closed or manually edited locations are NEVER overwritten by import;
--     only the source row (tags, hash, freshness) refreshes.
--   * Unprotected canonical fields follow the PRIMARY source; status follows current evidence
--     (upgrade/downgrade). A recent source edit holds a record hidden until it ages (vandalism guard).
--   * Idempotent on (source, source_reference). Reruns update, never duplicate.

create or replace function public.import_locations(p_run uuid, p_records jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r record;
  src public.location_sources%rowtype;
  ex public.locations%rowtype;
  found_src boolean;
  hold boolean;
  new_status text;
  dup_id uuid;
  loc_id uuid;
  old_hash text;
  inserted_n int := 0;
  updated_n int := 0;
  unchanged_n int := 0;
  protected_n int := 0;
  dup_n int := 0;
  held_n int := 0;
  d_lng double precision;
  generic constant text[] := array['restroom', 'restrooms', 'publicrestroom', 'toilet', 'toilets', 'publictoilet', 'publictoilets', 'wc'];
begin
  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'p_records must be a JSON array';
  end if;
  if not exists (select 1 from public.import_runs where id = p_run) then
    raise exception 'unknown import run %', p_run;
  end if;
  -- Transaction-local: tells protect_manual_edits() these updates are the importer's own.
  perform set_config('open_stall.importer', 'on', true);

  for r in
    select * from jsonb_to_recordset(p_records) as x(
      source text, source_reference text, name text, address_line text, city text, region text,
      postal_code text, country_code text, latitude double precision, longitude double precision,
      evidence text, wheelchair_accessible boolean, gender_neutral boolean, baby_changing boolean,
      has_hot_water boolean, has_cold_water boolean, key_required boolean, purchase_required boolean,
      fee_required boolean, access_location text, opening_hours text,
      license text, attribution text, tags jsonb, content_hash text,
      source_edited_at timestamptz, hold_reason text
    )
  loop
    if r.source not in ('osm', 'import') then
      raise exception 'importer may only write source osm/import, got %', r.source;
    end if;
    if r.source_reference is null or r.evidence not in ('inferred', 'explicit') then
      raise exception 'record needs source_reference and evidence inferred|explicit';
    end if;

    select * into src from public.location_sources
      where source = r.source and source_reference = r.source_reference for update;
    found_src := found;

    -- A recent source edit holds NEW or CHANGED records hidden until they age.
    hold := r.hold_reason is not null and (not found_src or src.content_hash is distinct from r.content_hash);
    new_status := case when r.evidence = 'explicit' and not hold then 'unverified' else 'candidate' end;
    if hold then held_n := held_n + 1; end if;

    if not found_src then
      dup_id := null;
      if r.evidence = 'explicit' then
        d_lng := 0.0006 / greatest(cos(radians(r.latitude)), 0.01);
        -- Conservative: within 30 m AND (within 10 m, or same/generic name). Only restroom-level
        -- records are compared (not place-level inferred candidates). Never merges.
        select l.id into dup_id from public.locations l
        where l.latitude between r.latitude - 0.0006 and r.latitude + 0.0006
          and l.longitude between r.longitude - d_lng and r.longitude + d_lng
          and l.status in ('verified', 'unverified', 'pending', 'candidate')
          and (l.status in ('verified', 'pending') or l.restroom_evidence = 'explicit')
          and public.distance_m(r.latitude, r.longitude, l.latitude, l.longitude) <= 30
          and (public.distance_m(r.latitude, r.longitude, l.latitude, l.longitude) <= 10
               or public.normalize_name(l.name) = public.normalize_name(r.name)
               or public.normalize_name(l.name) = any (generic)
               or public.normalize_name(r.name) = any (generic))
        order by public.distance_m(r.latitude, r.longitude, l.latitude, l.longitude), l.id
        limit 1;
        if dup_id is not null then new_status := 'candidate'; dup_n := dup_n + 1; end if;
      end if;

      insert into public.locations (
        name, address_line, city, region, postal_code, country_code, latitude, longitude,
        status, restroom_evidence, possible_duplicate_of,
        wheelchair_accessible, gender_neutral, baby_changing, has_hot_water, has_cold_water,
        key_required, purchase_required, fee_required, access_location, opening_hours
      ) values (
        r.name, r.address_line, r.city, r.region, r.postal_code, coalesce(r.country_code, 'US'),
        r.latitude, r.longitude, new_status, r.evidence, dup_id,
        r.wheelchair_accessible, r.gender_neutral, r.baby_changing, r.has_hot_water, r.has_cold_water,
        r.key_required, r.purchase_required, r.fee_required, r.access_location, r.opening_hours
      ) returning id into loc_id;

      insert into public.location_sources (
        location_id, source, source_reference, license, attribution, source_latitude, source_longitude,
        evidence, tags, content_hash, source_edited_at, hold_reason, is_primary, last_seen_at, last_seen_run
      ) values (
        loc_id, r.source, r.source_reference, r.license, r.attribution, r.latitude, r.longitude,
        r.evidence, r.tags, r.content_hash, r.source_edited_at, r.hold_reason, true, now(), p_run
      );
      inserted_n := inserted_n + 1;

    else
      old_hash := src.content_hash;
      select * into ex from public.locations where id = src.location_id for update;

      update public.location_sources set
        license = r.license, attribution = r.attribution,
        source_latitude = r.latitude, source_longitude = r.longitude, evidence = r.evidence,
        tags = r.tags, content_hash = r.content_hash, source_edited_at = r.source_edited_at,
        hold_reason = r.hold_reason, last_seen_at = now(), last_seen_run = p_run, missing_since = null
      where id = src.id;

      if ex.status in ('verified', 'pending', 'closed') or ex.manually_edited_at is not null then
        protected_n := protected_n + 1;
      elsif not src.is_primary then
        unchanged_n := unchanged_n + 1;
      else
        if ex.possible_duplicate_of is not null then new_status := 'candidate'; end if;
        if old_hash is not distinct from r.content_hash
           and ex.status = new_status and ex.restroom_evidence = r.evidence then
          unchanged_n := unchanged_n + 1;
        else
          update public.locations set
            name = r.name, address_line = r.address_line, city = r.city, region = r.region,
            postal_code = r.postal_code, country_code = coalesce(r.country_code, country_code),
            latitude = r.latitude, longitude = r.longitude,
            status = new_status, restroom_evidence = r.evidence,
            wheelchair_accessible = r.wheelchair_accessible, gender_neutral = r.gender_neutral,
            baby_changing = r.baby_changing, has_hot_water = r.has_hot_water,
            has_cold_water = r.has_cold_water, key_required = r.key_required,
            purchase_required = r.purchase_required, fee_required = r.fee_required,
            access_location = r.access_location, opening_hours = r.opening_hours
          where id = ex.id;
          updated_n := updated_n + 1;
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'inserted', inserted_n, 'updated', updated_n, 'unchanged', unchanged_n,
    'protected', protected_n, 'duplicates_flagged', dup_n, 'held_recent_edit', held_n
  );
end;
$$;

-- Call ONLY after a COMPLETE pass over the run's whole area (run.complete must be true).
-- Sources of this run's source inside its bounds that were not seen again are marked missing.
-- Unprotected UNVERIFIED locations whose sources are all missing are hidden (-> candidate);
-- verified/edited ones are only flagged. Safety: refuses to hide more than max(5, 10%) of the
-- area's public unverified records, or anything when the run saw nothing, unless p_force.
create or replace function public.finalize_import_run(p_run uuid, p_force boolean default false)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  run public.import_runs%rowtype;
  south double precision; west double precision; north double precision; east double precision;
  with_candidates boolean;
  seen_n int;
  public_n int;
  would_hide_n int;
  flagged_n int;
  hidden_n int;
  stale_locs uuid[];
begin
  select * into run from public.import_runs where id = p_run;
  if not found then
    raise exception 'unknown import run %', p_run;
  end if;
  if not run.complete then
    raise exception 'import run % is not marked complete; refusing to finalize', p_run;
  end if;
  perform set_config('open_stall.importer', 'on', true);

  south := (run.bounds->>'south')::float8; north := (run.bounds->>'north')::float8;
  west := (run.bounds->>'west')::float8; east := (run.bounds->>'east')::float8;
  with_candidates := coalesce((run.scope->>'include_candidates')::boolean, true);

  select count(*) into seen_n from public.location_sources where last_seen_run = p_run;

  select count(*) into public_n
  from public.location_sources s join public.locations l on l.id = s.location_id
  where s.source = run.source and s.is_primary and s.missing_since is null and l.status = 'unverified'
    and s.source_latitude between south and north and s.source_longitude between west and east;

  select count(*) into would_hide_n
  from public.location_sources s join public.locations l on l.id = s.location_id
  where s.source = run.source and s.is_primary and s.missing_since is null
    and s.last_seen_run is distinct from p_run
    and l.status = 'unverified' and l.manually_edited_at is null
    and s.source_latitude between south and north and s.source_longitude between west and east
    and (with_candidates or s.evidence = 'explicit');

  if not p_force and (
       would_hide_n > greatest(5, ceil(0.10 * public_n))
       or (seen_n = 0 and public_n > 0)
     ) then
    raise exception 'finalize would hide % of % public unverified records (saw % records this run); investigate the import or pass p_force',
      would_hide_n, public_n, seen_n;
  end if;

  -- Two statements on purpose: data-modifying CTEs share one snapshot, so the hide step must run
  -- after the missing flags are visible.
  with stale as (
    update public.location_sources s set missing_since = now()
    where s.source = run.source and s.last_seen_run is distinct from p_run and s.missing_since is null
      and s.source_latitude between south and north and s.source_longitude between west and east
      and (with_candidates or s.evidence = 'explicit')
    returning s.location_id
  )
  select coalesce(array_agg(location_id), '{}'::uuid[]) into stale_locs from stale;
  flagged_n := coalesce(array_length(stale_locs, 1), 0);

  with hide as (
    update public.locations l set status = 'candidate'
    where l.id = any (stale_locs)
      and l.status = 'unverified' and l.manually_edited_at is null
      and not exists (select 1 from public.location_sources o where o.location_id = l.id and o.missing_since is null)
    returning l.id
  )
  select count(*) into hidden_n from hide;

  update public.import_runs set finished_at = now(),
    stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object(
      'flagged_sources', flagged_n, 'hidden_locations', hidden_n, 'public_in_area', public_n)
  where id = p_run;

  return jsonb_build_object('flagged_sources', flagged_n, 'hidden_locations', hidden_n, 'public_in_area', public_n);
end;
$$;

revoke all on function public.import_locations(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_import_run(uuid, boolean) from public, anon, authenticated;
grant execute on function public.import_locations(uuid, jsonb) to service_role;
grant execute on function public.finalize_import_run(uuid, boolean) to service_role;
