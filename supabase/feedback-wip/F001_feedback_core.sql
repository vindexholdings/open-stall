-- OS-APP-FEEDBACK F1 (local core). SOURCE ONLY: this directory is outside supabase/migrations/ on purpose and is applied only by
-- scripts/test-db-feedback.sh to a throwaway local PostgreSQL 16. Nothing here may be applied to a hosted or production database; moving a file
-- into supabase/migrations/ is a separate, explicitly approved step.
--
-- F001: owner role, private schema, tables, guards, row security. Private app feedback (bugs, usability problems, suggestions) is deliberately
-- SEPARATE from restroom reports/corrections: it touches none of those tables, functions or rules.
--
-- Data lifecycle (stated before acceptance):
--  * RAW content (feedback.items and its status history) is linked to the account with ON DELETE CASCADE: deleting the account through the existing
--    path (public.delete_my_account deletes auth.users) removes that account's raw feedback and its history. Nothing in this schema needs to
--    change that function.
--  * feedback.issues (canonical issues) and feedback.drafts are REVIEWER-AUTHORED sanitized abstractions with no submitter identifier, no raw
--    submitted text and no per-user link; they survive an account deletion by design (they are the reviewers' own work product). The link
--    from a deleted account's item to an issue disappears with the item. This is the only retained provenance, and it is not raw content.
--  * No audit-expiry, indefinite-retention or legal-compliance claim is made here; those remain open owner/legal questions.

create role feedback_owner nologin noinherit nobypassrls nosuperuser nocreatedb nocreaterole noreplication;
grant feedback_owner to current_user;   -- lets the migration role hand ownership to feedback_owner (a no-op for a superuser)

create schema feedback;
revoke all on schema feedback from public;
grant usage on schema feedback to feedback_owner;
grant usage on schema auth to feedback_owner;   -- auth.uid() and the existing admin gate read the session identity; nothing else of auth

-- ---------------------------------------------------------------- text rules (enforced by the server, never by the client alone)
-- Intake text: no markup, links, e-mail addresses, phone-like numbers, precise coordinates, control characters, or long unbroken token-like strings
-- (which would be credentials). Feedback is untrusted DATA: it is stored and rendered as inert text only.
create function feedback.text_ok(t text) returns boolean language sql immutable set search_path = '' as $$
  select t is not null
     and t !~ '[<>]'
     and t !~* '(https?:|www[.]|://|[a-z0-9_.+-]+@[a-z0-9-]+|[a-z0-9-]+[.](com|net|org|io|dev|app|co|us|edu|gov|ly|me)([^a-z]|$))'
     and t !~ '[(]?[0-9]{3}[)]?[ .-]?[0-9]{3}[ .-]?[0-9]{4}'
     and t !~ '[+][0-9][0-9 ().-]{7,}[0-9]'
     and t !~ '[0-9]{10,}'
     and t !~ '-?[0-9]{1,3}[.][0-9]{4,}'
     and t !~ '[A-Za-z0-9_+/=-]{32,}'
     and regexp_replace(t, E'[\n\t]', '', 'g') !~ '[[:cntrl:]]'
$$;
-- Public (publication) text is a much stricter allowlist: letters, digits, spaces and a small set of punctuation, and no run of 5+ digits.
-- Anything the server cannot positively verify as safe is refused (fail closed).
create function feedback.safe_public_text(t text) returns boolean language sql immutable set search_path = '' as $$
  select feedback.text_ok(t)
     and t ~ '^[A-Za-z0-9 .,;:!?''"()/+%&_\n-]+$'
     and t !~ '[0-9]{5,}'
     and t !~* '(bearer|password|secret|token|apikey|api key|authorization)'
$$;
-- A few normalized title tokens for duplicate CANDIDATE hints only (never an automatic decision).
create function feedback.tokens(title text) returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array(select distinct w from regexp_split_to_table(lower(regexp_replace(title, '[^a-zA-Z0-9]+', ' ', 'g')), ' ') w
                          where length(w) between 3 and 30 and w not in ('the','and','for','with','not','are','you','app','when','this','that','from','have','does','its')
                          order by w limit 12), '{}')
