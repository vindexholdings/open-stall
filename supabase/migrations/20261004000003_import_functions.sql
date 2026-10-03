-- Importer merge logic, enforced in the database so no client or script can bypass it.
-- Callable ONLY by service_role (server-side). Rules:
--   * New records: explicit evidence -> 'unverified' (public, badged); anything else -> 'candidate' (hidden).
--   * Existing verified/pending/closed or admin-edited records are NEVER overwritten by import;
--     only provenance/refresh fields (tags, hash, last seen) are updated.
--   * Existing unverified/candidate records are refreshed from source; status follows current evidence
--     (upgrade candidate->unverified, downgrade unverified->candidate).
--   * Idempotent: (source, source_reference) is unique; reruns update, never duplicate.

create or replace function public.import_locations(p_run uuid, p_records jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r record;
  ex public.locations%rowtype;
  new_status text;
  inserted_n int := 0;
  updated_n int := 0;
  unchanged_n int := 0;
  protected_n int := 0;
begin
  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'p_records must be a JSON array';
  end if;
  if not exists (select 1 from public.import_runs where id = p_run) then
    raise exception 'unknown import run %', p_run;
  end if;

  for r in
    select * from jsonb_to_recordset(p_records) as x(
      source text, source_reference text, name text, address_line text, city text,
      region text, postal_code text, latitude double precision, longitude double precision,
      evidence text, wheelchair_accessible boolean, gender_neutral boolean,
      baby_changing boolean, has_hot_water boolean, has_cold_water boolean,
      key_required boolean, purchase_required boolean, access_location text,
      source_license text, source_attribution text, source_tags jsonb, source_hash text
    )
  loop
    if r.source not in ('osm', 'import') then
      raise exception 'importer may only write source osm/import, got %', r.source;
    end if;
    if r.source_reference is null or r.evidence not in ('inferred', 'explicit') then
      raise exception 'record needs source_reference and evidence inferred|explicit';
    end if;
    new_status := case when r.evidence = 'explicit' then 'unverified' else 'candidate' end;

    select * into ex from public.locations
      where source = r.source and source_reference = r.source_reference
      for update;

    if not found then
      insert into public.locations (
        name, address_line, city, region, postal_code, latitude, longitude,
        status, restroom_evidence, source, source_reference, source_license, source_attribution,
        source_tags, source_hash, last_seen_run, last_seen_at,
        wheelchair_accessible, gender_neutral, baby_changing, has_hot_water, has_cold_water,
        key_required, purchase_required, access_location
      ) values (
        r.name, r.address_line, r.city, r.region, r.postal_code, r.latitude, r.longitude,
        new_status, r.evidence, r.source, r.source_reference, r.source_license, r.source_attribution,
        r.source_tags, r.source_hash, p_run, now(),
        r.wheelchair_accessible, r.gender_neutral, r.baby_changing, r.has_hot_water, r.has_cold_water,
        r.key_required, r.purchase_required, r.access_location
      );
      inserted_n := inserted_n + 1;

    elsif ex.status in ('verified', 'pending', 'closed') or ex.manually_edited_at is not null then
      update public.locations set
        source_tags = r.source_tags, source_hash = r.source_hash,
        last_seen_run = p_run, last_seen_at = now(), source_missing_since = null
      where id = ex.id;
      protected_n := protected_n + 1;

    elsif ex.source_hash is not distinct from r.source_hash and ex.status = new_status then
      update public.locations set
        last_seen_run = p_run, last_seen_at = now(), source_missing_since = null
      where id = ex.id;
      unchanged_n := unchanged_n + 1;

    else
      update public.locations set
        name = r.name, address_line = r.address_line, city = r.city, region = r.region,
        postal_code = r.postal_code, latitude = r.latitude, longitude = r.longitude,
        status = new_status, restroom_evidence = r.evidence,
        source_license = r.source_license, source_attribution = r.source_attribution,
        source_tags = r.source_tags, source_hash = r.source_hash,
        last_seen_run = p_run, last_seen_at = now(), source_missing_since = null,
        wheelchair_accessible = r.wheelchair_accessible, gender_neutral = r.gender_neutral,
        baby_changing = r.baby_changing, has_hot_water = r.has_hot_water,
        has_cold_water = r.has_cold_water, key_required = r.key_required,
        purchase_required = r.purchase_required, access_location = r.access_location
      where id = ex.id;
      updated_n := updated_n + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'inserted', inserted_n, 'updated', updated_n,
    'unchanged', unchanged_n, 'protected', protected_n
  );
end;
$$;

-- Call ONLY after a COMPLETE successful pass over the run's whole area. Records of the run's
-- source inside the run's bounds that were not seen are flagged missing; unverified ones are
-- hidden (-> candidate) and verified ones are only flagged for admin review.
create or replace function public.finalize_import_run(p_run uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  run public.import_runs%rowtype;
  hidden_n int := 0;
  flagged_n int := 0;
begin
  select * into run from public.import_runs where id = p_run;
  if not found then
    raise exception 'unknown import run %', p_run;
  end if;

  with stale as (
    select id, status, manually_edited_at from public.locations
    where source = run.source
      and status in ('verified', 'unverified', 'candidate')
      and last_seen_run is distinct from p_run
      and source_missing_since is null
      and latitude between (run.bounds->>'min_lat')::float8 and (run.bounds->>'max_lat')::float8
      and longitude between (run.bounds->>'min_lng')::float8 and (run.bounds->>'max_lng')::float8
  ), upd as (
    update public.locations l set
      source_missing_since = now(),
      status = case when s.status = 'unverified' and s.manually_edited_at is null
                    then 'candidate' else l.status end
    from stale s where l.id = s.id
    returning s.status as old_status, s.manually_edited_at
  )
  select
    count(*) filter (where old_status = 'unverified' and manually_edited_at is null),
    count(*)
  into hidden_n, flagged_n from upd;

  update public.import_runs set finished_at = now(),
    stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hidden_missing', hidden_n, 'flagged_missing', flagged_n)
  where id = p_run;

  return jsonb_build_object('hidden_missing', hidden_n, 'flagged_missing', flagged_n);
end;
$$;

revoke all on function public.import_locations(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_import_run(uuid) from public, anon, authenticated;
grant execute on function public.import_locations(uuid, jsonb) to service_role;
grant execute on function public.finalize_import_run(uuid) to service_role;
