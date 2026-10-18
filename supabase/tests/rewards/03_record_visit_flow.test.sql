-- P1 tests 1-3 and 7 (flow): rapid visits (no cooldown), UTC cap across local days and zones, DST, prospective policy
-- versions, idempotency, validation. Server time is injected through rewards.record_visit_at (the public wrapper always
-- passes the real clock), so every boundary is deterministic.
\i :ROOT/supabase/tests/rewards/helpers.sql
select pg_temp.enable_rewards(1000000);

-- ============================================================ rapid genuine visits, no cooldown, no hold
select pg_temp.mkuser(11) as u \gset
select pg_temp.mkloc(41.0) as la \gset
select pg_temp.vo('2026-10-20 15:00:00+00', :'u', :'la', 'rapid-0000000000001') as r1 \gset
select pg_temp.vo('2026-10-20 15:00:10+00', :'u', :'la', 'rapid-0000000000002') as r2 \gset
select pg_temp.vo('2026-10-20 15:00:20+00', :'u', :'la', 'rapid-0000000000003') as r3 \gset
select pg_temp.vo('2026-10-20 15:00:30+00', :'u', :'la', 'rapid-0000000000004') as r4 \gset
select pg_temp.vo('2026-10-20 15:00:40+00', :'u', :'la', 'rapid-0000000000005') as r5 \gset
select pg_temp.vo('2026-10-20 15:00:50+00', :'u', :'la', 'rapid-0000000000006') as r6 \gset
select pg_temp.ok(:'r1' = 'awarded|awarded|5|5', 'rapid visit 1 (30 s window): awarded spendable 5 and lifetime 5');
select pg_temp.ok(:'r2' = 'awarded|not_first_daily|5|0' and :'r3' = 'awarded|not_first_daily|5|0' and :'r4' = 'awarded|not_first_daily|5|0',
                  'rapid visits 2-4 each earn 5 spendable, no lifetime');
select pg_temp.ok(:'r5' = 'location_cap|not_first_daily|0|0' and :'r6' = 'location_cap|not_first_daily|0|0', 'the fifth and sixth are recorded without points (location_cap), no hold');
select pg_temp.ok((select spendable from rewards.user_balances(:'u')) = 20 and (select lifetime from rewards.user_balances(:'u')) = 5,
                  'four rapid visits earn exactly 20 spendable and 5 lifetime');
select pg_temp.ok((select array_agg(ordinal order by ordinal) from rewards.visits where user_id = :'u') = array[1,2,3,4,5,6],
                  'every visit is recorded and ordinals follow acceptance order (cap-blocked visits keep their slot)');
select pg_temp.ok((select count(*) from rewards.visits where user_id = :'u' and 'held' in (spendable_outcome, lifetime_outcome)) = 0, 'no visit is held');
-- Identical timestamps are accepted and rewarded: no interval is measured.
select pg_temp.mkuser(12) as u2 \gset
select pg_temp.vo('2026-10-20 16:00:00+00', :'u2', :'la', 'same-instant-000001') as a \gset
select pg_temp.vo('2026-10-20 16:00:00+00', :'u2', :'la', 'same-instant-000002') as b \gset
select pg_temp.vo('2026-10-20 16:00:00+00', :'u2', :'la', 'same-instant-000003') as c \gset
select pg_temp.vo('2026-10-20 16:00:00+00', :'u2', :'la', 'same-instant-000004') as d \gset
select pg_temp.ok(:'a' = 'awarded|awarded|5|5' and :'b' = 'awarded|not_first_daily|5|0' and :'c' = 'awarded|not_first_daily|5|0' and :'d' = 'awarded|not_first_daily|5|0',
                  'four visits at the SAME instant are all rewarded (no same-location minimum interval)');
-- Out-of-order timestamps do not change slot assignment either: the ordinal is the acceptance count.
select pg_temp.vo('2026-10-20 14:00:00+00', :'u2', :'la', 'same-instant-000005') as e \gset
select pg_temp.ok(:'e' = 'location_cap|not_first_daily|0|0', 'a fifth visit with an EARLIER timestamp still takes slot 5 (acceptance order, not time order)');