$$;
create function feedback.transition_ok(a text, b text) returns boolean language sql immutable set search_path = '' as $$
  select (a, b) in (('received','reviewing'),
                    ('reviewing','planned'), ('reviewing','in_progress'), ('reviewing','resolved'), ('reviewing','closed'),
                    ('planned','in_progress'), ('planned','resolved'), ('planned','closed'),
                    ('in_progress','resolved'), ('in_progress','closed'),
                    ('resolved','closed'), ('resolved','reviewing'), ('closed','reviewing'))
$$;

-- ---------------------------------------------------------------- tables
create table feedback.issues (   -- reviewer-authored canonical issue; NO submitter linkage and NO raw submitted text
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 5 and 120 and feedback.safe_public_text(title)),
  summary text not null check (char_length(summary) between 10 and 1000 and feedback.safe_public_text(summary)),
  publication_key uuid not null unique default gen_random_uuid(),   -- private retry/reconciliation key (F2 maps it to an external issue)
  external_number integer check (external_number is null or external_number > 0),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp()
);

create table feedback.items (    -- RAW submission: private to its author and the admin queue
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  content_hash text not null,
  kind text not null check (kind in ('bug', 'usability', 'suggestion')),
  screen text not null check (screen in ('nearby', 'map', 'list', 'location_detail', 'favorites', 'account', 'settings', 'add_restroom', 'report', 'sign_in', 'other')),
  title text not null check (char_length(title) between 5 and 100 and feedback.text_ok(title)),
  description text not null check (char_length(description) between 10 and 2000 and feedback.text_ok(description)),
  expected text check (expected is null or (char_length(expected) between 1 and 500 and feedback.text_ok(expected))),
  actual text check (actual is null or (char_length(actual) between 1 and 500 and feedback.text_ok(actual))),
  steps text check (steps is null or (char_length(steps) between 1 and 1000 and feedback.text_ok(steps))),
  frequency text check (frequency is null or frequency in ('once', 'sometimes', 'often', 'always')),
  impact text check (impact is null or impact in ('minor', 'moderate', 'blocking')),
  app_version text check (app_version is null or app_version ~ '^[0-9]{1,3}([.][0-9]{1,3}){0,3}$'),
  platform text check (platform is null or platform in ('ios', 'android', 'web')),
  status text not null default 'received' check (status in ('received', 'reviewing', 'planned', 'in_progress', 'resolved', 'closed', 'duplicate')),
  tokens text[] not null default '{}',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (user_id, idempotency_key)
);
create index feedback_items_user_idx on feedback.items (user_id, created_at desc, id desc);
create index feedback_items_queue_idx on feedback.items (created_at, id);
create index feedback_items_status_idx on feedback.items (status, created_at, id);
create index feedback_items_tokens_idx on feedback.items using gin (tokens);

create table feedback.status_history (   -- append-only; the note is INTERNAL and is never returned to the submitter
  id bigint generated always as identity primary key,
  item_id uuid not null references feedback.items (id) on delete cascade,
  from_status text,
  to_status text not null check (to_status in ('received', 'reviewing', 'planned', 'in_progress', 'resolved', 'closed', 'duplicate')),
  actor_kind text not null check (actor_kind in ('system', 'admin')),
  actor_id uuid,
  note text check (note is null or (char_length(note) between 1 and 500 and feedback.text_ok(note))),
  created_at timestamptz not null default clock_timestamp(),
  check ((actor_kind = 'admin') = (actor_id is not null))
);
create index feedback_history_item_idx on feedback.status_history (item_id, id);

create table feedback.item_links (   -- one canonical link per item; the original item is never overwritten by linking
  item_id uuid primary key references feedback.items (id) on delete cascade,
  issue_id uuid not null references feedback.issues (id) on delete restrict,
  role text not null check (role in ('origin', 'duplicate')),
  linked_by uuid not null,
  linked_at timestamptz not null default clock_timestamp()
);
create unique index feedback_one_origin_idx on feedback.item_links (issue_id) where role = 'origin';
create index feedback_links_issue_idx on feedback.item_links (issue_id);

