-- OS-APP-FEEDBACK F2: the PRIVATE state of the reviewer-approved, sanitized publication bridge. WIP SQL for a disposable PostgreSQL 16 only (never supabase/migrations).
-- The app holds NO GitHub credential and creates NO issue: a human (through the existing authorized connector) transfers the exact approved snapshot, then the
-- result is recorded here with verification. A timeout is never proof of "nothing was created": the state becomes `uncertain` and must be reconciled by the
-- non-identifying marker BEFORE any retry. This is not a cross-system atomic transaction and not an exactly-once guarantee.
-- RETRY SAFETY IS SERVER STATE, never caller flags: every begin issues an ATTEMPT generation; the executable packet is released exactly ONCE by `dispatch`
-- (after which the outcome is unknown to this system); every report is fenced to the attempt it belongs to (a late result of an older attempt is rejected without
-- changing anything); and the ONLY way back to `ready` after a dispatched attempt is a reconciliation that proves an EXHAUSTIVE absence (a complete listing since
-- before the transfer), never an empty or partial search.

-- ---------------------------------------------------------------- pure helpers (private schema)
create function feedback.pub_marker(p_key uuid) returns text language sql immutable set search_path = '' as $$
  -- opaque, non-reversible, derived from the private random publication key; routing/deduplication data only (never an instruction)
  select 'OSFB-' || substr(encode(sha256(convert_to('osfb-v1:' || p_key::text, 'UTF8')), 'hex'), 1, 20)
$$;
create function feedback.pub_body(p_body text, p_marker text) returns text language sql immutable set search_path = '' as $$
  select p_body || E'\n\nFeedback reference: ' || p_marker
$$;
create function feedback.pub_expected_hash(p_title text, p_body text, p_marker text) returns text language sql immutable set search_path = '' as $$
  select feedback.sha(p_title || E'\x1e' || feedback.pub_body(p_body, p_marker))
$$;
create function feedback.pub_transition_ok(f text, t text) returns boolean language sql immutable set search_path = '' as $$
  select (f, t) in (
    ('ready', 'prepared'),
    ('prepared', 'dispatched'), ('prepared', 'ready'),                                                      -- ready again only by CANCELLING an attempt that was never released
    ('dispatched', 'published'), ('dispatched', 'uncertain'), ('dispatched', 'failed'), ('dispatched', 'conflict'),
    ('uncertain', 'published'), ('uncertain', 'ready'), ('uncertain', 'conflict'),                          -- uncertain -> ready only with verified exhaustive absence
    ('failed', 'published'), ('failed', 'ready'), ('failed', 'conflict'),                                   -- failed -> ready only with verified exhaustive absence
    ('conflict', 'published'),
    ('published', 'ready'))                                                                                 -- a newer approved snapshot (an UPDATE of the same issue)
$$;

-- ---------------------------------------------------------------- tables
create table feedback.publications (   -- ONE row per canonical issue; the GitHub mapping, once set, is immutable and unique
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null unique references feedback.issues (id) on delete restrict,
  marker text not null unique check (marker ~ '^OSFB-[0-9a-f]{20}$'),
  status text not null check (status in ('ready', 'prepared', 'dispatched', 'uncertain', 'published', 'failed', 'conflict')),
  operation text not null check (operation in ('create', 'update')),
  draft_version integer not null check (draft_version >= 1),
  expected_hash text not null check (expected_hash ~ '^[0-9a-f]{64}$'),   -- hash of the exact title + body-with-marker that must be read back
  links_fp text not null,                                                -- the reviewed eligibility revision (linked-item set) at request time
  issue_number integer check (issue_number >= 1),
  issue_url text,
  published_hash text check (published_hash is null or published_hash ~ '^[0-9a-f]{64}$'),
  attempt integer not null default 0 check (attempt >= 0),                 -- server-issued generation: every report and dispatch is fenced to it
  dispatched_at timestamptz,                                                -- set when the executable packet is released (the outcome is unknown from then on)
  requested_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((issue_number is null) = (issue_url is null)),
  check (issue_url is null or issue_url = 'https://github.com/vindexholdings/open-stall/issues/' || issue_number),
  check (status <> 'published' or published_hash is not null),
  check ((status in ('ready', 'prepared')) = (dispatched_at is null))
);
create unique index feedback_publication_number_idx on feedback.publications (issue_number) where issue_number is not null;   -- never two canonical issues on one GitHub issue

