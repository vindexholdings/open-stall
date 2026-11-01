\i :ROOT/supabase/tests/feedback/helpers.sql
select pg_temp.mkuser(1) as u1 \gset
select pg_temp.ok((pg_temp.submit(:'u1'::uuid, pg_temp.key(1)) ->> 'status') = 'received', 'smoke: a submission is received');
select pg_temp.finish();
