-- Additive review fields: data separation, repeat identities, and transaction safety.
\set ON_ERROR_STOP on
set role service_role;
do $$
declare lid uuid; result jsonb; before_count integer; answers jsonb;
begin
  insert into public.locations(name,latitude,longitude,status,restroom_evidence,purchase_required)
    values ('DETAILS synthetic',71,71,'unverified','explicit',false) returning id into lid;
  answers := jsonb_build_object('customers_only',true,'family_bathroom',true,'hot_water',true,'cold_water',true,
    'restroom_type','women','rating',4,'cleanliness_score',3,'public_comment',E'Useful restroom.\nSecond line.',
    'notes','Private note stays private','cleaning_log',true,
    'conditions',jsonb_build_object('seats','clean','mirrors','missing','stall_doors','broken','toilet_paper','out','floor','dirty'));
  result := public.apply_location_review_v2(lid,'Jake','local-admin','exists',true,current_date,answers);
  assert (select customers_only and family_bathroom and has_hot_water and has_cold_water and not purchase_required
    and status = 'verified' and rating_count = 1 and average_rating = 4 from public.locations where id = lid), 'independent facts, family and both water types';
  assert (select restroom_type = 'women' and rating = 4 and cleanliness_score = 3 and reviewer_kind = 'admin'
    and notes = 'Private note stays private' and public_comment = E'Useful restroom.\nSecond line.'
    and conditions->>'mirrors' = 'missing' and conditions->>'toilet_paper' = 'out'
    from public.location_reviews where id = (result->>'review_id')::uuid), 'typed visit, condition and comment history';
  -- Same identity and a different display alias still contribute only one rating.
  result := public.apply_location_review_v2(lid,'Different alias','local-admin','exists',true,current_date - 2,answers || '{"rating":1,"public_comment":null}');
  assert (select rating_count = 1 and average_rating = 4 and last_verified_at::date = current_date from public.locations where id = lid), 'old reconfirmation does not inflate users or move recency backwards';
  assert (select count(*) = 2 and count(distinct reviewer_identity) = 1 from public.location_reviews where location_id = lid), 'two confirmations from one identity';
  result := public.apply_location_review_v2(lid,'Other admin','other-admin','exists',true,current_date,answers || '{"rating":2}');
  assert (select rating_count = 2 and average_rating = 3 from public.locations where id = lid), 'one rating per distinct identity';
  result := public.apply_location_review_v2(lid,'New alias again','local-admin','exists',true,current_date,answers || '{"rating":5}');
  assert (select rating_count = 2 and average_rating = 3.5 from public.locations where id = lid), 'latest same-day rating replaces the earlier rating from that identity';
  select count(*) into before_count from public.location_reviews where location_id = lid;
  begin
    perform public.apply_location_review_v2(lid,'Jake','local-admin','exists',true,current_date,answers || '{"rating":6}');
    raise exception 'invalid rating accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.apply_location_review_v2(lid,'Jake','local-admin','exists',true,current_date,answers || '{"conditions":{"floor":"sparkling"}}');
    raise exception 'invalid condition accepted';
  exception when sqlstate '22023' then null; end;
  assert (select count(*) = before_count from public.location_reviews where location_id = lid), 'rejected review adds nothing';
  -- A plain legacy review never becomes a public comment.
  result := public.apply_location_review(lid,'Legacy','unsure','unknown',null,null,null,null,null,'Old private note',false,null);
  assert (select public_comment is null and notes = 'Old private note' from public.location_reviews where id = (result->>'review_id')::uuid), 'legacy private note never published';
end $$;
reset role;
do $$ declare r text; begin
  foreach r in array array['anon','authenticated'] loop
    execute format('set local role %I',r);
    begin
      perform public.apply_location_review_v2(gen_random_uuid(),'x','x','exists',false,null,'{}');
      raise exception 'public client can write visit details';
    exception when insufficient_privilege then null; end;
    begin perform count(*) from public.location_reviews; raise exception 'public client can read private reviews';
    exception when insufficient_privilege then null; end;
    reset role;
  end loop;
end $$;
\echo review_visit_details: OK