-- ============================================================ UTC cap across local days (60 spendable per user per UTC day)
select pg_temp.mkuser(13) as uc \gset
select pg_temp.mkloc(42.0) as lb \gset
select pg_temp.mkloc(42.1) as lc \gset
select pg_temp.mkloc(42.2) as ld \gset
select pg_temp.mkloc(42.3) as le \gset
-- psql does not substitute variables inside a dollar-quoted body, so the fixture takes them as arguments.
create function pg_temp.fill_cap(u uuid, locs uuid[]) returns void language plpgsql as $f$
declare r jsonb; i integer; l uuid;
begin
  foreach l in array locs loop
    for i in 1..4 loop
      r := pg_temp.visit_at(timestamptz '2026-10-20 23:00:00+00' + (i || ' seconds')::interval, u, l,
                            'cap-' || substr(l::text, 33, 4) || '-' || lpad(i::text, 8, '0') || '-xxxxxx');
    end loop;
  end loop;
end $f$;
select pg_temp.fill_cap(:'uc', array[:'la', :'lb', :'lc']::uuid[]);
select pg_temp.ok((select spendable from rewards.reward_counters_user_day where user_id = :'uc' and issuance_day_utc = '2026-10-20') = 60, 'three locations x four visits reach exactly 60 on the UTC day');
select pg_temp.vo('2026-10-20 23:30:00+00', :'uc', :'ld', 'cap-first-at-fourth-1') as r \gset
select pg_temp.ok(:'r' = 'user_day_cap|awarded|0|5', 'first visit with the user at 60: spendable user_day_cap, lifetime +5 still awarded');
select pg_temp.ok((select count(*) from rewards.reward_ledger where user_id = :'uc' and location_id = :'ld') = 1, 'exactly one ledger row (the lifetime award) for the capped visit');
select pg_temp.vo('2026-10-20 23:31:00+00', :'uc', :'ld', 'cap-second-at-fourth-1') as r \gset
select pg_temp.ok(:'r' = 'user_day_cap|not_first_daily|0|0', 'second visit while capped: nothing awarded');
-- 00:10Z is the NEXT UTC day but the SAME Denver local day: the user cap is per UTC day, the per-location rule per local day.
select pg_temp.vo('2026-10-21 00:10:00+00', :'uc', :'ld', 'cap-next-utc-day-01') as r \gset
select pg_temp.ok(:'r' = 'awarded|not_first_daily|5|0', 'after UTC midnight (same local day) the user cap has reset but the location ordinal continues (ordinal 3, no new lifetime)');
select pg_temp.ok((select count(*) from rewards.visits where location_id = :'ld' and user_id = :'uc' and policy_day_local = '2026-10-20') = 3, 'all three visits belong to local day 2026-10-20');
select pg_temp.ok((select spendable from rewards.reward_counters_user_day where user_id = :'uc' and issuance_day_utc = '2026-10-21') = 5
                  and (select spendable from rewards.reward_counters_user_day where user_id = :'uc' and issuance_day_utc = '2026-10-20') = 60,
                  'the two UTC days are counted separately');

