-- DESTRUCTIVE, HUMAN-RUN ONLY (not a migration). Removes DEVELOPMENT OSM seed data so it can be
-- replaced by independently verified Open Stall data.
-- Deletes a location ONLY if ALL of these hold:
--   * it was seen by an importer run whose area_name ends in "-dev" (the dev run);
--   * it has NO non-OSM source (no manual/research/other provenance);
--   * it is still hidden-or-unverified (status candidate or unverified), never edited by a human
--     (manually_edited_at is null) and never promoted to verified/pending/closed.
-- Anything verified, edited, user-submitted or multi-source is kept and must be handled deliberately.
-- Source rows go with their locations (cascade). Then the dev run rows are removed.
delete from public.locations l
where l.status in ('candidate', 'unverified')
  and l.manually_edited_at is null
  and exists (
    select 1 from public.location_sources s
    where s.location_id = l.id and s.source = 'osm'
      and s.last_seen_run in (select id from public.import_runs where source = 'osm' and area_name like '%-dev')
  )
  and not exists (
    select 1 from public.location_sources s where s.location_id = l.id and s.source <> 'osm'
  );

delete from public.import_runs where source = 'osm' and area_name like '%-dev';
