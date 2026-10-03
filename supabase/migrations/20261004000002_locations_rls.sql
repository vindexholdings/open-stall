-- OS-102: RLS and least-privilege grants for locations.
-- Public (anon/authenticated) can read ONLY verified locations. All writes are denied
-- to client roles; privileged writes happen server-side (service role / admin functions).

alter table public.locations enable row level security;
alter table public.locations force row level security;

revoke all on table public.locations from public, anon, authenticated;
grant select on table public.locations to anon, authenticated;

create policy "Public can read verified locations"
  on public.locations
  for select
  to anon, authenticated
  using (status = 'verified' and restroom_verified);

-- No insert/update/delete policies for anon/authenticated: default deny.

revoke all on function public.set_updated_at() from public, anon, authenticated;
