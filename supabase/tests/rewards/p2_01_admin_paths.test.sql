-- P2 test 1: every public admin RPC checks identity, enabled admin and aal2 INSIDE the entry, on real caller paths.
\i :ROOT/supabase/tests/rewards/p2_helpers.sql
select pg_temp.enable_rewards(1000000);
select pg_temp.mkadmin(1001) as a1 \gset
select pg_temp.mkadmin(1002) as a2 \gset
select pg_temp.mkuser(1003) as s \gset
select pg_temp.mkuser(1004) as n \gset
select pg_temp.mkadmin(1005, true) as dis \gset
select pg_temp.mkloc(43.0) as loc \gset
select pg_temp.vid('2026-10-20 15:00:00+00', :'s', :'loc', 'adminpath-0000000001') as v \gset
select pg_temp.setf('a1', :'a1'), pg_temp.setf('n', :'n'), pg_temp.setf('dis', :'dis');
select pg_temp.ok((select count(*) from public.admin_users where disabled_at is null) = 2, 'fixtures: two enabled admins and one disabled admin exist');

-- The four RPCs, each with a syntactically valid call. A valid hold first, so clear/recommend have something to act on later.
create temp table _rpc (name text, call text);
insert into _rpc values
  ('admin_reward_hold_user', format($$select public.admin_reward_hold_user(%L::uuid, 'matrix probe')::text$$, :'s')),
  ('admin_reward_clear_hold', format($$select public.admin_reward_clear_hold(%L::uuid, 'matrix probe')::text$$, :'s')),
  ('admin_reward_recommend_reversal', format($$select public.admin_reward_recommend_reversal(%L::uuid, 'matrix probe')::text$$, :'v')),
  ('admin_reward_finalize_reversal', $$select public.admin_reward_finalize_reversal(gen_random_uuid(), 'matrix probe')::text$$);

do $$
declare r record;
begin
  for r in select * from _rpc order by name loop
    perform pg_temp.fails_as('authenticated', pg_temp.f('n'), 'aal2', r.call, '42501', r.name || ': a signed-in non-admin at aal2 is refused');
    perform pg_temp.fails_as('authenticated', pg_temp.f('a1'), 'aal1', r.call, '42501', r.name || ': an enabled admin at aal1 is refused');
    perform pg_temp.fails_as('authenticated', pg_temp.f('a1'), null, r.call, '42501', r.name || ': an enabled admin with no aal claim is refused');
    perform pg_temp.fails_as('authenticated', pg_temp.f('dis'), 'aal2', r.call, '42501', r.name || ': a DISABLED admin at aal2 is refused');
    perform pg_temp.fails_as('authenticated', null, 'aal2', r.call, '28000', r.name || ': a missing identity is refused');
    perform pg_temp.fails_as('service_role', pg_temp.f('a1'), 'aal2', r.call, '42501', r.name || ': service_role has no EXECUTE even with an admin identity');
    perform pg_temp.fails_as('anon', pg_temp.f('a1'), 'aal2', r.call, '42501', r.name || ': anon has no EXECUTE');
  end loop;
end $$;

-- forged and shadowed inputs
select pg_temp.fails_as('authenticated', :'a1'::uuid, 'aal2', $$select public.admin_reward_hold_user(null, 'forged null subject')$$, '22023', 'a NULL subject is refused');
select pg_temp.fails_as('authenticated', :'a1'::uuid, 'aal2', format($$select public.admin_reward_hold_user(%L::uuid, 'forged self hold')$$, :'a1'), '42501', 'an administrator cannot hold their own account (self-adjudication)');
select pg_temp.fails_as('authenticated', :'a1'::uuid, 'aal2', format($$select public.admin_reward_hold_user(%L::uuid, 'ab')$$, :'s'), '23514', 'a too-short reason is refused by the audit table');
select pg_temp.fails_as('authenticated', :'a1'::uuid, 'aal2', format($$select public.admin_reward_hold_user(%L::uuid, 'x')$$, gen_random_uuid()), '23514', 'reason validated before an unknown account matters (shape constraints first)');
select pg_temp.fails_as('authenticated', :'a1'::uuid, 'aal2', format($$select public.admin_reward_hold_user(%L::uuid, 'valid reason')$$, gen_random_uuid()), '23503', 'a hold for an account that does not exist is refused by the foreign key');
select pg_temp.ok((select count(*) from rewards.reward_decisions) = 0 and (select count(*) from rewards.reward_holds) = 0, 'no refusal above left any decision or hold behind');
-- A client-supplied identity argument does not exist: the admin identity comes only from the verified JWT.
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'admin_reward%'
                   and pg_get_function_arguments(p.oid) ~* 'admin|actor|reviewer') = 0, 'no admin reward RPC accepts an admin/actor identity parameter');
-- shadowing: a hostile search_path and same-named temp objects change nothing, because every entry pins search_path = ''
create temp table reward_holds (id int);
create temp table reward_decisions (id int);
set search_path = pg_temp, public;
select pg_temp.as_role('authenticated', :'a1'::uuid, 'aal2', format($$select public.admin_reward_hold_user(%L::uuid, 'shadow-proof hold')::text$$, :'s')) as hd \gset
reset search_path;
select pg_temp.ok((select count(*) from rewards.reward_holds where user_id = :'s') = 1 and (select count(*) from pg_temp.reward_holds) = 0,
                  'with a hostile search_path and same-named temp tables the hold still lands in rewards.reward_holds');
select pg_temp.ok((select admin_id from rewards.reward_decisions where id = :'hd'::uuid) = :'a1'::uuid, 'the audit row records the verified JWT admin');
drop table pg_temp.reward_holds; drop table pg_temp.reward_decisions;
-- second hold for the same account is refused, then an enabled admin at aal2 can clear (both admins work)
select pg_temp.fails_as('authenticated', :'a2'::uuid, 'aal2', format($$select public.admin_reward_hold_user(%L::uuid, 'second hold')$$, :'s'), 'RW031', 'a second active hold for the same account is refused');
select pg_temp.fails_as('authenticated', :'s'::uuid, 'aal2', format($$select public.admin_reward_clear_hold(%L::uuid, 'self clear')$$, :'s'), '42501', 'the held subject cannot clear their own hold (they are not an administrator)');
select pg_temp.fails_as('authenticated', :'a1'::uuid, 'aal2', format($$select public.admin_reward_clear_hold(%L::uuid, 'no hold here')$$, :'n'), 'RW032', 'clearing an account without an active hold is refused');
select pg_temp.finish();
