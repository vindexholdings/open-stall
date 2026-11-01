-- F1: reviewer-approved SANITIZED publication snapshot. Fail closed; approval bound to one version's hash; independent approver; no raw text, no identity.
\i :ROOT/supabase/tests/feedback/helpers.sql
select pg_temp.mkuser(1) as u1 \gset
select pg_temp.mkadmin(8) as ad \gset
select pg_temp.mkadmin(7) as ad2 \gset
select pg_temp.mkadmin(6) as ad3 \gset
-- an item with sensitive-looking content that must NEVER appear in the public draft unless a reviewer types a safe abstraction
select pg_temp.submit(:'u1'::uuid, pg_temp.key(1), 'Pin jumps when zooming', 'RAWSECRET-marker the pin jumps near my house on Elm Street when zooming in.') ->> 'id' as i1 \gset
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_create_issue(%L, ''Pin jumps when zooming'', ''The map pin moves unexpectedly while zooming the map.'')::text', :'i1'))::jsonb ->> 'issue_id' as iss \gset

-- adversarial text is refused (fail closed) and nothing is stored
create function pg_temp.draft_bad(name text, problem text, repro text default null, hint text default null, ti text default 'Pin jumps when zooming') returns void language plpgsql as $$
declare n0 integer;
begin
  select count(*) into n0 from feedback.drafts;
  perform pg_temp.fails_as('authenticated', pg_temp.f('ad')::uuid, 'aal2',
    format('select public.admin_feedback_draft_save(%L, %L, ''bug'', %L, %L, null, null, null, %L)', pg_temp.f('iss')::uuid, ti, problem, repro, hint), '22023', name);
  perform pg_temp.ok((select count(*) from feedback.drafts) = n0, name || ': nothing stored');
end $$;
select pg_temp.setf('ad', :'ad'), pg_temp.setf('iss', :'iss');
select pg_temp.draft_bad('e-mail address', 'The pin jumps when zooming; write to person@example.org about it');
select pg_temp.draft_bad('link', 'The pin jumps when zooming, see https://example.org/video for it');
select pg_temp.draft_bad('www link', 'The pin jumps when zooming, see www.example.org for it');
select pg_temp.draft_bad('phone number', 'The pin jumps when zooming, call 307-555-0100 for it');
select pg_temp.draft_bad('a long digit run', 'The pin jumps when zooming, order 123456 shows it');
select pg_temp.draft_bad('coordinates', 'The pin jumps when zooming near 44.5263 and -109.0565 exactly');
select pg_temp.draft_bad('a user id', 'The pin jumps for account 00000000-0000-0000-0000-000000000001 when zooming');
select pg_temp.draft_bad('a token-like string', 'The pin jumps when zooming; the token eyJhbGciOiJIUzI1NiJ9abcdefghijklmnopqrstuvwxyz was shown');
select pg_temp.draft_bad('the word password', 'The pin jumps when zooming after the password screen appears');
select pg_temp.draft_bad('a markdown link', 'The pin jumps when zooming, details [here](x) are shown');
select pg_temp.draft_bad('HTML', 'The pin jumps when zooming <img src=x onerror=alert(1)> shown');
select pg_temp.draft_bad('a backslash', 'The pin jumps when zooming and C:\Users\name is shown');
select pg_temp.draft_bad('an unusual character (accented, emoji)', 'The pin jumps when zooming, très bad 😀 for all');
select pg_temp.draft_bad('a title with disallowed characters', 'The pin jumps when zooming on the map screen', null, null, 'Pin jumps {x} `rm -rf`');
select pg_temp.draft_bad('an unsafe repro', 'The pin jumps when zooming on the map screen', 'Open the map at home@example.org then zoom');
select pg_temp.draft_bad('an unsafe hint', 'The pin jumps when zooming on the map screen', null, 'Check https://example.org');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_draft_save(%L, ''Pin jumps when zooming'', ''other'', ''The pin jumps when zooming on the map screen'')', :'iss'), '23514', 'an unknown category is refused by the table');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_draft_save(%L, ''Pin jumps when zooming'', ''bug'', ''The pin jumps when zooming on the map screen'', null, null, ''windows'')', :'iss'), '23514', 'an unknown platform is refused by the table');

