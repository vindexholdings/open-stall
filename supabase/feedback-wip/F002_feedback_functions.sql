-- OS-APP-FEEDBACK F1 (local core). SOURCE ONLY (see F001). F002: the ONLY client entry points. Every function is SECURITY DEFINER, owned by
-- feedback_owner, with a fixed empty search_path. The caller identity is auth.uid() only; no function takes a user id. Admin functions call the
-- existing public.require_admin() (admin_users row + aal2) INSIDE the function body, never relying on client metadata or a service role.

grant execute on function public.require_admin() to feedback_owner;   -- the owner may call the existing admin gate; it stays revoked from client roles

-- ---------------------------------------------------------------- helpers (private)
create function feedback.outcome(s text) returns text language sql immutable set search_path = '' as $$
  select case s when 'received' then 'We received this.' when 'reviewing' then 'A person is looking at this.' when 'planned' then 'This is planned.'
                when 'in_progress' then 'We are working on this.' when 'resolved' then 'This was addressed.' when 'closed' then 'This was reviewed and closed.'
                when 'duplicate' then 'This was already reported and is being tracked.' else '' end
$$;
create function feedback.nz(t text) returns text language sql immutable set search_path = '' as $$ select nullif(btrim(t), '') $$;
create function feedback.sha(t text) returns text language sql immutable set search_path = '' as $$ select encode(sha256(convert_to(t, 'UTF8')), 'hex') $$;
create function feedback.page_cursor(c text) returns timestamptz language plpgsql immutable set search_path = '' as $$
begin
  if c !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+[+-][0-9]{2}(:[0-9]{2})?[|][0-9a-f-]{36}$' then raise exception 'invalid cursor' using errcode = '22023'; end if;
  return split_part(c, '|', 1)::timestamptz;
end $$;

-- ---------------------------------------------------------------- submitter: submit, list own, read own
-- Exact retry (same key, same content) returns the original row; the same key with different content is refused. Limits are enforced HERE (a per-user
-- advisory lock serializes concurrent submissions, so a burst cannot exceed them) and are independent of the restroom-report limits.
-- fingerprint of the set of items linked to an issue (order-independent); NULL-safe for an empty set
create function feedback.link_set(p_issue uuid) returns text language sql stable set search_path = '' as $$
  select feedback.sha(coalesce((select string_agg(item_id::text, ',' order by item_id) from feedback.item_links where issue_id = p_issue), ''))
$$;

