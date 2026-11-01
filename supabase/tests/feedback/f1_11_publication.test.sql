-- F2: the reviewer-approved, sanitized publication bridge (private state machine with an ATTEMPT FENCE). Synthetic data only; nothing here talks to GitHub: the connector is the
-- human side and these tests drive the recorded protocol results (success + read-back, timeout after remote success, forged/mismatched answers, multiple matches, late
-- results of older attempts, absence evidence).
\i :ROOT/supabase/tests/feedback/helpers.sql
select pg_temp.mkuser(1) as u1 \gset
select pg_temp.mkuser(2) as u2 \gset
select pg_temp.mkuser(3) as u3 \gset
select pg_temp.mkuser(9) as u9 \gset
select pg_temp.mkuser(10) as u10 \gset
select pg_temp.mkuser(11) as u11 \gset
select pg_temp.mkuser(12) as u12 \gset
select pg_temp.mkadmin(8) as ad \gset
select pg_temp.mkadmin(7) as ad2 \gset
select pg_temp.mkadmin(6) as ad3 \gset
select pg_temp.mkadmin(5) as ad4 \gset
select pg_temp.mkadmin(4, true) as adx \gset
select pg_temp.setf('ad', :'ad'), pg_temp.setf('ad2', :'ad2'), pg_temp.setf('ad3', :'ad3'), pg_temp.setf('ad4', :'ad4');

create function pg_temp.pr(a uuid, fn text, args text default '') returns jsonb language plpgsql as $$
begin return pg_temp.adm(a, format('select public.%I(%s)::text', fn, args))::jsonb; end $$;
create function pg_temp.mkissue(creator uuid, owner uuid, k integer, ti text) returns text language plpgsql as $$
declare it text; iss text;
begin
  it := pg_temp.submit(owner, pg_temp.key(k), ti, 'RAWSECRET-marker the pin jumps near my house on Elm Street when zooming in.') ->> 'id';
  iss := pg_temp.pr(creator, 'admin_feedback_create_issue', format('%L, %L, %L', it, ti, 'The map pin moves unexpectedly while zooming the map.')) ->> 'issue_id';
  return iss;
end $$;
create function pg_temp.approve_new(issue text, author uuid, approver uuid, problem text default 'The pin jumps when zooming on the map screen') returns text language plpgsql as $$
declare ds jsonb;
begin
  ds := pg_temp.pr(author, 'admin_feedback_draft_save', format('%L, %L, ''bug'', %L', issue, 'Pin jumps when zooming', problem));
  perform pg_temp.pr(approver, 'admin_feedback_draft_approve', format('%L, %s, %L', issue, ds ->> 'version', ds ->> 'hash'));
  return ds ->> 'hash';
end $$;
create function pg_temp.pub(issue text) returns jsonb language sql as $$ select to_jsonb(p) from feedback.publications p where p.issue_id = issue::uuid $$;
-- the argument strings of the RPCs
create function pg_temp.ver(mk text, eh text, num integer) returns text language sql as $$
  select format(', ''vindexholdings/open-stall'', %s, ''https://github.com/vindexholdings/open-stall/issues/%s'', %L, %L', num, num, mk, eh) $$;
create function pg_temp.evid(since timestamptz, pages integer, scanned integer, complete boolean) returns text language sql as $$
  select format(', null, null, null, null, null, %L, %s, %s, %s', since, coalesce(pages::text, 'null'), coalesce(scanned::text, 'null'), coalesce(complete::text, 'null')) $$;
create function pg_temp.rpt(a uuid, issue text, att integer, outcome text, extra text default '') returns jsonb language plpgsql as $$
begin return pg_temp.adm(a, format('select public.admin_feedback_publication_report(%L, %s, %L%s)::text', issue, att, outcome, extra))::jsonb; end $$;
create function pg_temp.rpt_fails(a uuid, issue text, att integer, outcome text, extra text, code text, name text) returns void language plpgsql as $$
begin perform pg_temp.fails_as('authenticated', a, 'aal2', format('select public.admin_feedback_publication_report(%L, %s, %L%s)', issue, att, outcome, extra), code, name); end $$;
-- a full cycle to a verified published issue: request -> begin -> dispatch -> created (verified read-back); returns the marker and expected hash
create function pg_temp.publish_as(issue text, publisher uuid, num integer) returns jsonb language plpgsql as $$
declare rq jsonb; pk jsonb; att integer;
begin
  rq := pg_temp.pr(publisher, 'admin_feedback_publication_request', format('%L', issue));
  pk := pg_temp.pr(publisher, 'admin_feedback_publication_begin', format('%L', issue));
  att := (pk ->> 'attempt')::int;
  perform pg_temp.pr(publisher, 'admin_feedback_publication_dispatch', format('%L, %s', issue, att));
  perform pg_temp.rpt(publisher, issue, att, case when pk ->> 'operation' = 'update' then 'updated' else 'created' end, pg_temp.ver(rq ->> 'marker', rq ->> 'expected_hash', num));
  return rq;
end $$;

select pg_temp.mkissue(:'ad'::uuid, :'u1'::uuid, 1, 'Pin jumps when zooming') as iss \gset
select pg_temp.setf('iss', :'iss');