create table feedback.publication_events (   -- append-only; the detail is a code from a fixed list, never free text
  id bigint generated always as identity primary key,
  publication_id uuid not null references feedback.publications (id) on delete restrict,
  from_status text,
  to_status text not null check (to_status in ('ready', 'prepared', 'dispatched', 'uncertain', 'published', 'failed', 'conflict')),
  detail text not null check (detail in ('requested', 'refreshed', 'prepared', 'dispatched', 'cancelled', 'published', 'uncertain', 'absence_verified', 'multiple_matches', 'verification_failed', 'failed_confirmed')),
  actor_id uuid not null,
  draft_version integer not null,
  attempt integer not null default 0,
  pages_checked integer check (pages_checked is null or pages_checked between 1 and 50),
  issues_scanned integer check (issues_scanned is null or issues_scanned between 0 and 100000),
  created_at timestamptz not null default clock_timestamp()
);
create index feedback_publication_events_idx on feedback.publication_events (publication_id, id);

-- ---------------------------------------------------------------- guards
create function feedback.guard_publications() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'UPDATE' then raise exception 'feedback.publications cannot be % directly', lower(tg_op) using errcode = '42501'; end if;
  if new.id is distinct from old.id or new.issue_id is distinct from old.issue_id or new.marker is distinct from old.marker
     or new.requested_by is distinct from old.requested_by or new.created_at is distinct from old.created_at then
    raise exception 'a publication keeps its issue, marker and requester' using errcode = '42501';
  end if;
  -- the GitHub mapping, once recorded, is immutable (a different issue is a conflict for a person, never an overwrite)
  if old.issue_number is not null and (new.issue_number is distinct from old.issue_number or new.issue_url is distinct from old.issue_url) then
    raise exception 'the recorded GitHub mapping is immutable' using errcode = '42501';
  end if;
  -- the attempt generation only ever advances by one, and only when a ready publication is prepared
  if new.attempt is distinct from old.attempt and not (old.status = 'ready' and new.status = 'prepared' and new.attempt = old.attempt + 1) then
    raise exception 'the attempt generation is server-owned' using errcode = '42501';
  end if;
  if old.status = 'ready' and new.status = 'prepared' and new.attempt <> old.attempt + 1 then raise exception 'preparing advances the attempt generation' using errcode = '42501'; end if;
  if new.status is distinct from old.status and not feedback.pub_transition_ok(old.status, new.status) then
    raise exception 'invalid publication transition % -> %', old.status, new.status using errcode = '22023';
  end if;
  return new;
end $$;
create trigger publications_guard before update or delete on feedback.publications for each row execute function feedback.guard_publications();
create trigger publications_no_truncate before truncate on feedback.publications for each statement execute function feedback.guard_truncate();
create trigger publication_events_guard before update or delete on feedback.publication_events for each row execute function feedback.guard_append_only();
create trigger publication_events_no_truncate before truncate on feedback.publication_events for each statement execute function feedback.guard_truncate();