create function public.submit_feedback(
  p_key text, p_kind text, p_screen text, p_title text, p_description text,
  p_expected text default null, p_actual text default null, p_steps text default null, p_frequency text default null, p_impact text default null,
  p_app_version text default null, p_platform text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); t text := btrim(p_title); d text := btrim(p_description);
  ex text := feedback.nz(p_expected); ac text := feedback.nz(p_actual); st text := feedback.nz(p_steps);
  h text; cur feedback.items%rowtype; n_hour integer; n_day integer; n_all integer; r feedback.items%rowtype;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,64}$' then raise exception 'invalid idempotency key' using errcode = '22023'; end if;
  if p_kind is null or p_kind not in ('bug', 'usability', 'suggestion') then raise exception 'choose bug, usability or suggestion' using errcode = '22023'; end if;
  if p_screen is null or p_screen not in ('nearby', 'map', 'list', 'location_detail', 'favorites', 'account', 'settings', 'add_restroom', 'report', 'sign_in', 'other') then
    raise exception 'choose the affected screen from the list' using errcode = '22023'; end if;
  if t is null or char_length(t) not between 5 and 100 then raise exception 'the title must be 5 to 100 characters' using errcode = '22023'; end if;
  if d is null or char_length(d) not between 10 and 2000 then raise exception 'the description must be 10 to 2000 characters' using errcode = '22023'; end if;
  if (ex is not null and char_length(ex) > 500) or (ac is not null and char_length(ac) > 500) then raise exception 'expected and actual behavior may be at most 500 characters each' using errcode = '22023'; end if;
  if st is not null and char_length(st) > 1000 then raise exception 'steps may be at most 1000 characters' using errcode = '22023'; end if;
  if p_frequency is not null and p_frequency not in ('once', 'sometimes', 'often', 'always') then raise exception 'invalid frequency' using errcode = '22023'; end if;
  if p_impact is not null and p_impact not in ('minor', 'moderate', 'blocking') then raise exception 'invalid impact' using errcode = '22023'; end if;
  if p_platform is not null and p_platform not in ('ios', 'android', 'web') then raise exception 'invalid platform' using errcode = '22023'; end if;
  if p_app_version is not null and p_app_version !~ '^[0-9]{1,3}([.][0-9]{1,3}){0,3}$' then raise exception 'invalid app version' using errcode = '22023'; end if;
  -- MUTABLE:fb_text_rules begin
  if not (feedback.text_ok(t) and feedback.text_ok(d) and (ex is null or feedback.text_ok(ex)) and (ac is null or feedback.text_ok(ac)) and (st is null or feedback.text_ok(st))) then
    raise exception 'feedback text may not contain links, e-mail addresses, phone numbers, coordinates, markup or long tokens' using errcode = '22023';
  end if;
  -- MUTABLE:fb_text_rules end
  -- typed, ordered, NULL-preserving serialization: moving a value between optional fields changes the fingerprint
  h := feedback.sha(jsonb_build_object('kind', p_kind, 'screen', p_screen, 'title', t, 'description', d, 'expected', ex, 'actual', ac, 'steps', st,
         'frequency', p_frequency, 'impact', p_impact, 'app_version', p_app_version, 'platform', p_platform)::text);
  perform pg_advisory_xact_lock(hashtextextended('feedback:user:' || uid::text, 0));
  select * into cur from feedback.items where user_id = uid and idempotency_key = p_key;
  if cur.id is not null then
    if cur.content_hash <> h then raise exception 'this retry key was already used for different content' using errcode = '22023'; end if;
    return jsonb_build_object('id', cur.id, 'status', cur.status, 'created_at', cur.created_at, 'replayed', true);
  end if;
  -- MUTABLE:fb_rate_limits begin
  select count(*) filter (where created_at > clock_timestamp() - interval '1 hour'), count(*) filter (where created_at > clock_timestamp() - interval '1 day'), count(*)
    into n_hour, n_day, n_all from feedback.items where user_id = uid;
  if n_hour >= 5 or n_day >= 15 then raise exception 'too many feedback submissions; try again later' using errcode = '53400'; end if;
  if n_all >= 100 then raise exception 'feedback limit reached for this account' using errcode = '53400'; end if;
  -- MUTABLE:fb_rate_limits end
  insert into feedback.items (user_id, idempotency_key, content_hash, kind, screen, title, description, expected, actual, steps, frequency, impact, app_version, platform, tokens)
    values (uid, p_key, h, p_kind, p_screen, t, d, ex, ac, st, p_frequency, p_impact, p_app_version, p_platform, feedback.tokens(t)) returning * into r;
  insert into feedback.status_history (item_id, from_status, to_status, actor_kind) values (r.id, null, 'received', 'system');
  return jsonb_build_object('id', r.id, 'status', r.status, 'created_at', r.created_at, 'replayed', false);
end $$;

