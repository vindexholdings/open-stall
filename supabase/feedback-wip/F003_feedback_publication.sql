-- OS-APP-FEEDBACK F2: the PRIVATE state of the reviewer-approved, sanitized publication bridge. WIP SQL for a disposable PostgreSQL 16 only (never supabase/migrations).
-- The app holds NO GitHub credential and creates NO issue: a human (through the existing authorized connector) transfers the exact approved snapshot, then the
-- result is recorded here with verification. A timeout is never proof of "nothing was created": the state becomes `uncertain` and must be reconciled by the
-- non-identifying marker BEFORE any retry. This is not a cross-system atomic transaction and not an exactly-once guarantee.

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
    ('ready', 'awaiting_transfer'),
    ('awaiting_transfer', 'published'), ('awaiting_transfer', 'uncertain'), ('awaiting_transfer', 'failed'), ('awaiting_transfer', 'conflict'),
    ('uncertain', 'published'), ('uncertain', 'ready'), ('uncertain', 'conflict'),
    ('conflict', 'published'),
    ('failed', 'ready'),
    ('published', 'ready'))
$$;

-- ---------------------------------------------------------------- tables
create table feedback.publications (   -- ONE row per canonical issue; the GitHub mapping, once set, is immutable and unique
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null unique references feedback.issues (id) on delete restrict,
  marker text not null unique check (marker ~ '^OSFB-[0-9a-f]{20}$'),
  status text not null check (status in ('ready', 'awaiting_transfer', 'uncertain', 'published', 'failed', 'conflict')),
  operation text not null check (operation in ('create', 'update')),
  draft_version integer not null check (draft_version >= 1),
  expected_hash text not null check (expected_hash ~ '^[0-9a-f]{64}$'),   -- hash of the exact title + body-with-marker that must be read back
  links_fp text not null,                                                -- the reviewed eligibility revision (linked-item set) at request time
  issue_number integer check (issue_number >= 1),
  issue_url text,
  published_hash text check (published_hash is null or published_hash ~ '^[0-9a-f]{64}$'),
  attempts integer not null default 0 check (attempts >= 0),
  requested_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((issue_number is null) = (issue_url is null)),
  check (issue_url is null or issue_url = 'https://github.com/vindexholdings/open-stall/issues/' || issue_number),
  check (status <> 'published' or published_hash is not null)
);
create unique index feedback_publication_number_idx on feedback.publications (issue_number) where issue_number is not null;   -- never two canonical issues on one GitHub issue