-- ============================================================ day boundaries per location zone (and the UTC day separately)
select pg_temp.mkuser(14) as uz \gset
select pg_temp.mkloc(43.0, 'Pacific/Honolulu') as lh \gset
select pg_temp.mkloc(43.1, 'Asia/Kolkata') as lk \gset
select pg_temp.mkloc(43.2, 'America/Denver') as ldv \gset
select pg_temp.vo('2026-10-20 09:59:59+00', :'uz', :'lh', 'zone-honolulu-000001') as h1 \gset
select pg_temp.vo('2026-10-20 10:00:00+00', :'uz', :'lh', 'zone-honolulu-000002') as h2 \gset
select pg_temp.ok(:'h1' = 'awarded|awarded|5|5' and :'h2' = 'awarded|awarded|5|5', 'Honolulu: 09:59:59Z and 10:00:00Z straddle local midnight, so both are first visits');
select pg_temp.ok((select array_agg(policy_day_local order by occurred_at) from rewards.visits where location_id = :'lh') = array['2026-10-19','2026-10-20']::date[], 'Honolulu local days are 2026-10-19 and 2026-10-20');
select pg_temp.vo('2026-10-19 18:29:59+00', :'uz', :'lk', 'zone-kolkata-0000001') as k1 \gset
select pg_temp.vo('2026-10-19 18:30:00+00', :'uz', :'lk', 'zone-kolkata-0000002') as k2 \gset
select pg_temp.ok(:'k1' = 'awarded|awarded|5|5' and :'k2' = 'awarded|awarded|5|5', 'Kolkata: 18:29:59Z and 18:30:00Z straddle local midnight (UTC+05:30)');
select pg_temp.ok((select array_agg(policy_day_local order by occurred_at) from rewards.visits where location_id = :'lk') = array['2026-10-19','2026-10-20']::date[], 'Kolkata local days are 2026-10-19 and 2026-10-20');
select pg_temp.vo('2026-10-21 05:59:59+00', :'uz', :'ldv', 'zone-denver-00000001') as d1 \gset
select pg_temp.vo('2026-10-21 06:00:00+00', :'uz', :'ldv', 'zone-denver-00000002') as d2 \gset
select pg_temp.ok(:'d1' = 'awarded|awarded|5|5' and :'d2' = 'awarded|awarded|5|5', 'Denver (MDT, UTC-6): 05:59:59Z and 06:00:00Z straddle local midnight');
select pg_temp.ok((select array_agg(policy_day_local order by occurred_at) from rewards.visits where location_id = :'ldv') = array['2026-10-20','2026-10-21']::date[], 'Denver local days are 2026-10-20 and 2026-10-21');
select pg_temp.ok((select array_agg(issuance_day_utc order by occurred_at) from rewards.visits where location_id = :'ldv') = array['2026-10-21','2026-10-21']::date[],
                  'both Denver visits are on the same UTC day: the stored UTC day is independent of the local day');
select pg_temp.ok((select every(time_zone is not null) from rewards.visits where user_id = :'uz'), 'each visit stores the zone used');

-- ============================================================ DST: fall back 2026-11-01 (25-hour local day) and spring forward 2027-03-14 (23-hour day)
select pg_temp.mkuser(15) as ud \gset
select pg_temp.mkloc(44.0, 'America/Denver') as lz \gset
select pg_temp.vo('2026-11-01 05:59:59+00', :'ud', :'lz', 'dst-fall-0000000001') as f0 \gset
select pg_temp.vo('2026-11-01 06:00:00+00', :'ud', :'lz', 'dst-fall-0000000002') as f1 \gset
select pg_temp.vo('2026-11-01 07:30:00+00', :'ud', :'lz', 'dst-fall-0000000003') as f2 \gset
select pg_temp.vo('2026-11-01 08:30:00+00', :'ud', :'lz', 'dst-fall-0000000004') as f3 \gset
select pg_temp.vo('2026-11-02 06:00:00+00', :'ud', :'lz', 'dst-fall-0000000005') as f4 \gset
select pg_temp.vo('2026-11-02 06:59:59+00', :'ud', :'lz', 'dst-fall-0000000006') as f5 \gset
select pg_temp.vo('2026-11-02 07:00:00+00', :'ud', :'lz', 'dst-fall-0000000007') as f6 \gset
select pg_temp.ok(:'f0' = 'awarded|awarded|5|5', 'fall back: the last second before local midnight is its own (previous) local day');
select pg_temp.ok(:'f1' = 'awarded|awarded|5|5' and :'f2' = 'awarded|not_first_daily|5|0' and :'f3' = 'awarded|not_first_daily|5|0'
                  and :'f4' = 'awarded|not_first_daily|5|0', 'fall back: 06:00Z through 06:00Z next day (24 h later) are all ONE local day: ordinals 1-4');
select pg_temp.ok(:'f5' = 'location_cap|not_first_daily|0|0', 'fall back: the 25th hour still belongs to the same local day (fifth visit is capped)');
select pg_temp.ok(:'f6' = 'awarded|awarded|5|5', 'fall back: 07:00:00Z is local midnight of the next day (a new first visit)');
select pg_temp.ok((select array_agg(policy_day_local order by occurred_at) from rewards.visits where user_id = :'ud')
                  = array['2026-10-31','2026-11-01','2026-11-01','2026-11-01','2026-11-01','2026-11-01','2026-11-02']::date[], 'fall back: stored local days are exactly as expected');