-- The caller's OWN items only (the owner is fixed by auth.uid()). Safe fields and an outcome sentence; never notes, reviewers, issues or other people's content.
create function public.list_my_feedback(p_cursor text default null, p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); ts timestamptz; cid uuid; res jsonb;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 20 then raise exception 'invalid page size' using errcode = '22023'; end if;
  if p_cursor is not null then ts := feedback.page_cursor(p_cursor); cid := split_part(p_cursor, '|', 2)::uuid; end if;
  with page as (select i.id, i.kind, i.screen, i.title, i.status, i.created_at, i.updated_at from feedback.items i
                  where i.user_id = uid and (p_cursor is null or (i.created_at, i.id) < (ts, cid)) order by i.created_at desc, i.id desc limit p_limit + 1),
       shown as (select * from page order by created_at desc, id desc limit p_limit)
  select jsonb_build_object(
           'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'screen', screen, 'title', title, 'status', status, 'outcome', feedback.outcome(status),
                                                                 'created_at', created_at, 'updated_at', updated_at) order by created_at desc, id desc) from shown), '[]'::jsonb),
           'next_cursor', case when (select count(*) from page) > p_limit
                               then (select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00"') || '|' || id::text from shown order by created_at, id limit 1) end)
    into res;
  return res;
end $$;

create function public.get_my_feedback(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r feedback.items%rowtype;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into r from feedback.items where id = p_id and user_id = uid;
  if r.id is null then raise exception 'not found' using errcode = 'P0002'; end if;   -- identical for "missing" and "someone else's"
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'screen', r.screen, 'title', r.title, 'description', r.description, 'expected', r.expected, 'actual', r.actual,
    'steps', r.steps, 'frequency', r.frequency, 'impact', r.impact, 'app_version', r.app_version, 'platform', r.platform,
    'status', r.status, 'outcome', feedback.outcome(r.status), 'created_at', r.created_at, 'updated_at', r.updated_at,
    'timeline', (select coalesce(jsonb_agg(jsonb_build_object('status', h.to_status, 'at', h.created_at) order by h.id), '[]'::jsonb) from feedback.status_history h where h.item_id = r.id));
end $$;

-- ---------------------------------------------------------------- admin queue (every function opens with the existing gate; the submitter is never returned)
create function public.admin_feedback_list(p_status text default null, p_cursor text default null, p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); ts timestamptz; cid uuid; res jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then raise exception 'invalid page size' using errcode = '22023'; end if;
  if p_status is not null and p_status not in ('received', 'reviewing', 'planned', 'in_progress', 'resolved', 'closed', 'duplicate') then raise exception 'invalid status' using errcode = '22023'; end if;
  if p_cursor is not null then ts := feedback.page_cursor(p_cursor); cid := split_part(p_cursor, '|', 2)::uuid; end if;
  with page as (select i.id, i.kind, i.screen, i.title, i.status, i.created_at, exists (select 1 from feedback.item_links l where l.item_id = i.id) as linked, i.user_id = a as own
                  from feedback.items i where (p_status is null or i.status = p_status) and (p_cursor is null or (i.created_at, i.id) > (ts, cid))
                  order by i.created_at, i.id limit p_limit + 1),
       shown as (select * from page order by created_at, id limit p_limit)
  select jsonb_build_object(
           'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'screen', screen, 'title', title, 'status', status, 'created_at', created_at, 'linked', linked, 'own', own)
                                               order by created_at, id) from shown), '[]'::jsonb),
           'next_cursor', case when (select count(*) from page) > p_limit
                               then (select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00"') || '|' || id::text from shown order by created_at desc, id desc limit 1) end)
    into res;
  return res;
end $$;

create function public.admin_feedback_get(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); r feedback.items%rowtype; l feedback.item_links%rowtype;
begin
  select * into r from feedback.items where id = p_id;
  if r.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  select * into l from feedback.item_links where item_id = r.id;
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'screen', r.screen, 'title', r.title, 'description', r.description, 'expected', r.expected, 'actual', r.actual,
    'steps', r.steps, 'frequency', r.frequency, 'impact', r.impact, 'app_version', r.app_version, 'platform', r.platform, 'status', r.status,
    'created_at', r.created_at, 'updated_at', r.updated_at, 'own', r.user_id = a, 'issue_id', l.issue_id, 'link_role', l.role,
    'history', (select coalesce(jsonb_agg(jsonb_build_object('from', h.from_status, 'to', h.to_status, 'by', h.actor_kind, 'note', h.note, 'at', h.created_at) order by h.id), '[]'::jsonb)
                  from feedback.status_history h where h.item_id = r.id));