create table feedback.publication_events (   -- append-only; the detail is a code from a fixed list, never free text
  id bigint generated always as identity primary key,
  publication_id uuid not null references feedback.publications (id) on delete restrict,
  from_status text,
  to_status text not null check (to_status in ('ready', 'awaiting_transfer', 'uncertain', 'published', 'failed', 'conflict')),
  detail text not null check (detail in ('requested', 'refreshed', 'transfer_started', 'published', 'uncertain', 'none_found', 'multiple_matches', 'verification_failed', 'failed_confirmed')),
  actor_id uuid not null,
  draft_version integer not null,
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
  return jsonb_build_object('status', p.status, 'operation', p.operation, 'version', p.draft_version, 'marker', p.marker, 'expected_hash', p.expected_hash,
    'issue_number', p.issue_number, 'issue_url', p.issue_url, 'attempts', p.attempts, 'published_hash', p.published_hash,
    'current', d.id is not null and d.version = p.draft_version and p.status <> 'none',
    'eligible', blk is null, 'block', blk, 'repo', 'vindexholdings/open-stall');
end $$;

create function public.admin_feedback_publication_get(p_issue uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin();
begin
  if not exists (select 1 from feedback.issues where id = p_issue) then raise exception 'not found' using errcode = 'P0002'; end if;
  return feedback.pub_json(p_issue);
end $$;

-- (1) REQUEST: only for a currently eligible approved snapshot. Creates the private publication row, refreshes a ready/failed one, or returns the verified
-- mapping for an exact replay. A published issue with a NEWER approved snapshot becomes an UPDATE of the SAME GitHub issue, never a second create.
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
    insert into feedback.publication_events (publication_id, from_status, to_status, detail, actor_id, draft_version) values (p.id, null, 'ready', 'requested', a, d.version);
  elsif p.status in ('awaiting_transfer', 'uncertain', 'conflict') then
    raise exception 'a transfer is already in progress or unresolved; reconcile it first' using errcode = '55000';
  elsif p.status = 'published' and p.published_hash = eh then
    return feedback.pub_json(p_issue) || jsonb_build_object('replayed', true);    -- exact replay: the verified mapping, nothing new
  else
    update feedback.publications set status = 'ready', operation = case when p.issue_number is null then 'create' else 'update' end,
      draft_version = d.version, expected_hash = eh, links_fp = fp, updated_at = clock_timestamp() where id = p.id;
    insert into feedback.publication_events (publication_id, from_status, to_status, detail, actor_id, draft_version) values (p.id, p.status, 'ready', 'refreshed', a, d.version);
  end if;
  return feedback.pub_json(p_issue) || jsonb_build_object('replayed', false);
end $$;

-- (2) BEGIN: re-proves the CURRENT eligibility and the exact snapshot immediately before anything may leave, moves ready -> awaiting_transfer and returns the
-- transfer packet, built field by field (never a serialization of the private issue). Exactly one concurrent caller can begin.
create function public.admin_feedback_publication_begin(p_issue uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); d feedback.drafts%rowtype; p feedback.publications%rowtype; blk text;
begin
  perform pg_advisory_xact_lock(hashtextextended('feedback:issue:' || p_issue::text, 0));
  select * into p from feedback.publications where issue_id = p_issue for update;
  if p.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if p.status <> 'ready' then raise exception 'this publication is not ready to transfer (%)', p.status using errcode = '55000'; end if;
  select * into d from feedback.drafts where issue_id = p_issue order by version desc limit 1;
  -- MUTABLE:fb_pub_stale begin
  blk := feedback.export_block(p_issue, d.id);
  if blk is not null or d.version <> p.draft_version or feedback.pub_expected_hash(d.title, d.body, p.marker) <> p.expected_hash or feedback.link_set(p_issue) <> p.links_fp then
    raise exception 'the approved snapshot or its eligibility changed; request the publication again' using errcode = '55000';
  end if;
  -- MUTABLE:fb_pub_stale end
  perform feedback.pub_guard_actor(p_issue, a);
  update feedback.publications set status = 'awaiting_transfer', attempts = attempts + 1, updated_at = clock_timestamp() where id = p.id;
  insert into feedback.publication_events (publication_id, from_status, to_status, detail, actor_id, draft_version) values (p.id, 'ready', 'awaiting_transfer', 'transfer_started', a, p.draft_version);
  return jsonb_build_object('repo', 'vindexholdings/open-stall', 'operation', p.operation, 'issue_number', p.issue_number, 'marker', p.marker,
    'version', p.draft_version, 'title', d.title, 'body', feedback.pub_body(d.body, p.marker), 'expected_hash', p.expected_hash);
end $$;

-- (3) REPORT: records what the connector transfer / reconciliation found. Nothing is trusted: the destination, the URL shape, the marker and the readback hash must
-- all equal what this system expects, or the publication fails CLOSED into `conflict` for manual resolution. The mapping is written once and never overwritten.
create function public.admin_feedback_publication_report(p_issue uuid, p_outcome text, p_repo text default null, p_number integer default null,
  p_url text default null, p_marker text default null, p_readback_hash text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); p feedback.publications%rowtype; ok boolean; to_s text; code text;
begin
  perform pg_advisory_xact_lock(hashtextextended('feedback:issue:' || p_issue::text, 0));
  select * into p from feedback.publications where issue_id = p_issue for update;
  if p.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_outcome is null or p_outcome not in ('created', 'found', 'updated', 'none_found', 'multiple', 'uncertain', 'failed') then raise exception 'unknown outcome' using errcode = '22023'; end if;
  if p.status not in ('awaiting_transfer', 'uncertain', 'conflict') then raise exception 'no transfer is awaiting a result (%)', p.status using errcode = '55000'; end if;
  perform feedback.pub_guard_actor(p_issue, a);
  if p_outcome in ('created', 'found', 'updated') then
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
    if p.status <> 'uncertain' then raise exception 'only an uncertain transfer can be reconciled as nothing found' using errcode = '55000'; end if;
    update feedback.publications set status = 'ready', updated_at = clock_timestamp() where id = p.id;
    to_s := 'ready'; code := 'none_found';
  elsif p_outcome = 'multiple' then
    update feedback.publications set status = 'conflict', updated_at = clock_timestamp() where id = p.id;
    to_s := 'conflict'; code := 'multiple_matches';
  elsif p_outcome = 'uncertain' then
    if p.status = 'conflict' then raise exception 'a conflict needs verified evidence, not another uncertain result' using errcode = '55000'; end if;
    update feedback.publications set status = 'uncertain', updated_at = clock_timestamp() where id = p.id;
    to_s := 'uncertain'; code := 'uncertain';
  else   -- failed: the connector definitively refused and nothing was created
    if p.status <> 'awaiting_transfer' then raise exception 'only a transfer awaiting a result can fail' using errcode = '55000'; end if;
    update feedback.publications set status = 'failed', updated_at = clock_timestamp() where id = p.id;
    to_s := 'failed'; code := 'failed_confirmed';
  end if;
  insert into feedback.publication_events (publication_id, from_status, to_status, detail, actor_id, draft_version) values (p.id, p.status, to_s, code, a, p.draft_version);
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
alter function public.admin_feedback_publication_get(uuid) owner to feedback_owner;
alter function public.admin_feedback_publication_request(uuid) owner to feedback_owner;
alter function public.admin_feedback_publication_begin(uuid) owner to feedback_owner;
alter function public.admin_feedback_publication_report(uuid, text, text, integer, text, text, text) owner to feedback_owner;
alter table feedback.publications owner to feedback_owner;
alter table feedback.publication_events owner to feedback_owner;
alter table feedback.publications enable row level security;        alter table feedback.publications force row level security;
alter table feedback.publication_events enable row level security;  alter table feedback.publication_events force row level security;
revoke all on feedback.publications, feedback.publication_events from public, anon, authenticated, service_role;
grant select, insert, update (status, operation, draft_version, expected_hash, links_fp, issue_number, issue_url, published_hash, attempts, updated_at) on feedback.publications to feedback_owner;
grant select, insert on feedback.publication_events to feedback_owner;
create policy owner_select on feedback.publications for select to feedback_owner using (true);
create policy owner_insert on feedback.publications for insert to feedback_owner with check (true);
create policy owner_update on feedback.publications for update to feedback_owner using (true) with check (true);
create policy owner_select on feedback.publication_events for select to feedback_owner using (true);
create policy owner_insert on feedback.publication_events for insert to feedback_owner with check (true);
revoke all on function feedback.pub_marker(uuid), feedback.pub_body(text, text), feedback.pub_expected_hash(text, text, text), feedback.pub_transition_ok(text, text),
  feedback.guard_publications(), feedback.pub_guard_actor(uuid, uuid), feedback.pub_json(uuid) from public, anon, authenticated, service_role;
grant execute on function feedback.pub_marker(uuid), feedback.pub_body(text, text), feedback.pub_expected_hash(text, text, text), feedback.pub_transition_ok(text, text),
  feedback.pub_guard_actor(uuid, uuid), feedback.pub_json(uuid) to feedback_owner;
revoke all on function public.admin_feedback_publication_get(uuid), public.admin_feedback_publication_request(uuid), public.admin_feedback_publication_begin(uuid),
  public.admin_feedback_publication_report(uuid, text, text, integer, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_feedback_publication_get(uuid), public.admin_feedback_publication_request(uuid), public.admin_feedback_publication_begin(uuid),
  public.admin_feedback_publication_report(uuid, text, text, integer, text, text, text) to authenticated;   -- each opens with public.require_admin(): EXECUTE is only the transport