-- ---------------------------------------------------------------- RPCs (every one opens with the existing admin gate; the actor is the gate's answer)
-- The publisher may not be the submitter of any feedback the issue covers (no self-review), checked on every mutation.
create function feedback.pub_guard_actor(p_issue uuid, a uuid) returns void language plpgsql stable set search_path = '' as $$
begin
  if exists (select 1 from feedback.item_links l join feedback.items i on i.id = l.item_id where l.issue_id = p_issue and i.user_id = a) then
    raise exception 'administrators cannot publish a snapshot built from their own feedback' using errcode = '42501';
  end if;
end $$;

-- The packet, built field by field from the IMMUTABLE draft version this publication is tied to (never a serialization of the private issue). `phase` says what it may
-- be used for: 'preview' (an attempt was prepared; nothing has been released), 'transfer' (returned ONCE by `dispatch`: the only executable form), 'readback'
-- (the exact approved text for comparing a read-back or reconciling; never an instruction to create).
create function feedback.pub_packet(p_issue uuid, p_phase text) returns jsonb language plpgsql stable set search_path = '' as $$
declare p feedback.publications%rowtype; d feedback.drafts%rowtype;
begin
  select * into p from feedback.publications where issue_id = p_issue;
  select * into d from feedback.drafts where issue_id = p_issue and version = p.draft_version;
  return jsonb_build_object('repo', 'vindexholdings/open-stall', 'operation', p.operation, 'issue_number', p.issue_number, 'marker', p.marker,
    'version', p.draft_version, 'attempt', p.attempt, 'phase', p_phase, 'title', d.title, 'body', feedback.pub_body(d.body, p.marker), 'expected_hash', p.expected_hash);
end $$;

-- the safe view of one publication: no raw item, user, admin or link identifier ever appears
create function feedback.pub_json(p_issue uuid) returns jsonb language plpgsql stable set search_path = '' as $$
declare p feedback.publications%rowtype; d feedback.drafts%rowtype; blk text;
begin
  select * into d from feedback.drafts where issue_id = p_issue order by version desc limit 1;
  blk := case when d.id is null then 'unapproved' else feedback.export_block(p_issue, d.id) end;
  select * into p from feedback.publications where issue_id = p_issue;
  if p.id is null then
    return jsonb_build_object('status', 'none', 'eligible', blk is null, 'block', blk, 'repo', 'vindexholdings/open-stall');
  end if;
  return jsonb_build_object('status', p.status, 'operation', p.operation, 'version', p.draft_version, 'attempt', p.attempt, 'marker', p.marker, 'expected_hash', p.expected_hash,
    'issue_number', p.issue_number, 'issue_url', p.issue_url, 'published_hash', p.published_hash,
    -- the listing window a reconciliation must cover: it starts BEFORE the release of the packet (10 minutes of clock skew)
    'dispatched_at', p.dispatched_at, 'since', p.dispatched_at - interval '10 minutes',
    'current', d.id is not null and d.version = p.draft_version,
    'eligible', blk is null, 'block', blk, 'repo', 'vindexholdings/open-stall',
    'packet', case when p.status = 'prepared' then feedback.pub_packet(p_issue, 'preview')
                   when p.status in ('dispatched', 'uncertain', 'failed', 'conflict') then feedback.pub_packet(p_issue, 'readback') else null end);
end $$;

create function public.admin_feedback_publication_get(p_issue uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin();
begin
  if not exists (select 1 from feedback.issues where id = p_issue) then raise exception 'not found' using errcode = 'P0002'; end if;
  return feedback.pub_json(p_issue);
end $$;

-- (1) REQUEST: only for a currently eligible approved snapshot. Creates the private publication row, refreshes a READY one, or returns the verified mapping for an
-- exact replay. A published issue with a NEWER approved snapshot becomes an UPDATE of the SAME GitHub issue, never a second create. A prepared, dispatched,
-- uncertain, failed or conflicting publication is never reset by a request: it is resolved by its own attempt (cancel, or verified evidence).
create function public.admin_feedback_publication_request(p_issue uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); i feedback.issues%rowtype; d feedback.drafts%rowtype; p feedback.publications%rowtype; blk text; mk text; eh text; fp text;
begin
  perform pg_advisory_xact_lock(hashtextextended('feedback:issue:' || p_issue::text, 0));
  select * into i from feedback.issues where id = p_issue;
  if i.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  select * into d from feedback.drafts where issue_id = p_issue order by version desc limit 1;
  if d.id is null then raise exception 'the latest draft version is not approved' using errcode = '55000'; end if;
  -- MUTABLE:fb_pub_eligibility begin
  blk := feedback.export_block(p_issue, d.id);
  if blk = 'unapproved' then raise exception 'the latest draft version is not approved' using errcode = '55000'; end if;
  if blk = 'links_changed' then raise exception 'feedback was linked after approval; a new independent approval is required' using errcode = '55000'; end if;
  if blk = 'not_independent' then raise exception 'the approval is no longer independent; a new independent approval is required' using errcode = '55000'; end if;
  -- MUTABLE:fb_pub_eligibility end
  -- MUTABLE:fb_pub_actor begin
  perform feedback.pub_guard_actor(p_issue, a);
  -- MUTABLE:fb_pub_actor end
  mk := feedback.pub_marker(i.publication_key);
  eh := feedback.pub_expected_hash(d.title, d.body, mk);
  fp := feedback.link_set(p_issue);
  select * into p from feedback.publications where issue_id = p_issue for update;
  if p.id is null then
    insert into feedback.publications (issue_id, marker, status, operation, draft_version, expected_hash, links_fp, requested_by)
      values (p_issue, mk, 'ready', 'create', d.version, eh, fp, a) returning * into p;
    insert into feedback.publication_events (publication_id, from_status, to_status, detail, actor_id, draft_version, attempt) values (p.id, null, 'ready', 'requested', a, d.version, p.attempt);
  elsif p.status in ('prepared', 'dispatched', 'uncertain', 'failed', 'conflict') then
    raise exception 'a transfer is already in progress or unresolved; reconcile it first' using errcode = '55000';
  elsif p.status = 'published' and p.published_hash = eh then
    return feedback.pub_json(p_issue) || jsonb_build_object('replayed', true);    -- exact replay: the verified mapping, nothing new
  else
    update feedback.publications set status = 'ready', operation = case when p.issue_number is null then 'create' else 'update' end,
      draft_version = d.version, expected_hash = eh, links_fp = fp, dispatched_at = null, updated_at = clock_timestamp() where id = p.id;
    insert into feedback.publication_events (publication_id, from_status, to_status, detail, actor_id, draft_version, attempt) values (p.id, p.status, 'ready', 'refreshed', a, d.version, p.attempt);
  end if;
  return feedback.pub_json(p_issue) || jsonb_build_object('replayed', false);
end $$;

-- the single place that proves, immediately before anything may leave, that the approval and the exact snapshot are still current
create function feedback.pub_assert_current(p_issue uuid, p feedback.publications) returns void language plpgsql stable set search_path = '' as $$
declare d feedback.drafts%rowtype;
begin
  select * into d from feedback.drafts where issue_id = p_issue order by version desc limit 1;
  if d.id is null or feedback.export_block(p_issue, d.id) is not null or d.version <> p.draft_version
     or feedback.pub_expected_hash(d.title, d.body, p.marker) <> p.expected_hash or feedback.link_set(p_issue) <> p.links_fp then
    raise exception 'the approved snapshot or its eligibility changed; request the publication again' using errcode = '55000';
  end if;
end $$;

-- (2) BEGIN: prepares ONE new attempt (a fresh generation) of a ready publication. Nothing is released: the result is a PREVIEW of the exact approved text. Exactly one
-- concurrent caller can begin.
create function public.admin_feedback_publication_begin(p_issue uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); p feedback.publications%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('feedback:issue:' || p_issue::text, 0));
  select * into p from feedback.publications where issue_id = p_issue for update;
  if p.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if p.status <> 'ready' then raise exception 'this publication is not ready to transfer (%)', p.status using errcode = '55000'; end if;
  -- MUTABLE:fb_pub_stale begin
  perform feedback.pub_assert_current(p_issue, p);
  -- MUTABLE:fb_pub_stale end
  perform feedback.pub_guard_actor(p_issue, a);
  update feedback.publications set status = 'prepared', attempt = p.attempt + 1, updated_at = clock_timestamp() where id = p.id;
  insert into feedback.publication_events (publication_id, from_status, to_status, detail, actor_id, draft_version, attempt) values (p.id, 'ready', 'prepared', 'prepared', a, p.draft_version, p.attempt + 1);
  return feedback.pub_packet(p_issue, 'preview');
end $$;

-- (3) DISPATCH: releases the EXECUTABLE packet exactly once, for exactly the named attempt. From that moment the outcome is unknown to this system, so a reload, a
-- second caller or a reused packet can never obtain another executable packet: only a reconciliation (or a verified result) can move the publication on.
create function public.admin_feedback_publication_dispatch(p_issue uuid, p_attempt integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); p feedback.publications%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('feedback:issue:' || p_issue::text, 0));
  select * into p from feedback.publications where issue_id = p_issue for update;
  if p.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  -- MUTABLE:fb_pub_attempt_fence begin
  if p_attempt is distinct from p.attempt then raise exception 'stale attempt: this is not the current attempt' using errcode = '55000'; end if;
  -- MUTABLE:fb_pub_attempt_fence end
  -- MUTABLE:fb_pub_dispatch_once begin
  if p.status <> 'prepared' then raise exception 'this attempt is not prepared (it was already released or is no longer current)' using errcode = '55000'; end if;
  -- MUTABLE:fb_pub_dispatch_once end
  -- MUTABLE:fb_pub_stale_dispatch begin
  perform feedback.pub_assert_current(p_issue, p);
  -- MUTABLE:fb_pub_stale_dispatch end
  perform feedback.pub_guard_actor(p_issue, a);
  update feedback.publications set status = 'dispatched', dispatched_at = clock_timestamp(), updated_at = clock_timestamp() where id = p.id;
  insert into feedback.publication_events (publication_id, from_status, to_status, detail, actor_id, draft_version, attempt) values (p.id, 'prepared', 'dispatched', 'dispatched', a, p.draft_version, p.attempt);
  return feedback.pub_packet(p_issue, 'transfer');