end $$;

-- Duplicate CANDIDATES are hints for a person: the same screen and at least two shared normalized title tokens. Never an automatic merge.
create function public.admin_feedback_candidates(p_id uuid, p_limit integer default 5) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); r feedback.items%rowtype; found jsonb; n integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 10 then raise exception 'invalid page size' using errcode = '22023'; end if;
  select * into r from feedback.items where id = p_id;
  if r.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  -- The work is bounded BEFORE scoring: only the 200 most recent items of the same screen (one index range scan on (screen, created_at desc, id desc)) are
  -- compared. The search is therefore explicitly incomplete for busy screens; `searched` and `complete` say so.
  with pool as (
    select i.* from feedback.items i where i.screen = r.screen and i.id <> r.id
     order by i.screen, i.created_at desc, i.id desc   -- the equality column in ORDER BY lets only the (screen, created_at, id) index supply the order
     -- MUTABLE:fb_pool_limit begin
     limit 200
     -- MUTABLE:fb_pool_limit end
  ), scored as (
    select * from pool where cardinality(array(select unnest(pool.tokens) intersect select unnest(r.tokens))) >= 2
  )
  select (select count(*) from pool),
         (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'title', c.title, 'status', c.status, 'issue_id', l.issue_id) order by c.created_at, c.id), '[]'::jsonb)
            from (select * from scored order by created_at, id limit p_limit) c left join feedback.item_links l on l.item_id = c.id)
    into n, found;
  return jsonb_build_object('candidates', found, 'searched', n, 'complete', n < 200);
end $$;


create function public.admin_feedback_set_status(p_id uuid, p_to text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); r feedback.items%rowtype; nt text := feedback.nz(p_note);
begin
  select * into r from feedback.items where id = p_id for update;   -- the row lock serializes concurrent decisions on one item
  if r.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  -- MUTABLE:fb_self_review begin
  if r.user_id = a then raise exception 'administrators cannot decide on their own feedback' using errcode = '42501'; end if;
  -- MUTABLE:fb_self_review end
  if p_to = 'duplicate' then raise exception 'use the duplicate link to mark an item as a duplicate' using errcode = '22023'; end if;
  -- MUTABLE:fb_transitions begin
  if not feedback.transition_ok(r.status, p_to) then raise exception 'invalid status transition % -> %', r.status, coalesce(p_to, 'null') using errcode = '22023'; end if;
  -- MUTABLE:fb_transitions end
  if nt is not null and not feedback.text_ok(nt) then raise exception 'the note contains disallowed content' using errcode = '22023'; end if;
  update feedback.items set status = p_to, updated_at = clock_timestamp() where id = r.id;
  insert into feedback.status_history (item_id, from_status, to_status, actor_kind, actor_id, note) values (r.id, r.status, p_to, 'admin', a, nt);
  return jsonb_build_object('id', r.id, 'status', p_to);
end $$;

-- A canonical issue is created by a reviewer from ONE item; the title and summary are the reviewer's own SANITIZED words (allowlisted text, fail closed).
create function public.admin_feedback_create_issue(p_item uuid, p_title text, p_summary text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); r feedback.items%rowtype; iid uuid;
begin
  select * into r from feedback.items where id = p_item for update;
  if r.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if r.user_id = a then raise exception 'administrators cannot decide on their own feedback' using errcode = '42501'; end if;
  if exists (select 1 from feedback.item_links where item_id = r.id) then raise exception 'this item is already linked to an issue' using errcode = '23505'; end if;
  if not (coalesce(feedback.safe_public_text(btrim(p_title)), false) and coalesce(feedback.safe_public_text(btrim(p_summary)), false)) then
    raise exception 'the issue title and summary could not be verified as safe public text' using errcode = '22023'; end if;
  if char_length(btrim(p_title)) not between 5 and 120 or char_length(btrim(p_summary)) not between 10 and 1000 then raise exception 'invalid length' using errcode = '22023'; end if;
  insert into feedback.issues (title, summary, created_by) values (btrim(p_title), btrim(p_summary), a) returning id into iid;
  insert into feedback.item_links (item_id, issue_id, role, linked_by) values (r.id, iid, 'origin', a);
  return jsonb_build_object('issue_id', iid);