create table feedback.drafts (   -- immutable versions of a reviewer-authored, allowlisted publication snapshot; approval is bound to ONE version's hash
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references feedback.issues (id) on delete restrict,
  version integer not null check (version >= 1),
  title text not null check (char_length(title) between 5 and 100 and feedback.safe_public_text(title)),
  category text not null check (category in ('bug', 'usability', 'suggestion')),
  problem text not null check (char_length(problem) between 10 and 300 and feedback.safe_public_text(problem)),
  repro text check (repro is null or (char_length(repro) between 1 and 500 and feedback.safe_public_text(repro))),
  expected_actual text check (expected_actual is null or (char_length(expected_actual) between 1 and 300 and feedback.safe_public_text(expected_actual))),
  platform text check (platform is null or platform in ('ios', 'android', 'web')),
  app_version text check (app_version is null or app_version ~ '^[0-9]{1,3}([.][0-9]{1,3}){0,3}$'),
  acceptance_hint text check (acceptance_hint is null or (char_length(acceptance_hint) between 1 and 300 and feedback.safe_public_text(acceptance_hint))),
  body text not null,
  body_hash text not null,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  approved_by uuid,
  approved_at timestamptz,
  approved_hash text,
  unique (issue_id, version),
  check ((approved_by is null) = (approved_at is null) and (approved_by is null) = (approved_hash is null))
);

-- ---------------------------------------------------------------- guards (SECURITY INVOKER, fixed search_path, no client-settable input)
create function feedback.guard_append_only() returns trigger language plpgsql set search_path = '' as $$
begin
  -- A DELETE is allowed ONLY as a cascade from an account deletion (it then runs inside a referential-integrity trigger, so the trigger depth is >= 2).
  if tg_op = 'DELETE' and pg_trigger_depth() >= 2 then return old; end if;
  raise exception 'feedback.% is append-only (% refused)', tg_table_name, tg_op using errcode = '42501';
end $$;
create function feedback.guard_truncate() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'feedback.% cannot be truncated', tg_table_name using errcode = '42501'; end $$;
-- items: only status/updated_at may change, and only along a valid transition (or as part of a link, which sets 'duplicate'); never the owner or content.
create function feedback.guard_items() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() >= 2 then return old; end if;   -- cascade from account deletion only
    raise exception 'feedback.items cannot be deleted directly' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
    raise exception 'feedback content and owner are immutable' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (feedback.transition_ok(old.status, new.status) or (new.status = 'duplicate' and old.status <> 'duplicate')) then
    raise exception 'invalid status transition % -> %', old.status, new.status using errcode = '22023';
  end if;
  return new;
end $$;
create function feedback.guard_item_links() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() >= 2 then return old; end if;
  raise exception 'feedback.item_links is append-only (% refused)', tg_op using errcode = '42501';
end $$;
create function feedback.guard_issues() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'external_number') is not distinct from (to_jsonb(old) - 'external_number') and old.external_number is null then return new; end if;
  raise exception 'feedback.issues is immutable (% refused); a change is a new draft version', tg_op using errcode = '42501';
end $$;
create function feedback.guard_drafts() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.approved_by is null and new.approved_by is not null
     and (to_jsonb(new) - 'approved_by' - 'approved_at' - 'approved_hash') = (to_jsonb(old) - 'approved_by' - 'approved_at' - 'approved_hash')
     and new.approved_hash = old.body_hash then return new;   -- the ONLY change: a one-time approval bound to this version's own hash
  end if;
  raise exception 'feedback.drafts is immutable (% refused); an edit is a new version', tg_op using errcode = '42501';
end $$;