end $$;

-- (4) REPORT: records what the connector transfer / reconciliation found, FENCED to the attempt it belongs to. Nothing is trusted: the destination, the URL shape, the
-- marker and the read-back hash must all equal what this system expects, or the publication fails CLOSED into `conflict` for manual resolution. The mapping is written
-- once and never overwritten. `none_found` (the only way back to ready after a dispatched attempt) needs EXHAUSTIVE-absence evidence.
create function public.admin_feedback_publication_report(p_issue uuid, p_attempt integer, p_outcome text, p_repo text default null, p_number integer default null,
  p_url text default null, p_marker text default null, p_readback_hash text default null, p_since timestamptz default null, p_pages integer default null,
  p_scanned integer default null, p_complete boolean default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); p feedback.publications%rowtype; ok boolean; to_s text; code text; allowed text[];
begin
  perform pg_advisory_xact_lock(hashtextextended('feedback:issue:' || p_issue::text, 0));
  select * into p from feedback.publications where issue_id = p_issue for update;
  if p.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_outcome is null or p_outcome not in ('cancelled', 'created', 'found', 'updated', 'none_found', 'multiple', 'uncertain', 'failed') then raise exception 'unknown outcome' using errcode = '22023'; end if;
  -- MUTABLE:fb_pub_attempt_fence_report begin
  if p_attempt is distinct from p.attempt then raise exception 'stale attempt: this result belongs to an older attempt and was ignored' using errcode = '55000'; end if;
  -- MUTABLE:fb_pub_attempt_fence_report end
  allowed := case p_outcome
    when 'cancelled' then array['prepared'] when 'failed' then array['dispatched'] when 'created' then array['dispatched'] when 'updated' then array['dispatched']
    when 'uncertain' then array['dispatched', 'uncertain'] when 'found' then array['dispatched', 'uncertain', 'failed', 'conflict']
    when 'multiple' then array['dispatched', 'uncertain', 'failed', 'conflict'] else array['uncertain', 'failed'] end;   -- none_found
  if not (p.status = any (allowed)) then raise exception 'this result does not apply to the current state (%)', p.status using errcode = '55000'; end if;
  perform feedback.pub_guard_actor(p_issue, a);
  if p_outcome = 'cancelled' then
    update feedback.publications set status = 'ready', updated_at = clock_timestamp() where id = p.id;
    to_s := 'ready'; code := 'cancelled';
  elsif p_outcome in ('created', 'found', 'updated') then
    -- MUTABLE:fb_pub_verify begin
    ok := p_repo is not distinct from 'vindexholdings/open-stall'
      and p_number is not null and p_number >= 1
      and p_url is not distinct from ('https://github.com/vindexholdings/open-stall/issues/' || p_number)
      and p_marker is not distinct from p.marker
      and p_readback_hash is not distinct from p.expected_hash
      and (p.issue_number is null or p.issue_number = p_number)               -- an existing mapping can never be pointed at another issue
      and (p_outcome <> 'created' or p.issue_number is null)                  -- a create report can never follow a recorded mapping
      and (p_outcome <> 'updated' or p.operation = 'update')
      and not exists (select 1 from feedback.publications o where o.issue_number = p_number and o.id <> p.id);
    -- MUTABLE:fb_pub_verify end
    if ok then
      update feedback.publications set status = 'published', issue_number = p_number, issue_url = p_url, published_hash = p.expected_hash, updated_at = clock_timestamp() where id = p.id;
      to_s := 'published'; code := 'published';
    else
      update feedback.publications set status = 'conflict', updated_at = clock_timestamp() where id = p.id;
      to_s := 'conflict'; code := 'verification_failed';
    end if;
  elsif p_outcome = 'none_found' then
    -- An empty or partial search is NOT absence. Only a COMPLETE listing that started before the transfer was released proves it.
    -- MUTABLE:fb_pub_absence begin
    if p_complete is not true or p_pages is null or p_pages < 1 or p_pages > 50 or p_scanned is null or p_scanned < 0 or p_scanned > 100000
       or p_since is null or p_since > p.dispatched_at - interval '10 minutes' or p_since < p.dispatched_at - interval '7 days' then
      raise exception 'absence is not verified: a complete listing that started before the transfer is required' using errcode = '22023';
    end if;
    -- MUTABLE:fb_pub_absence end
    update feedback.publications set status = 'ready', dispatched_at = null, updated_at = clock_timestamp() where id = p.id;
    to_s := 'ready'; code := 'absence_verified';
  elsif p_outcome = 'multiple' then
    update feedback.publications set status = 'conflict', updated_at = clock_timestamp() where id = p.id;
    to_s := 'conflict'; code := 'multiple_matches';
  elsif p_outcome = 'uncertain' then
    update feedback.publications set status = 'uncertain', updated_at = clock_timestamp() where id = p.id;
    to_s := 'uncertain'; code := 'uncertain';
  else   -- failed: the connector definitively refused. The attempt is still dispatched: only verified absence reopens a create.
    update feedback.publications set status = 'failed', updated_at = clock_timestamp() where id = p.id;
    to_s := 'failed'; code := 'failed_confirmed';
  end if;
  insert into feedback.publication_events (publication_id, from_status, to_status, detail, actor_id, draft_version, attempt, pages_checked, issues_scanned)
    values (p.id, p.status, to_s, code, a, p.draft_version, p.attempt, case when code = 'absence_verified' then p_pages end, case when code = 'absence_verified' then p_scanned end);
  return feedback.pub_json(p_issue);