select pg_temp.mkuser(16) as us \gset
select pg_temp.vo('2027-03-14 07:00:00+00', :'us', :'lz', 'dst-spring-000000001') as s1 \gset
select pg_temp.vo('2027-03-15 05:59:59+00', :'us', :'lz', 'dst-spring-000000002') as s2 \gset
select pg_temp.vo('2027-03-15 06:00:00+00', :'us', :'lz', 'dst-spring-000000003') as s3 \gset
select pg_temp.ok(:'s1' = 'awarded|awarded|5|5' and :'s2' = 'awarded|not_first_daily|5|0', 'spring forward: the 23-hour local day still holds ordinal 2 at its last second');
select pg_temp.ok(:'s3' = 'awarded|awarded|5|5', 'spring forward: only 23 hours after the day began, the next local day has started (nothing assumes 24 hours)');
select pg_temp.ok((select array_agg(policy_day_local order by occurred_at) from rewards.visits where user_id = :'us') = array['2027-03-14','2027-03-14','2027-03-15']::date[], 'spring forward: stored local days');

-- ============================================================ invalid or missing zone fails closed
select pg_temp.mkuser(17) as uf \gset
select pg_temp.mkloc(45.0, null) as lnz \gset
select pg_temp.mkloc(45.1, 'Mars/Phobos') as lbad \gset
select pg_temp.vo('2026-10-22 15:00:00+00', :'uf', :'lnz', 'zone-none-0000000001') as r \gset
select pg_temp.ok(:'r' = 'no_valid_time_zone|no_valid_time_zone|0|0', 'a location with no zone: recorded, nothing awarded (fails closed)');
select pg_temp.vo('2026-10-22 15:00:00+00', :'uf', :'lbad', 'zone-bad-00000000001') as r \gset
select pg_temp.ok(:'r' = 'no_valid_time_zone|no_valid_time_zone|0|0', 'a location with an invalid zone name: recorded, nothing awarded');
select pg_temp.ok((select count(*) from rewards.visits where user_id = :'uf' and ordinal is null and policy_day_local is null) = 2, 'those visits have no day and no ordinal');
select pg_temp.ok((select count(*) from rewards.reward_ledger where user_id = :'uf') = 0 and (select count(*) from rewards.reward_counters_user_day where user_id = :'uf') = 0, 'no ledger row and no counter change');

-- ============================================================ policy versions are prospective
select pg_temp.mkuser(18) as up \gset
select pg_temp.mkloc(46.0) as lp \gset
select date_trunc('day', now() at time zone 'UTC') + interval '10 days 18 hours' as eff_local \gset
select (:'eff_local'::timestamp at time zone 'UTC') as eff \gset
insert into rewards.reward_policy_versions (effective_from, spendable_per_visit, lifetime_first_daily, max_rewarded_per_location_day, max_spendable_per_user_utc_day)
  values (:'eff'::timestamptz, 10, 3, 2, 25);
select pg_temp.fails($$insert into rewards.reward_policy_versions (effective_from, spendable_per_visit, lifetime_first_daily, max_rewarded_per_location_day, max_spendable_per_user_utc_day)
  values (now() - interval '1 minute', 1, 1, 1, 1)$$, '22023', 'a policy version effective in the past is refused (prospective only)');
select pg_temp.fails($$insert into rewards.reward_policy_versions (effective_from, spendable_per_visit, lifetime_first_daily, max_rewarded_per_location_day, max_spendable_per_user_utc_day)
  values (now(), 1, 1, 1, 1)$$, '22023', 'a policy version effective now is refused');
select pg_temp.fails($$insert into rewards.reward_policy_versions (effective_from, spendable_per_visit, lifetime_first_daily, max_rewarded_per_location_day, max_spendable_per_user_utc_day)
  values ('$$ || :'eff' || $$', 1, 1, 1, 1)$$, '23505', 'two versions cannot share an effective time');