end $$;

-- Linking marks the item a duplicate of an existing issue. The ORIGINAL item is never edited or merged; one canonical link per item (a primary key) keeps
-- concurrent linking consistent: exactly one of two competing links wins.
create function public.admin_feedback_link_duplicate(p_item uuid, p_issue uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); r feedback.items%rowtype; nt text := feedback.nz(p_note);
begin
  -- one lock order everywhere: the ISSUE lock first (it serializes membership, versions, approval and export), then row locks
  perform pg_advisory_xact_lock(hashtextextended('feedback:issue:' || p_issue::text, 0));
  select * into r from feedback.items where id = p_item for update;
  if r.id is null or not exists (select 1 from feedback.issues where id = p_issue) then raise exception 'not found' using errcode = 'P0002'; end if;
  if r.user_id = a then raise exception 'administrators cannot decide on their own feedback' using errcode = '42501'; end if;
  if nt is not null and not feedback.text_ok(nt) then raise exception 'the note contains disallowed content' using errcode = '22023'; end if;
  begin
    insert into feedback.item_links (item_id, issue_id, role, linked_by) values (r.id, p_issue, 'duplicate', a);
  exception when unique_violation then raise exception 'this item is already linked to an issue' using errcode = '23505';
  end;
  update feedback.items set status = 'duplicate', updated_at = clock_timestamp() where id = r.id;
  insert into feedback.status_history (item_id, from_status, to_status, actor_kind, actor_id, note) values (r.id, r.status, 'duplicate', 'admin', a, nt);
  return jsonb_build_object('item_id', r.id, 'issue_id', p_issue, 'status', 'duplicate');
end $$;

create function public.admin_feedback_issue_get(p_issue uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); i feedback.issues%rowtype; d feedback.drafts%rowtype;
begin
  select * into i from feedback.issues where id = p_issue;
  if i.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  select * into d from feedback.drafts where issue_id = i.id order by version desc limit 1;
  return jsonb_build_object('id', i.id, 'title', i.title, 'summary', i.summary, 'created_at', i.created_at,
    'items', (select count(*) from feedback.item_links where issue_id = i.id),
    'latest_draft', case when d.id is null then null else jsonb_build_object('version', d.version, 'hash', d.body_hash, 'approved', d.approved_hash is not distinct from d.body_hash, 'author_is_me', d.created_by = a,
      'title', d.title, 'body', d.body) end);
end $$;

-- ---------------------------------------------------------------- sanitized publication snapshot (a fixed allowlisted template; immutable versions)
create function public.admin_feedback_draft_save(p_issue uuid, p_title text, p_category text, p_problem text, p_repro text default null, p_expected_actual text default null,
                                                 p_platform text default null, p_app_version text default null, p_hint text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); v integer; body text; h text; ti text := btrim(p_title); pr text := btrim(p_problem);
  rp text := feedback.nz(p_repro); ea text := feedback.nz(p_expected_actual); hi text := feedback.nz(p_hint);