-- a valid snapshot: fixed template, the reviewer's OWN words
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_draft_save(%L, ''Pin jumps when zooming'', ''bug'', ''The map pin moves away from its place while the map is being zoomed.'', ''Open the map, zoom in twice, watch the pin.'', ''The pin should stay on the restroom; it moves.'', ''ios'', ''1.2.3'', ''The pin stays still while zooming.'')::text', :'iss'))::jsonb as d1 \gset
select pg_temp.ok((:'d1'::jsonb ->> 'version') = '1' and (:'d1'::jsonb ->> 'body') like 'Category: bug%Problem: The map pin moves away%Build: ios 1.2.3%Acceptance hint: The pin stays still%', 'a valid draft is stored as version 1 in the fixed template');
select pg_temp.ok(not ((:'d1'::jsonb ->> 'body') ~* 'RAWSECRET|Elm Street|my house') and not ((:'d1'::jsonb ->> 'title') ~* 'RAWSECRET|Elm Street'), 'the snapshot contains none of the raw submitted text');
select pg_temp.ok(not ((:'d1'::jsonb ->> 'body') ~ '[0-9a-f]{8}-[0-9a-f]{4}-') and not ((:'d1'::jsonb ->> 'body') ~* 'fb1@|test.invalid'), 'the snapshot contains no identifier or e-mail');
-- the preview is refused until a version is approved
select pg_temp.fails_as('authenticated', :'ad2'::uuid, 'aal2', format('select public.admin_feedback_export_preview(%L)', :'iss'), '55000', 'no export of an unapproved draft');
-- independent review: not the author; wrong hash; only the latest version
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_draft_approve(%L, 1, %L)', :'iss', :'d1'::jsonb ->> 'hash'), '42501', 'the author cannot approve their own draft');
select pg_temp.fails_as('authenticated', :'ad2'::uuid, 'aal2', format('select public.admin_feedback_draft_approve(%L, 1, %L)', :'iss', repeat('0', 64)), '22023', 'approval with a wrong hash is refused');
select pg_temp.fails_as('authenticated', :'ad2'::uuid, 'aal2', format('select public.admin_feedback_draft_approve(%L, 7, %L)', :'iss', :'d1'::jsonb ->> 'hash'), 'P0002', 'approving a version that does not exist is refused');
-- a different administrator approves; the export then returns exactly the approved text
select pg_temp.adm(:'ad2'::uuid, format('select public.admin_feedback_draft_approve(%L, 1, %L)::text', :'iss', :'d1'::jsonb ->> 'hash'));
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_draft_approve(%L, 1, %L)', :'iss', :'d1'::jsonb ->> 'hash'), '55000', 'a version cannot be approved twice');
select pg_temp.adm(:'ad3'::uuid, format('select public.admin_feedback_export_preview(%L)::text', :'iss'))::jsonb as ex \gset
select pg_temp.ok((:'ex'::jsonb ->> 'body') = (:'d1'::jsonb ->> 'body') and (:'ex'::jsonb ->> 'title') = 'Pin jumps when zooming' and (:'ex'::jsonb ->> 'hash') = (:'d1'::jsonb ->> 'hash'), 'the preview is exactly the approved snapshot');
select pg_temp.ok((select array_agg(k order by k) from jsonb_object_keys(:'ex'::jsonb) k) = array['body', 'hash', 'issue_id', 'publication_key', 'title', 'version'], 'the preview carries only the snapshot, its hash and the private publication key');
-- an edit is a NEW version and revokes eligibility
select pg_temp.adm(:'ad3'::uuid, format('select public.admin_feedback_draft_save(%L, ''Pin jumps when zooming'', ''bug'', ''The map pin moves away from its place while zooming the map in and out.'')::text', :'iss'))::jsonb as d2 \gset
select pg_temp.ok((:'d2'::jsonb ->> 'version') = '2' and (:'d2'::jsonb ->> 'hash') <> (:'d1'::jsonb ->> 'hash'), 'an edit creates version 2 with a new hash');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_export_preview(%L)', :'iss'), '55000', 'after an edit the export is refused (the new version is not approved)');
select pg_temp.fails_as('authenticated', :'ad2'::uuid, 'aal2', format('select public.admin_feedback_draft_approve(%L, 1, %L)', :'iss', :'d1'::jsonb ->> 'hash'), '55000', 'the old version cannot be re-approved once superseded');
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_draft_approve(%L, 2, %L)', :'iss', :'d2'::jsonb ->> 'hash'), '42501', 'the author of version 2 cannot approve it');
select pg_temp.adm(:'ad2'::uuid, format('select public.admin_feedback_draft_approve(%L, 2, %L)::text', :'iss', :'d2'::jsonb ->> 'hash'));
select pg_temp.ok((pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_export_preview(%L)::text', :'iss'))::jsonb ->> 'version') = '2', 'version 2 becomes exportable once approved');
-- immutability of every draft version
select pg_temp.fails('update feedback.drafts set body = ''changed''', '42501', 'a draft body cannot be edited');
select pg_temp.fails('update feedback.drafts set approved_hash = ''x'' where version = 1', '42501', 'an approval cannot be rewritten');
select pg_temp.fails('delete from feedback.drafts', '42501', 'a draft cannot be deleted');
-- an administrator cannot approve a publication built from THEIR OWN feedback (independent review of admin-authored feedback)
select pg_temp.submit(:'ad2'::uuid, pg_temp.key(60), 'Own pin jumps report', 'An administrator reports that the pin jumps when zooming here.') ->> 'id' as own \gset
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_link_duplicate(%L, %L)::text', :'own', :'iss'));
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_draft_save(%L, ''Pin jumps when zooming'', ''bug'', ''The map pin moves away from its place while the map is zoomed in.'')::text', :'iss'))::jsonb as d3 \gset
select pg_temp.fails_as('authenticated', :'ad2'::uuid, 'aal2', format('select public.admin_feedback_draft_approve(%L, 3, %L)', :'iss', :'d3'::jsonb ->> 'hash'), '42501', 'an administrator cannot approve a publication that includes their own feedback');
select pg_temp.ok((pg_temp.adm(:'ad3'::uuid, format('select public.admin_feedback_draft_approve(%L, 3, %L)::text', :'iss', :'d3'::jsonb ->> 'hash'))::jsonb ->> 'approved') = 'true', 'an independent administrator can');
-- the stored raw text is still only in the raw table
select pg_temp.ok(not exists (select 1 from feedback.drafts where body ~* 'RAWSECRET' or title ~* 'RAWSECRET') and not exists (select 1 from feedback.issues where title ~* 'RAWSECRET' or summary ~* 'RAWSECRET'), 'no draft or issue anywhere contains the raw marker');
select pg_temp.finish();