select pg_temp.fails('update rewards.reward_policy_versions set spendable_per_visit = 50', '42501', 'a policy version is immutable (UPDATE refused)');
select pg_temp.fails('delete from rewards.reward_policy_versions', '42501', 'a policy version cannot be deleted');
select pg_temp.fails('truncate rewards.reward_policy_versions', '42501,0A000', 'policy versions cannot be truncated');
select pg_temp.vo(:'eff'::timestamptz - interval '2 hours', :'up', :'lp', 'policy-before-0000001') as p1 \gset
select pg_temp.vo(:'eff'::timestamptz + interval '1 hour', :'up', :'lp', 'policy-after-00000001') as p2 \gset
select pg_temp.vo(:'eff'::timestamptz + interval '2 hours', :'up', :'lp', 'policy-after-00000002') as p3 \gset
select pg_temp.vo(:'eff'::timestamptz + interval '3 hours', :'up', :'lp', 'policy-after-00000003') as p4 \gset
select pg_temp.ok(:'p1' = 'awarded|awarded|5|5', 'before the transition the old version applies (5 / 5)');
select pg_temp.ok(:'p2' = 'awarded|not_first_daily|10|0', 'after the transition the new version applies to later visits (10 spendable) on the SAME local day');
select pg_temp.ok(:'p3' = 'location_cap|not_first_daily|0|0' and :'p4' = 'location_cap|not_first_daily|0|0', 'the lowered location cap (2) applies to later visits the same day (the old version would have allowed 4)');
select pg_temp.ok((select spendable from rewards.user_balances(:'up')) = 15 and (select lifetime from rewards.user_balances(:'up')) = 5,
                  'earlier awards are never clawed back by the new version');
select pg_temp.ok((select count(distinct policy_version_id) from rewards.visits where user_id = :'up') = 2, 'each visit records the policy version it used');
select pg_temp.ok((select spendable from rewards.reward_counters_user_day where user_id = :'up') = 15, 'the user counter carries across the transition');

-- ============================================================ idempotency
select pg_temp.mkuser(19) as ui \gset
select pg_temp.mkloc(47.0) as li \gset
select pg_temp.mkloc(47.1) as li2 \gset
select pg_temp.visit_at('2026-10-23 15:00:00+00', :'ui', :'li', 'idem-key-0000000001') as first \gset
select pg_temp.visit_at('2026-10-23 15:05:00+00', :'ui', :'li', 'idem-key-0000000001') as again \gset
select pg_temp.ok((:'first'::jsonb)->>'visit_id' = (:'again'::jsonb)->>'visit_id', 'a retry with the same key returns the same visit');
select pg_temp.ok((:'first'::jsonb)->>'replayed' = 'false' and (:'again'::jsonb)->>'replayed' = 'true', 'the retry is marked replayed');
select pg_temp.ok(pg_temp.oc(:'first'::jsonb) = pg_temp.oc(:'again'::jsonb) and pg_temp.oc(:'again'::jsonb) = 'awarded|awarded|5|5', 'the retry reports the same outcomes and points');
select pg_temp.ok((select count(*) from rewards.visits where user_id = :'ui') = 1 and (select count(*) from rewards.reward_ledger where user_id = :'ui') = 2
                  and (select spendable from rewards.reward_counters_user_day where user_id = :'ui') = 5, 'a retry never awards twice');
select pg_temp.fails($$select pg_temp.visit_at('2026-10-23 15:06:00+00', '$$ || :'ui' || $$', '$$ || :'li2' || $$', 'idem-key-0000000001')$$, '22023', 'the same key for a different restroom is refused');
select pg_temp.ok((select count(*) from rewards.visits where user_id = :'ui') = 1, 'the refused reuse wrote nothing');
-- the same key from another user is a different visit
select pg_temp.mkuser(20) as ui2 \gset
select pg_temp.visit_at('2026-10-23 15:00:00+00', :'ui2', :'li', 'idem-key-0000000001') as other \gset
select pg_temp.ok((:'other'::jsonb)->>'visit_id' <> (:'first'::jsonb)->>'visit_id' and (:'other'::jsonb)->>'replayed' = 'false', 'keys are scoped per user');