begin
  if not exists (select 1 from feedback.issues where id = p_issue) then raise exception 'not found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('feedback:issue:' || p_issue::text, 0));
  -- MUTABLE:fb_draft_sanitize begin
  if not (coalesce(feedback.safe_public_text(ti), false) and coalesce(feedback.safe_public_text(pr), false) and (rp is null or feedback.safe_public_text(rp))
          and (ea is null or feedback.safe_public_text(ea)) and (hi is null or feedback.safe_public_text(hi))) then
    raise exception 'the draft could not be verified as safe public text; remove anything personal, any link, number run or unusual character' using errcode = '22023';
  end if;
  -- MUTABLE:fb_draft_sanitize end
  select coalesce(max(version), 0) + 1 into v from feedback.drafts where issue_id = p_issue;
  body := 'Category: ' || p_category || E'\nProblem: ' || pr || E'\nSteps to reproduce: ' || coalesce(rp, 'Not provided') || E'\nExpected and actual: ' || coalesce(ea, 'Not provided')
          || E'\nBuild: ' || coalesce(p_platform, 'unknown') || ' ' || coalesce(p_app_version, 'unknown') || E'\nAcceptance hint: ' || coalesce(hi, 'None');
  h := feedback.sha(ti || E'\x1e' || body);
  insert into feedback.drafts (issue_id, version, title, category, problem, repro, expected_actual, platform, app_version, acceptance_hint, body, body_hash, created_by)
    values (p_issue, v, ti, p_category, pr, rp, ea, p_platform, p_app_version, hi, body, h, a);
  return jsonb_build_object('issue_id', p_issue, 'version', v, 'hash', h, 'title', ti, 'body', body);
end $$;

-- Approval is bound to ONE version and its hash. The approver must be a different administrator from the draft's author and from the submitter of
-- any feedback linked to the issue (no self-review); any later edit is a new, unapproved version.
create function public.admin_feedback_draft_approve(p_issue uuid, p_version integer, p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); d feedback.drafts%rowtype; latest integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('feedback:issue:' || p_issue::text, 0));
  select * into d from feedback.drafts where issue_id = p_issue and version = p_version for update;
  if d.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  select max(version) into latest from feedback.drafts where issue_id = p_issue;
  if d.version <> latest then raise exception 'only the latest draft version can be approved' using errcode = '55000'; end if;
  if d.approved_by is not null then raise exception 'this version is already approved' using errcode = '55000'; end if;
  -- MUTABLE:fb_hash_bound begin
  if p_hash is distinct from d.body_hash then raise exception 'the approval does not match this version (it was edited or the hash is wrong)' using errcode = '22023'; end if;
  -- MUTABLE:fb_hash_bound end
  -- MUTABLE:fb_independent_review begin
  if d.created_by = a then raise exception 'a different administrator must approve this draft' using errcode = '42501'; end if;
  if exists (select 1 from feedback.item_links l join feedback.items i on i.id = l.item_id where l.issue_id = p_issue and i.user_id = a) then
    raise exception 'administrators cannot approve a publication built from their own feedback' using errcode = '42501'; end if;
  -- MUTABLE:fb_independent_review end
  update feedback.drafts set approved_by = a, approved_at = clock_timestamp(), approved_hash = d.body_hash, approved_links = feedback.link_set(p_issue) where id = d.id;
  return jsonb_build_object('issue_id', p_issue, 'version', d.version, 'approved', true);
end $$;

-- The only export in F1: a PREVIEW of the latest version, and only when that exact version is approved. Nothing is sent anywhere; no credential exists here.
create function public.admin_feedback_export_preview(p_issue uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); d feedback.drafts%rowtype; i feedback.issues%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('feedback:issue:' || p_issue::text, 0));
  select * into i from feedback.issues where id = p_issue;
  select * into d from feedback.drafts where issue_id = p_issue order by version desc limit 1;
  if i.id is null or d.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  -- MUTABLE:fb_export_gate begin
  if d.approved_hash is distinct from d.body_hash then raise exception 'the latest draft version is not approved' using errcode = '55000'; end if;
  -- MUTABLE:fb_export_gate end
  -- Eligibility is re-proved here, not remembered: the approval must still cover the CURRENT linked set, and the independence rules must still hold.
  -- MUTABLE:fb_export_revalidate begin
  if d.approved_links is distinct from feedback.link_set(p_issue) then raise exception 'feedback was linked after approval; a new independent approval is required' using errcode = '55000'; end if;
  if d.approved_by = d.created_by or exists (select 1 from feedback.item_links l join feedback.items it on it.id = l.item_id where l.issue_id = p_issue and it.user_id = d.approved_by) then
    raise exception 'the approval is no longer independent; a new independent approval is required' using errcode = '55000'; end if;
  -- MUTABLE:fb_export_revalidate end
  return jsonb_build_object('issue_id', i.id, 'version', d.version, 'title', d.title, 'body', d.body, 'hash', d.body_hash, 'publication_key', i.publication_key);