-- ===== authorization: every publication RPC opens with the existing admin gate (aal2 admin), so every other caller is refused
select pg_temp.fails_as(r, s, a, format('select public.%I(%L%s)', fn, :'iss', extra), '42501', fn || ' refused for ' || label)
  from (values ('anon', null::uuid, null::text, 'anonymous'), ('authenticated', :'u1'::uuid, 'aal2', 'an ordinary user'), ('authenticated', :'ad2'::uuid, 'aal1', 'an administrator without a second factor'),
               ('authenticated', :'adx'::uuid, 'aal2', 'a disabled administrator')) v(r, s, a, label),
       (values ('admin_feedback_publication_get', ''), ('admin_feedback_publication_request', ''), ('admin_feedback_publication_begin', ''),
               ('admin_feedback_publication_dispatch', ', 1'), ('admin_feedback_publication_report', ', 1, ''uncertain''')) f(fn, extra);
select pg_temp.fails_as('service_role', null, null, format('select public.admin_feedback_publication_get(%L)', :'iss'), '42501', 'service_role cannot call the publication RPCs (no shortcut)');

-- ===== not eligible yet: nothing can be requested before an independent approval
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_request(%L)', :'iss'), '55000', 'no publication request without any draft');
select pg_temp.pr(:'ad'::uuid, 'admin_feedback_draft_save', format('%L, ''Pin jumps when zooming'', ''bug'', ''The pin jumps when zooming on the map screen''', :'iss')) as ds1 \gset
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_request(%L)', :'iss'), '55000', 'no publication request for an unapproved draft');
select pg_temp.ok((pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_get', format('%L', :'iss')) ->> 'status') = 'none', 'before a request the publication state is none');
select pg_temp.pr(:'ad2'::uuid, 'admin_feedback_draft_approve', format('%L, 1, %L', :'iss', :'ds1'::jsonb ->> 'hash')) as _ \gset

-- ===== request: a ready publication tied to the approved immutable snapshot (no attempt yet)
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_request', format('%L', :'iss')) as rq \gset
select pg_temp.ok((:'rq'::jsonb ->> 'status') = 'ready' and (:'rq'::jsonb ->> 'operation') = 'create' and (:'rq'::jsonb ->> 'replayed') = 'false' and (:'rq'::jsonb ->> 'marker') ~ '^OSFB-[0-9a-f]{20}$' and (:'rq'::jsonb ->> 'attempt') = '0', 'an eligible approved snapshot becomes a ready create request with an opaque marker and no attempt yet');
select pg_temp.ok((:'rq'::jsonb ->> 'expected_hash') = encode(sha256(convert_to((select d.title || E'\x1e' || d.body || E'\n\nFeedback reference: ' || (:'rq'::jsonb ->> 'marker') from feedback.drafts d where d.issue_id = :'iss'::uuid and d.version = 1), 'UTF8')), 'hex'), 'the expected readback hash is the independent sha256 of the exact title + body + reference line');
select pg_temp.ok(not (:'rq'::text ~* (:'u1' || '|' || :'ad' || '|' || :'ad2' || '|' || :'ad3' || '|RAWSECRET|Elm Street')) and not (:'rq'::text ~ (select i.publication_key::text from feedback.issues i where i.id = :'iss'::uuid)) and not (:'rq'::text ~ (select l.item_id::text from feedback.item_links l where l.issue_id = :'iss'::uuid)),
  'the publication view carries no user, admin, raw-item or private-key identifier and none of the raw text');
select pg_temp.ok((pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_request', format('%L', :'iss')) ->> 'status') = 'ready' and (select count(*) from feedback.publications where issue_id = :'iss'::uuid) = 1, 'a repeated request refreshes the same single publication (one per canonical issue)');
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_dispatch(%L, 1)', :'iss'), '55000', 'nothing can be dispatched before an attempt is prepared');

-- ===== begin: ONE attempt is PREPARED and only a preview exists; nothing is released
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_begin', format('%L', :'iss')) as pk \gset
select pg_temp.ok((select array_agg(k order by k) from jsonb_object_keys(:'pk'::jsonb) k) = array['attempt', 'body', 'expected_hash', 'issue_number', 'marker', 'operation', 'phase', 'repo', 'title', 'version'], 'the packet has exactly the allowlisted fields (never a serialization of the private issue)');
select pg_temp.ok((:'pk'::jsonb ->> 'phase') = 'preview' and (:'pk'::jsonb ->> 'attempt') = '1' and (:'pk'::jsonb ->> 'repo') = 'vindexholdings/open-stall' and (:'pk'::jsonb ->> 'body') like '%Feedback reference: ' || (:'rq'::jsonb ->> 'marker'), 'begin returns a PREVIEW for attempt 1 (not executable), destination only vindexholdings/open-stall, with the safe reference line');
select pg_temp.ok(not (:'pk'::text ~* (:'u1' || '|' || :'ad' || '|RAWSECRET|Elm Street|' || (select l.item_id::text from feedback.item_links l where l.issue_id = :'iss'::uuid))), 'the packet contains no identifier and no raw submission text');
select pg_temp.ok((pg_temp.pub(:'iss') ->> 'status') = 'prepared' and (pg_temp.pub(:'iss') ->> 'attempt') = '1' and (pg_temp.pub(:'iss') ->> 'dispatched_at') is null, 'the publication is prepared for attempt 1 and nothing was released');
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_begin(%L)', :'iss'), '55000', 'a second begin is refused while an attempt is prepared');
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_request(%L)', :'iss'), '55000', 'a new request is refused while an attempt is in progress');
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_dispatch(%L, 2)', :'iss'), '55000', 'dispatching another generation is refused (stale/unknown attempt)');
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss', 1, 'created', pg_temp.ver(:'rq'::jsonb ->> 'marker', :'rq'::jsonb ->> 'expected_hash', 7), '55000', 'a created result for a prepared (never released) attempt is refused');
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss', 1, 'uncertain', '', '55000', 'an uncertain result for a prepared (never released) attempt is refused');

-- ===== dispatch releases the EXECUTABLE packet exactly once
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_dispatch', format('%L, 1', :'iss')) as disp \gset
select pg_temp.ok((:'disp'::jsonb ->> 'phase') = 'transfer' and (:'disp'::jsonb - 'phase') = (:'pk'::jsonb - 'phase'), 'dispatch releases the executable packet: identical to the preview except its phase');
select pg_temp.ok((pg_temp.pub(:'iss') ->> 'status') = 'dispatched' and (pg_temp.pub(:'iss') ->> 'dispatched_at') is not null, 'the attempt is now dispatched (the outcome is unknown to this system)');
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_dispatch(%L, 1)', :'iss'), '55000', 'the SAME attempt can never be dispatched twice (the same packet cannot be executed twice)');
select pg_temp.fails_as('authenticated', :'ad4'::uuid, 'aal2', format('select public.admin_feedback_publication_dispatch(%L, 1)', :'iss'), '55000', 'nor can another operator dispatch it (simultaneous/reloaded recovery)');
select pg_temp.ok((pg_temp.pr(:'ad4'::uuid, 'admin_feedback_publication_get', format('%L', :'iss')) -> 'packet' ->> 'phase') = 'readback' and (pg_temp.pr(:'ad4'::uuid, 'admin_feedback_publication_get', format('%L', :'iss')) -> 'packet' ->> 'body') = (:'pk'::jsonb ->> 'body'), 'a reload sees the exact approved text only as a READ-BACK reference, never as an executable transfer packet');
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_begin(%L)', :'iss'), '55000', 'no new begin while the attempt is unresolved');
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_request(%L)', :'iss'), '55000', 'no new request while the attempt is unresolved');
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss', 1, 'cancelled', '', '55000', 'a dispatched attempt cannot be cancelled (it may have run)');
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss', 1, 'none_found', pg_temp.evid(now() - interval '1 day', 3, 10, true), '55000', 'none_found is not a result of a fresh dispatched attempt (it must be reported uncertain first)');

-- ===== reconcile BEFORE retrying: a timeout after remote success is uncertain, never proof that nothing was created
select pg_temp.rpt(:'ad3'::uuid, :'iss', 1, 'uncertain') as _ \gset
select pg_temp.ok((pg_temp.pub(:'iss') ->> 'status') = 'uncertain', 'a timeout is recorded as uncertain');
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_begin(%L)', :'iss'), '55000', 'no blind second create after an uncertain outcome (begin)');
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_dispatch(%L, 1)', :'iss'), '55000', 'no blind second create after an uncertain outcome (dispatch)');
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_request(%L)', :'iss'), '55000', 'no new request while uncertain');
-- reconciliation finds several issues carrying the marker: fail closed
select pg_temp.rpt(:'ad3'::uuid, :'iss', 1, 'multiple') as _ \gset
select pg_temp.ok((pg_temp.pub(:'iss') ->> 'status') = 'conflict', 'multiple matches fail closed into conflict for manual resolution');
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss', 1, 'none_found', pg_temp.evid(now() - interval '1 day', 3, 10, true), '55000', 'a conflict cannot be reopened by an absence claim');
-- forged / mismatched evidence never publishes (each is recorded as a failed verification and the state stays conflict)
create function pg_temp.bad_report(label text, args text) returns void language plpgsql as $$
declare n0 integer; st text;
begin
  select count(*) into n0 from feedback.publication_events where detail = 'verification_failed';
  perform pg_temp.pr(pg_temp.f('ad3')::uuid, 'admin_feedback_publication_report', format('%L, 1, ''found''%s', pg_temp.f('iss'), args));
  st := (select p.status from feedback.publications p where p.issue_id = pg_temp.f('iss')::uuid);
  perform pg_temp.ok(st = 'conflict' and (select count(*) from feedback.publication_events where detail = 'verification_failed') = n0 + 1 and (select issue_number from feedback.publications where issue_id = pg_temp.f('iss')::uuid) is null, label || ': refused, still conflict, nothing mapped');
end $$;
select pg_temp.setf('mk', :'rq'::jsonb ->> 'marker'), pg_temp.setf('eh', :'rq'::jsonb ->> 'expected_hash');
select :'rq'::jsonb ->> 'marker' as mk, :'rq'::jsonb ->> 'expected_hash' as eh \gset
select pg_temp.bad_report('wrong repository (everything else correct)', format(', ''someone/else'', 7, ''https://github.com/vindexholdings/open-stall/issues/7'', %L, %L', :'mk', :'eh'));
select pg_temp.bad_report('a foreign repository with a matching foreign URL', format(', ''someone/else'', 7, ''https://github.com/someone/else/issues/7'', %L, %L', :'mk', :'eh'));
select pg_temp.bad_report('a URL that does not match the number', format(', ''vindexholdings/open-stall'', 7, ''https://github.com/vindexholdings/open-stall/issues/8'', %L, %L', :'mk', :'eh'));
select pg_temp.bad_report('an arbitrary URL', format(', ''vindexholdings/open-stall'', 7, ''https://evil.example/open-stall/issues/7'', %L, %L', :'mk', :'eh'));
select pg_temp.bad_report('a wrong marker', format(', ''vindexholdings/open-stall'', 7, ''https://github.com/vindexholdings/open-stall/issues/7'', ''OSFB-00000000000000000000'', %L', :'eh'));
select pg_temp.bad_report('a wrong readback hash (edited or other snapshot)', format(', ''vindexholdings/open-stall'', 7, ''https://github.com/vindexholdings/open-stall/issues/7'', %L, %L', :'mk', repeat('a', 64)));
select pg_temp.bad_report('a missing readback hash', format(', ''vindexholdings/open-stall'', 7, ''https://github.com/vindexholdings/open-stall/issues/7'', %L', :'mk'));
select pg_temp.bad_report('a missing number', format(', ''vindexholdings/open-stall'', null, null, %L, %L', :'mk', :'eh'));
select pg_temp.bad_report('no evidence at all', '');
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_report(%L, 1, ''bogus'')', :'iss'), '22023', 'an unknown outcome is refused');
-- verified evidence resolves the conflict and records the mapping ONCE
select pg_temp.rpt(:'ad3'::uuid, :'iss', 1, 'found', pg_temp.ver(:'mk', :'eh', 7)) as okr \gset
select pg_temp.ok((:'okr'::jsonb ->> 'status') = 'published' and (:'okr'::jsonb ->> 'issue_number') = '7' and (:'okr'::jsonb ->> 'issue_url') = 'https://github.com/vindexholdings/open-stall/issues/7', 'verified evidence publishes and records the mapping');
select pg_temp.ok((select array_agg(detail order by id) from feedback.publication_events where publication_id = (select id from feedback.publications where issue_id = :'iss'::uuid))
  = array['requested', 'refreshed', 'prepared', 'dispatched', 'uncertain', 'multiple_matches'] || array_fill('verification_failed'::text, array[9]) || array['published'], 'the append-only event history records every step with a fixed code (no free text)');
select pg_temp.ok((select bool_and(attempt = 1) from feedback.publication_events where publication_id = (select id from feedback.publications where issue_id = :'iss'::uuid) and detail <> 'requested' and detail <> 'refreshed'), 'every event of the attempt carries its generation');
select pg_temp.fails('update feedback.publications set issue_number = 99, issue_url = ''https://github.com/vindexholdings/open-stall/issues/99''', '42501', 'the recorded mapping is immutable even to the table owner');
select pg_temp.fails('update feedback.publications set marker = ''OSFB-11111111111111111111''', '42501', 'the marker is immutable');
select pg_temp.fails('update feedback.publications set attempt = attempt + 5', '42501', 'the attempt generation is server-owned (no jump)');
select pg_temp.fails('delete from feedback.publications', '42501', 'a publication cannot be deleted directly');
select pg_temp.fails('update feedback.publication_events set detail = ''published''', '42501', 'events are append-only');
select pg_temp.fails('delete from feedback.publication_events', '42501', 'events cannot be deleted');
select pg_temp.fails('update feedback.publications set status = ''prepared''', '22023', 'an invalid transition (published -> prepared) is refused by the guard');

-- ===== exact replay returns the verified mapping and creates nothing
select count(*) as ev0 from feedback.publication_events \gset
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_request', format('%L', :'iss')) as rp \gset
select pg_temp.ok((:'rp'::jsonb ->> 'replayed') = 'true' and (:'rp'::jsonb ->> 'issue_number') = '7' and (select count(*) from feedback.publication_events) = :ev0, 'an exact replay returns the verified mapping and records nothing new');
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss', 1, 'found', pg_temp.ver(:'mk', :'eh', 7), '55000', 'a report with no transfer awaiting is refused');

-- ===== a later edited snapshot is an UPDATE of the SAME GitHub issue, never a second create
select pg_temp.approve_new(:'iss', :'ad'::uuid, :'ad2'::uuid, 'The pin jumps when zooming on the map screen again') as h2 \gset
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_request', format('%L', :'iss')) as rq2 \gset
select pg_temp.ok((:'rq2'::jsonb ->> 'status') = 'ready' and (:'rq2'::jsonb ->> 'operation') = 'update' and (:'rq2'::jsonb ->> 'issue_number') = '7' and (:'rq2'::jsonb ->> 'version') = '2' and (:'rq2'::jsonb ->> 'marker') = :'mk' and (:'rq2'::jsonb ->> 'dispatched_at') is null, 'a newer approved version of a published issue becomes an update of the same issue and marker');
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_begin', format('%L', :'iss')) as pk2 \gset
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_dispatch', format('%L, 2', :'iss')) as disp2 \gset
select pg_temp.ok((:'disp2'::jsonb ->> 'operation') = 'update' and (:'disp2'::jsonb ->> 'issue_number') = '7' and (:'disp2'::jsonb ->> 'expected_hash') <> :'eh' and (:'disp2'::jsonb ->> 'attempt') = '2', 'the update packet targets issue 7 with the new expected hash for attempt 2');
-- a late result of the OLD attempt can neither publish nor fail the new one
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss', 1, 'failed', '', '55000', 'a late FAILED result of attempt 1 is rejected against attempt 2');
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss', 1, 'uncertain', '', '55000', 'a late UNCERTAIN result of attempt 1 is rejected against attempt 2');
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss', 1, 'found', pg_temp.ver(:'mk', :'eh', 7), '55000', 'a late verified result of attempt 1 is rejected against attempt 2');
select pg_temp.ok((pg_temp.pub(:'iss') ->> 'status') = 'dispatched' and (pg_temp.pub(:'iss') ->> 'attempt') = '2', 'state is unchanged by the stale results');
-- a create-style or wrong-number report never re-points the mapping
select pg_temp.rpt(:'ad3'::uuid, :'iss', 2, 'created', pg_temp.ver(:'mk', :'disp2'::jsonb ->> 'expected_hash', 7)) as crt \gset
select pg_temp.ok((:'crt'::jsonb ->> 'status') = 'conflict' and (:'crt'::jsonb ->> 'issue_number') = '7', 'even the SAME issue number is a conflict when reported as a fresh create after a mapping exists (a create can never follow a recorded mapping)');
select pg_temp.rpt(:'ad3'::uuid, :'iss', 2, 'found', pg_temp.ver(:'mk', :'disp2'::jsonb ->> 'expected_hash', 8)) as _ \gset
select pg_temp.ok((pg_temp.pub(:'iss') ->> 'status') = 'conflict' and (pg_temp.pub(:'iss') ->> 'issue_number') = '7', 'a result pointing at another issue number never re-points the mapping');
select pg_temp.rpt(:'ad3'::uuid, :'iss', 2, 'found', pg_temp.ver(:'mk', :'disp2'::jsonb ->> 'expected_hash', 7)) as okr2 \gset
select pg_temp.ok((:'okr2'::jsonb ->> 'status') = 'published' and (:'okr2'::jsonb ->> 'issue_number') = '7' and (:'okr2'::jsonb ->> 'published_hash') = (:'disp2'::jsonb ->> 'expected_hash'), 'verified read-back of version 2 resolves the conflict and publishes on the same issue');

-- ===== the clean update path: verified 'updated'
select pg_temp.mkissue(:'ad'::uuid, :'u9'::uuid, 12, 'Share button label is unclear') as issu \gset
select pg_temp.approve_new(:'issu', :'ad'::uuid, :'ad2'::uuid, 'The share button label is unclear on the detail screen') as _ \gset
select pg_temp.publish_as(:'issu', :'ad3'::uuid, 21) as rqu \gset
select pg_temp.ok((pg_temp.pub(:'issu') ->> 'status') = 'published' and (pg_temp.pub(:'issu') ->> 'issue_number') = '21', 'setup: a clean create publishes issue 21 after request, begin, dispatch and a verified result');
select pg_temp.approve_new(:'issu', :'ad'::uuid, :'ad2'::uuid, 'The share button label is still unclear on the detail screen') as _ \gset
select pg_temp.publish_as(:'issu', :'ad3'::uuid, 21) as rqu2 \gset
select pg_temp.ok((pg_temp.pub(:'issu') ->> 'status') = 'published' and (pg_temp.pub(:'issu') ->> 'attempt') = '2' and (pg_temp.pub(:'issu') ->> 'published_hash') <> (:'rqu'::jsonb ->> 'expected_hash'), 'a verified UPDATE publishes the new version on issue 21 as attempt 2');

-- ===== two canonical issues can never claim the same GitHub issue
select pg_temp.mkissue(:'ad'::uuid, :'u2'::uuid, 2, 'List screen shows an old distance') as iss2 \gset
select pg_temp.approve_new(:'iss2', :'ad'::uuid, :'ad2'::uuid, 'The list shows an old distance after moving') as _ \gset
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_request', format('%L', :'iss2')) as rqb \gset
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_begin', format('%L', :'iss2')) as _ \gset
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_dispatch', format('%L, 1', :'iss2')) as _ \gset
select pg_temp.rpt(:'ad3'::uuid, :'iss2', 1, 'created', pg_temp.ver(:'rqb'::jsonb ->> 'marker', :'rqb'::jsonb ->> 'expected_hash', 7)) as _ \gset
select pg_temp.ok((pg_temp.pub(:'iss2') ->> 'status') = 'conflict' and (pg_temp.pub(:'iss2') ->> 'issue_number') is null, 'a second canonical issue reporting the same GitHub issue number is a conflict');

-- ===== absence: only EXHAUSTIVE evidence reopens a create (an empty or partial search is never enough)
select pg_temp.mkissue(:'ad'::uuid, :'u3'::uuid, 3, 'Add restroom form loses text') as iss3 \gset
select pg_temp.approve_new(:'iss3', :'ad'::uuid, :'ad2'::uuid, 'The add restroom form loses the typed text on rotate') as _ \gset
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_request', format('%L', :'iss3')) as rqc \gset
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_begin', format('%L', :'iss3')) as _ \gset
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_dispatch', format('%L, 1', :'iss3')) as _ \gset
select pg_temp.rpt(:'ad3'::uuid, :'iss3', 1, 'uncertain') as _ \gset
select (pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_get', format('%L', :'iss3')) ->> 'since')::timestamptz as since3 \gset
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss3', 1, 'none_found', '', '22023', 'none_found with NO evidence is refused (an empty search proves nothing)');
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss3', 1, 'none_found', pg_temp.evid(:'since3'::timestamptz, 3, 10, false), '22023', 'an INCOMPLETE listing is not absence');
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss3', 1, 'none_found', pg_temp.evid(:'since3'::timestamptz, 3, 10, null), '22023', 'an unknown completeness is not absence');
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss3', 1, 'none_found', pg_temp.evid(:'since3'::timestamptz, 0, 10, true), '22023', 'zero pages checked is not absence');
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss3', 1, 'none_found', pg_temp.evid(:'since3'::timestamptz, 51, 10, true), '22023', 'an out-of-bounds page count is refused');
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss3', 1, 'none_found', pg_temp.evid(:'since3'::timestamptz, 3, null, true), '22023', 'a missing scanned count is refused');
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss3', 1, 'none_found', pg_temp.evid(now() + interval '1 hour', 3, 10, true), '22023', 'a listing that started AFTER the transfer was released cannot show absence');
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss3', 1, 'none_found', pg_temp.evid(:'since3'::timestamptz + interval '1 second', 3, 10, true), '22023', 'a listing that starts after the safety margin before the release cannot show absence');
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss3', 1, 'none_found', pg_temp.evid(:'since3'::timestamptz - interval '30 days', 3, 10, true), '22023', 'an absurdly old window is refused');
select pg_temp.ok((pg_temp.pub(:'iss3') ->> 'status') = 'uncertain', 'none of those refusals changed the uncertain state');
select pg_temp.rpt(:'ad3'::uuid, :'iss3', 1, 'none_found', pg_temp.evid(:'since3'::timestamptz, 3, 120, true)) as nf \gset
select pg_temp.ok((:'nf'::jsonb ->> 'status') = 'ready' and (:'nf'::jsonb ->> 'dispatched_at') is null, 'a complete listing that started before the release shows absence: ready again');
select pg_temp.ok((select pages_checked = 3 and issues_scanned = 120 from feedback.publication_events where publication_id = (select id from feedback.publications where issue_id = :'iss3'::uuid) and detail = 'absence_verified'), 'what was actually checked (pages, issues scanned) is recorded with the event');
-- a prepared attempt that was never released can simply be cancelled
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_begin', format('%L', :'iss3')) as pk3 \gset
select pg_temp.ok((:'pk3'::jsonb ->> 'attempt') = '2' and (pg_temp.pub(:'iss3') ->> 'status') = 'prepared', 'the next begin is a NEW generation (attempt 2)');
select pg_temp.rpt(:'ad3'::uuid, :'iss3', 2, 'cancelled') as _ \gset
select pg_temp.ok((pg_temp.pub(:'iss3') ->> 'status') = 'ready', 'cancelling a never-released attempt returns the publication to ready');
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_begin', format('%L', :'iss3')) as _ \gset
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_dispatch', format('%L, 3', :'iss3')) as _ \gset
select pg_temp.rpt(:'ad3'::uuid, :'iss3', 3, 'failed') as _ \gset
select pg_temp.ok((pg_temp.pub(:'iss3') ->> 'status') = 'failed', 'a definitive connector refusal is failed-confirmed');
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_request(%L)', :'iss3'), '55000', 'a failed attempt is NOT reopened by a request (it may not be certain nothing was created)');
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_begin(%L)', :'iss3'), '55000', 'nor by a begin');
select pg_temp.rpt_fails(:'ad3'::uuid, :'iss3', 3, 'failed', '', '55000', 'a failed attempt cannot be failed again');
select (pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_get', format('%L', :'iss3')) ->> 'since')::timestamptz as since3b \gset
select pg_temp.rpt(:'ad3'::uuid, :'iss3', 3, 'none_found', pg_temp.evid(:'since3b'::timestamptz, 2, 40, true)) as _ \gset
select pg_temp.ok((pg_temp.pub(:'iss3') ->> 'status') = 'ready', 'only verified absence reopens a failed attempt');

-- ===== late results of OLDER attempts never touch a newer one (attempt fence)
select pg_temp.mkissue(:'ad'::uuid, :'u10'::uuid, 13, 'Nearby list repeats a restroom') as iss11 \gset
select pg_temp.approve_new(:'iss11', :'ad'::uuid, :'ad2'::uuid, 'The nearby list repeats the same restroom twice in a row') as _ \gset
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_request', format('%L', :'iss11')) as rq11 \gset
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_begin', format('%L', :'iss11')) as _ \gset
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_dispatch', format('%L, 1', :'iss11')) as _ \gset
select pg_temp.rpt(:'ad3'::uuid, :'iss11', 1, 'uncertain') as _ \gset
select (pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_get', format('%L', :'iss11')) ->> 'since')::timestamptz as since11 \gset
select pg_temp.rpt(:'ad3'::uuid, :'iss11', 1, 'none_found', pg_temp.evid(:'since11'::timestamptz, 4, 300, true)) as _ \gset
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_begin', format('%L', :'iss11')) as _ \gset
select count(*) as ev11 from feedback.publication_events where publication_id = (select id from feedback.publications where issue_id = :'iss11'::uuid) \gset
select pg_temp.rpt_fails(:'ad4'::uuid, :'iss11', 1, 'failed', '', '55000', 'a late FAILED result of attempt 1 is rejected');
select pg_temp.rpt_fails(:'ad4'::uuid, :'iss11', 1, 'uncertain', '', '55000', 'a late UNCERTAIN result of attempt 1 is rejected');
select pg_temp.rpt_fails(:'ad4'::uuid, :'iss11', 1, 'none_found', pg_temp.evid(:'since11'::timestamptz, 4, 300, true), '55000', 'a late NONE-FOUND result of attempt 1 is rejected (it cannot reopen ready while attempt 2 is unresolved)');
select pg_temp.rpt_fails(:'ad4'::uuid, :'iss11', 1, 'created', pg_temp.ver(:'rq11'::jsonb ->> 'marker', :'rq11'::jsonb ->> 'expected_hash', 31), '55000', 'a late SUCCESS result of attempt 1 is rejected');
select pg_temp.rpt_fails(:'ad4'::uuid, :'iss11', 1, 'found', pg_temp.ver(:'rq11'::jsonb ->> 'marker', :'rq11'::jsonb ->> 'expected_hash', 31), '55000', 'a late FOUND result of attempt 1 is rejected');
select pg_temp.fails_as('authenticated', :'ad4'::uuid, 'aal2', format('select public.admin_feedback_publication_dispatch(%L, 1)', :'iss11'), '55000', 'dispatching the OLD attempt is rejected');
select pg_temp.ok((pg_temp.pub(:'iss11') ->> 'status') = 'prepared' and (pg_temp.pub(:'iss11') ->> 'attempt') = '2' and (select count(*) from feedback.publication_events where publication_id = (select id from feedback.publications where issue_id = :'iss11'::uuid)) = :ev11, 'attempt 2 is untouched: still prepared, no extra event, no false ready/failed/published');
select pg_temp.pr(:'ad4'::uuid, 'admin_feedback_publication_dispatch', format('%L, 2', :'iss11')) as _ \gset
select pg_temp.ok((pg_temp.pub(:'iss11') ->> 'status') = 'dispatched', 'the current attempt can still be dispatched by its own number');

-- ===== staleness: an edit or a link after the request / after the preparation prevents the release
select pg_temp.mkissue(:'ad'::uuid, :'u1'::uuid, 4, 'Favorites list is empty after sign in') as iss4 \gset
select pg_temp.approve_new(:'iss4', :'ad'::uuid, :'ad2'::uuid, 'The favorites list is empty after signing in again') as _ \gset
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_request', format('%L', :'iss4')) as _ \gset
select pg_temp.pr(:'ad'::uuid, 'admin_feedback_draft_save', format('%L, ''Favorites list is empty'', ''bug'', ''The favorites list is empty after signing in once more''', :'iss4')) as _ \gset
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_begin(%L)', :'iss4'), '55000', 'an edit after the request (unapproved newer version) prevents the preparation');
select pg_temp.mkissue(:'ad'::uuid, :'u2'::uuid, 5, 'Report screen asks twice') as iss5 \gset
select pg_temp.approve_new(:'iss5', :'ad'::uuid, :'ad2'::uuid, 'The report screen asks for the reason twice in a row') as _ \gset
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_request', format('%L', :'iss5')) as _ \gset
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_begin', format('%L', :'iss5')) as _ \gset
select pg_temp.submit(:'u3'::uuid, pg_temp.key(50), 'Report screen asks twice here', 'Another user also sees the report screen asking twice.', 'bug', 'report') ->> 'id' as dup \gset
select pg_temp.pr(:'ad4'::uuid, 'admin_feedback_link_duplicate', format('%L, %L', :'dup', :'iss5')) as _ \gset
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_dispatch(%L, 1)', :'iss5'), '55000', 'a link after the PREPARATION revokes eligibility, so the executable packet is never released');
select pg_temp.ok((pg_temp.pub(:'iss5') ->> 'status') = 'prepared', 'the refused dispatch left the attempt prepared (nothing left)');
select pg_temp.rpt(:'ad3'::uuid, :'iss5', 1, 'cancelled') as _ \gset
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_begin(%L)', :'iss5'), '55000', 'and a new attempt needs a fresh independent approval');

-- ===== self-review: a publisher who submitted covered feedback is refused on every mutation
select pg_temp.submit(:'ad4'::uuid, pg_temp.key(60), 'Settings text is too small', 'The administrator also sees small settings text on the phone.', 'usability', 'settings') ->> 'id' as own \gset
select pg_temp.mkissue(:'ad'::uuid, :'u11'::uuid, 6, 'Settings text is small') as iss6 \gset
select pg_temp.pr(:'ad'::uuid, 'admin_feedback_link_duplicate', format('%L, %L', :'own', :'iss6')) as _ \gset
select pg_temp.approve_new(:'iss6', :'ad'::uuid, :'ad2'::uuid, 'The settings text is too small on the phone') as _ \gset
select pg_temp.fails_as('authenticated', :'ad4'::uuid, 'aal2', format('select public.admin_feedback_publication_request(%L)', :'iss6'), '42501', 'an administrator whose own feedback the issue covers cannot request its publication');
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_request', format('%L', :'iss6')) as _ \gset
select pg_temp.fails_as('authenticated', :'ad4'::uuid, 'aal2', format('select public.admin_feedback_publication_begin(%L)', :'iss6'), '42501', '... nor prepare it');
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_begin', format('%L', :'iss6')) as _ \gset
select pg_temp.fails_as('authenticated', :'ad4'::uuid, 'aal2', format('select public.admin_feedback_publication_dispatch(%L, 1)', :'iss6'), '42501', '... nor release it');
select pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_dispatch', format('%L, 1', :'iss6')) as _ \gset
select pg_temp.rpt_fails(:'ad4'::uuid, :'iss6', 1, 'uncertain', '', '42501', '... nor report on it');

-- ===== secret- and PII-bearing drafts never reach a publication (the draft fails closed first)
select pg_temp.mkissue(:'ad'::uuid, :'u1'::uuid, 7, 'Sensitive text in a draft') as iss7 \gset
create function pg_temp.bad_draft(label text, problem text) returns void language plpgsql as $$
begin
  perform pg_temp.fails_as('authenticated', pg_temp.f('ad')::uuid, 'aal2', format('select public.admin_feedback_draft_save(%L, ''Sensitive text in a draft'', ''bug'', %L)', (select id::text from feedback.issues where title = 'Sensitive text in a draft'), problem), '22023', label);
end $$;
-- synthetic token-shaped strings are assembled at run time, so no token-like literal sits in the source (the repository secret scan stays strict)
select pg_temp.bad_draft('a GitHub token', 'The pin jumps and ' || 'gh' || 'p_' || 'abcdefghijklmnopqrstuvwxyz0123456789' || ' was shown');
select pg_temp.bad_draft('a fine-grained token', 'The pin jumps and ' || 'github' || '_pat_' || '11ABCDEFG0abcdefghijklmnopqrstuv' || ' was shown');
select pg_temp.bad_draft('an API key', 'The pin jumps and ' || 's' || 'k-' || 'abcdefghijklmnopqrstuvwxyz012345' || ' was shown');
select pg_temp.bad_draft('an e-mail address', 'The pin jumps, write to person@example.org about it');
select pg_temp.bad_draft('coordinates', 'The pin jumps near 44.5263, -109.0565 when zooming');
select pg_temp.ok(not exists (select 1 from feedback.drafts d where d.issue_id = (select id from feedback.issues where title = 'Sensitive text in a draft')), 'none of those drafts was stored, so none can ever reach a publication');
-- KNOWN LIMIT, stated and tested honestly: the automatic check cannot recognize a personal name or a street address. Such text is accepted by the sanitizer;
-- the control is the independent human reading of the exact text before approval (F1), not this check. It is documented in APP_FEEDBACK.md and the admin UI.
select pg_temp.mkissue(:'ad'::uuid, :'u12'::uuid, 9, 'Address text is not detectable') as iss9 \gset
select pg_temp.ok((pg_temp.pr(:'ad'::uuid, 'admin_feedback_draft_save', format('%L, ''Address text is not detectable'', ''bug'', ''The pin jumps at 1234 Main Street when zooming''', :'iss9')) ->> 'version') = '1', 'KNOWN LIMIT: a street address or a name is NOT detected by the sanitizer (human review of the exact text is the control)');
select pg_temp.fails_as('authenticated', :'ad3'::uuid, 'aal2', format('select public.admin_feedback_publication_request(%L)', :'iss9'), '55000', 'and such an unreviewed draft still cannot be requested for publication (approval is required first)');

-- ===== account deletion: the mapping survives, raw data and linkage go, and no new publication can ride on the changed set
select pg_temp.mkissue(:'ad'::uuid, :'u1'::uuid, 8, 'Deletion closes the set') as iss8 \gset
select pg_temp.submit(:'u2'::uuid, pg_temp.key(70), 'Deletion closes the set again', 'A second user reports the set closing again here.', 'bug', 'map') ->> 'id' as dup8 \gset
select pg_temp.pr(:'ad4'::uuid, 'admin_feedback_link_duplicate', format('%L, %L', :'dup8', :'iss8')) as _ \gset
select pg_temp.approve_new(:'iss8', :'ad'::uuid, :'ad2'::uuid, 'The set closes unexpectedly after the first report') as _ \gset
select pg_temp.publish_as(:'iss8', :'ad3'::uuid, 9) as rq8 \gset
select pg_temp.ok((pg_temp.pub(:'iss8') ->> 'status') = 'published', 'setup: issue 8 is published as GitHub issue 9');
delete from auth.users where id = :'u2'::uuid;
select pg_temp.ok((pg_temp.pub(:'iss8') ->> 'status') = 'published' and (pg_temp.pub(:'iss8') ->> 'issue_number') = '9', 'deleting a submitter keeps the published mapping');
select pg_temp.ok(not exists (select 1 from feedback.items where id = :'dup8'::uuid) and not exists (select 1 from feedback.item_links where item_id = :'dup8'::uuid), 'the deleted account''s raw item and its link are gone');
select pg_temp.ok((pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_get', format('%L', :'iss8')) ->> 'eligible') = 'false' and (pg_temp.pr(:'ad3'::uuid, 'admin_feedback_publication_get', format('%L', :'iss8')) ->> 'block') = 'links_changed', 'the changed linked set makes any further transfer need a fresh independent approval (fail closed)');
select pg_temp.ok((select count(*) from feedback.items where user_id = :'u1'::uuid) >= 1, 'other accounts'' raw items are untouched by the deletion');
select pg_temp.finish();