create trigger status_history_guard before update or delete on feedback.status_history for each row execute function feedback.guard_append_only();
create trigger status_history_no_truncate before truncate on feedback.status_history for each statement execute function feedback.guard_truncate();
create trigger items_guard before update or delete on feedback.items for each row execute function feedback.guard_items();
create trigger items_no_truncate before truncate on feedback.items for each statement execute function feedback.guard_truncate();
create trigger item_links_guard before update or delete on feedback.item_links for each row execute function feedback.guard_item_links();
create trigger item_links_no_truncate before truncate on feedback.item_links for each statement execute function feedback.guard_truncate();
create trigger issues_guard before update or delete on feedback.issues for each row execute function feedback.guard_issues();
create trigger issues_no_truncate before truncate on feedback.issues for each statement execute function feedback.guard_truncate();
create trigger drafts_guard before update or delete on feedback.drafts for each row execute function feedback.guard_drafts();
create trigger drafts_no_truncate before truncate on feedback.drafts for each statement execute function feedback.guard_truncate();

-- ---------------------------------------------------------------- ownership, row security and grants (explicit and minimal)
alter table feedback.issues owner to feedback_owner;
alter table feedback.items owner to feedback_owner;
alter table feedback.status_history owner to feedback_owner;
alter table feedback.item_links owner to feedback_owner;
alter table feedback.drafts owner to feedback_owner;
alter table feedback.issues enable row level security;          alter table feedback.issues force row level security;
alter table feedback.items enable row level security;           alter table feedback.items force row level security;
alter table feedback.status_history enable row level security;  alter table feedback.status_history force row level security;
alter table feedback.item_links enable row level security;      alter table feedback.item_links force row level security;
alter table feedback.drafts enable row level security;          alter table feedback.drafts force row level security;
revoke all on feedback.issues, feedback.items, feedback.status_history, feedback.item_links, feedback.drafts from public, anon, authenticated, service_role;
grant select, insert, update (external_number) on feedback.issues to feedback_owner;
grant select, insert, update (status, updated_at), delete on feedback.items to feedback_owner;
grant select, insert, delete on feedback.status_history to feedback_owner;
grant select, insert, delete on feedback.item_links to feedback_owner;
grant select, insert, update (approved_by, approved_at, approved_hash) on feedback.drafts to feedback_owner;
create policy owner_select on feedback.issues for select to feedback_owner using (true);
create policy owner_insert on feedback.issues for insert to feedback_owner with check (true);
create policy owner_update on feedback.issues for update to feedback_owner using (true) with check (true);
create policy owner_select on feedback.items for select to feedback_owner using (true);
create policy owner_insert on feedback.items for insert to feedback_owner with check (true);
create policy owner_update on feedback.items for update to feedback_owner using (true) with check (true);
create policy owner_delete on feedback.items for delete to feedback_owner using (true);
create policy owner_select on feedback.status_history for select to feedback_owner using (true);
create policy owner_insert on feedback.status_history for insert to feedback_owner with check (true);
create policy owner_delete on feedback.status_history for delete to feedback_owner using (true);
create policy owner_select on feedback.item_links for select to feedback_owner using (true);
create policy owner_insert on feedback.item_links for insert to feedback_owner with check (true);
create policy owner_delete on feedback.item_links for delete to feedback_owner using (true);
create policy owner_select on feedback.drafts for select to feedback_owner using (true);
create policy owner_insert on feedback.drafts for insert to feedback_owner with check (true);
create policy owner_update on feedback.drafts for update to feedback_owner using (true) with check (true);
revoke all on function feedback.text_ok(text), feedback.safe_public_text(text), feedback.tokens(text), feedback.transition_ok(text, text),
  feedback.guard_append_only(), feedback.guard_truncate(), feedback.guard_items(), feedback.guard_item_links(), feedback.guard_issues(), feedback.guard_drafts()
  from public, anon, authenticated, service_role;
grant execute on function feedback.text_ok(text), feedback.safe_public_text(text), feedback.tokens(text), feedback.transition_ok(text, text) to feedback_owner;
-- (a generated identity needs the sequence privilege of the table owner, which it already holds as the owner of the sequence)