end $$;

-- ---------------------------------------------------------------- ownership and privileges
alter function feedback.outcome(text) owner to feedback_owner;
alter function feedback.nz(text) owner to feedback_owner;
alter function feedback.sha(text) owner to feedback_owner;
alter function feedback.page_cursor(text) owner to feedback_owner;
alter function feedback.link_set(uuid) owner to feedback_owner;
alter function public.submit_feedback(text, text, text, text, text, text, text, text, text, text, text, text) owner to feedback_owner;
alter function public.list_my_feedback(text, integer) owner to feedback_owner;
alter function public.get_my_feedback(uuid) owner to feedback_owner;
alter function public.admin_feedback_list(text, text, integer) owner to feedback_owner;
alter function public.admin_feedback_get(uuid) owner to feedback_owner;
alter function public.admin_feedback_candidates(uuid, integer) owner to feedback_owner;
alter function public.admin_feedback_set_status(uuid, text, text) owner to feedback_owner;
alter function public.admin_feedback_create_issue(uuid, text, text) owner to feedback_owner;
alter function public.admin_feedback_link_duplicate(uuid, uuid, text) owner to feedback_owner;
alter function public.admin_feedback_issue_get(uuid) owner to feedback_owner;
alter function public.admin_feedback_draft_save(uuid, text, text, text, text, text, text, text, text) owner to feedback_owner;
alter function public.admin_feedback_draft_approve(uuid, integer, text) owner to feedback_owner;
alter function public.admin_feedback_export_preview(uuid) owner to feedback_owner;
revoke all on function feedback.outcome(text), feedback.nz(text), feedback.sha(text), feedback.page_cursor(text), feedback.link_set(uuid) from public, anon, authenticated, service_role;
grant execute on function feedback.outcome(text), feedback.nz(text), feedback.sha(text), feedback.page_cursor(text), feedback.link_set(uuid) to feedback_owner;
revoke all on function
  public.submit_feedback(text, text, text, text, text, text, text, text, text, text, text, text), public.list_my_feedback(text, integer), public.get_my_feedback(uuid),
  public.admin_feedback_list(text, text, integer), public.admin_feedback_get(uuid), public.admin_feedback_candidates(uuid, integer),
  public.admin_feedback_set_status(uuid, text, text), public.admin_feedback_create_issue(uuid, text, text), public.admin_feedback_link_duplicate(uuid, uuid, text),
  public.admin_feedback_issue_get(uuid), public.admin_feedback_draft_save(uuid, text, text, text, text, text, text, text, text),
  public.admin_feedback_draft_approve(uuid, integer, text), public.admin_feedback_export_preview(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.submit_feedback(text, text, text, text, text, text, text, text, text, text, text, text), public.list_my_feedback(text, integer), public.get_my_feedback(uuid),
  public.admin_feedback_list(text, text, integer), public.admin_feedback_get(uuid), public.admin_feedback_candidates(uuid, integer),
  public.admin_feedback_set_status(uuid, text, text), public.admin_feedback_create_issue(uuid, text, text), public.admin_feedback_link_duplicate(uuid, uuid, text),
  public.admin_feedback_issue_get(uuid), public.admin_feedback_draft_save(uuid, text, text, text, text, text, text, text, text),
  public.admin_feedback_draft_approve(uuid, integer, text), public.admin_feedback_export_preview(uuid)
  to authenticated;   -- the admin functions open with public.require_admin(); EXECUTE for authenticated is only the transport
