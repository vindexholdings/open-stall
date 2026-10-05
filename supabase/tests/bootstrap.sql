-- Minimal stand-in for Supabase roles/auth so migrations can be validated on plain Postgres.
-- Used ONLY by scripts/test-db.sh against a throwaway local cluster. Never applied remotely.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public, auth to anon, authenticated, service_role;
-- Mirror Supabase default privileges (new public tables are granted to API roles).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
-- Stand-in for Supabase's auth.users (only the column the schema references).
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