-- ============================================================ validation: the client sends only a location, coordinates, accuracy and a key
select pg_temp.mkuser(21) as uv \gset
select pg_temp.mkloc(48.0) as lv \gset
select pg_temp.mkloc(48.1) as lun \gset
update public.locations set status = 'candidate', restroom_evidence = 'inferred', restroom_verified = false where id = :'lun';
select pg_temp.as_user(:'uv');
select pg_temp.fails($$select rewards.record_visit_at(now(), '$$ || :'lv' || $$', 'NaN', -100, 'valid-key-000000001', null)$$, '22023', 'NaN latitude is refused');
select pg_temp.fails($$select rewards.record_visit_at(now(), '$$ || :'lv' || $$', 91, -100, 'valid-key-000000002', null)$$, '22023', 'latitude out of range is refused');
select pg_temp.fails($$select rewards.record_visit_at(now(), '$$ || :'lv' || $$', 48.0, 181, 'valid-key-000000003', null)$$, '22023', 'longitude out of range is refused');
select pg_temp.fails($$select rewards.record_visit_at(now(), '$$ || :'lv' || $$', 48.0, -100, 'short', null)$$, '22023', 'a short idempotency key is refused');
select pg_temp.fails($$select rewards.record_visit_at(now(), '$$ || :'lv' || $$', 48.0, -100, 'bad key with spaces!!', null)$$, '22023', 'an idempotency key with unsafe characters is refused');
select pg_temp.fails($$select rewards.record_visit_at(now(), '$$ || :'lv' || $$', 48.0, -100, 'valid-key-000000004', -5)$$, '22023', 'a negative accuracy is refused');
select pg_temp.fails($$select rewards.record_visit_at(now(), '$$ || :'lv' || $$', 48.0, -100, 'valid-key-000000005', 'NaN')$$, '22023', 'NaN accuracy is refused');
select pg_temp.fails($$select rewards.record_visit_at(null, '$$ || :'lv' || $$', 48.0, -100, 'valid-key-000000006', null)$$, '22023', 'a missing server time is refused');
select pg_temp.fails($$select rewards.record_visit_at(now(), '00000000-0000-0000-0000-00000000ffff', 48.0, -100, 'valid-key-000000007', null)$$, '22023', 'an unknown restroom is refused');
select pg_temp.fails($$select rewards.record_visit_at(now(), '$$ || :'lun' || $$', 48.1, -100, 'valid-key-000000008', null)$$, '22023', 'a restroom that is not public is refused');
select pg_temp.fails($$select rewards.record_visit_at(now(), '$$ || :'lv' || $$', 48.0016, -100, 'valid-key-000000009', null)$$, '22023', 'more than 150 m from the restroom is refused');
select pg_temp.ok((select count(*) from rewards.visits where user_id = :'uv') = 0, 'no refused request wrote a visit');
-- Distance buckets (the coordinates themselves are discarded) and accuracy buckets.
select pg_temp.visit_at('2026-10-24 15:00:00+00', :'uv', :'lv', 'bucket-key-000000001', 48.0, null) as x \gset
select pg_temp.visit_at('2026-10-24 15:01:00+00', :'uv', :'lv', 'bucket-key-000000002', 48.0007, 10) as x \gset
select pg_temp.visit_at('2026-10-24 15:02:00+00', :'uv', :'lv', 'bucket-key-000000003', 48.00125, 40) as x \gset
select pg_temp.visit_at('2026-10-24 15:03:00+00', :'uv', :'lv', 'bucket-key-000000004', 48.0, 80) as x \gset
select pg_temp.ok((select array_agg(distance_bucket order by occurred_at) from rewards.visits where user_id = :'uv') = array['within_50','within_100','within_150','within_50'], 'distance is stored only as a coarse bucket');
select pg_temp.ok((select array_agg(accuracy_bucket order by occurred_at) from rewards.visits where user_id = :'uv') = array[null,'within_25','within_50','over_50'], 'accuracy is optional and stored only as a bucket');
select pg_temp.ok((select array_agg(spendable_outcome order by occurred_at) from rewards.visits where user_id = :'uv') = array['awarded','awarded','awarded','awarded'], 'missing or poor accuracy never changes eligibility');
select pg_temp.finish();