end $$;

-- ---------------------------------------------------------------- ownership, row security, grants
alter function feedback.pub_marker(uuid) owner to feedback_owner;
alter function feedback.pub_body(text, text) owner to feedback_owner;
alter function feedback.pub_expected_hash(text, text, text) owner to feedback_owner;
alter function feedback.pub_transition_ok(text, text) owner to feedback_owner;
alter function feedback.guard_publications() owner to feedback_owner;
alter function feedback.pub_guard_actor(uuid, uuid) owner to feedback_owner;
alter function feedback.pub_json(uuid) owner to feedback_owner;
alter function feedback.pub_packet(uuid, text) owner to feedback_owner;
alter function feedback.pub_assert_current(uuid, feedback.publications) owner to feedback_owner;
alter function public.admin_feedback_publication_get(uuid) owner to feedback_owner;
alter function public.admin_feedback_publication_request(uuid) owner to feedback_owner;
alter function public.admin_feedback_publication_begin(uuid) owner to feedback_owner;
alter function public.admin_feedback_publication_dispatch(uuid, integer) owner to feedback_owner;
alter function public.admin_feedback_publication_report(uuid, integer, text, text, integer, text, text, text, timestamptz, integer, integer, boolean) owner to feedback_owner;
alter table feedback.publications owner to feedback_owner;
alter table feedback.publication_events owner to feedback_owner;
alter table feedback.publications enable row level security;        alter table feedback.publications force row level security;
alter table feedback.publication_events enable row level security;  alter table feedback.publication_events force row level security;
revoke all on feedback.publications, feedback.publication_events from public, anon, authenticated, service_role;
grant select, insert, update (status, operation, draft_version, expected_hash, links_fp, issue_number, issue_url, published_hash, attempt, dispatched_at, updated_at) on feedback.publications to feedback_owner;
grant select, insert on feedback.publication_events to feedback_owner;
create policy owner_select on feedback.publications for select to feedback_owner using (true);
create policy owner_insert on feedback.publications for insert to feedback_owner with check (true);
create policy owner_update on feedback.publications for update to feedback_owner using (true) with check (true);
create policy owner_select on feedback.publication_events for select to feedback_owner using (true);
create policy owner_insert on feedback.publication_events for insert to feedback_owner with check (true);
revoke all on function feedback.pub_marker(uuid), feedback.pub_body(text, text), feedback.pub_expected_hash(text, text, text), feedback.pub_transition_ok(text, text),
  feedback.guard_publications(), feedback.pub_guard_actor(uuid, uuid), feedback.pub_json(uuid), feedback.pub_packet(uuid, text), feedback.pub_assert_current(uuid, feedback.publications)
  from public, anon, authenticated, service_role;
grant execute on function feedback.pub_marker(uuid), feedback.pub_body(text, text), feedback.pub_expected_hash(text, text, text), feedback.pub_transition_ok(text, text),
  feedback.pub_guard_actor(uuid, uuid), feedback.pub_json(uuid), feedback.pub_packet(uuid, text), feedback.pub_assert_current(uuid, feedback.publications) to feedback_owner;
revoke all on function public.admin_feedback_publication_get(uuid), public.admin_feedback_publication_request(uuid), public.admin_feedback_publication_begin(uuid),
  public.admin_feedback_publication_dispatch(uuid, integer),
  public.admin_feedback_publication_report(uuid, integer, text, text, integer, text, text, text, timestamptz, integer, integer, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_feedback_publication_get(uuid), public.admin_feedback_publication_request(uuid), public.admin_feedback_publication_begin(uuid),
  public.admin_feedback_publication_dispatch(uuid, integer),
  public.admin_feedback_publication_report(uuid, integer, text, text, integer, text, text, text, timestamptz, integer, integer, boolean) to authenticated;   -- each opens with public.require_admin(): EXECUTE is only the transport
