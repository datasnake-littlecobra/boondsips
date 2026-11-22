-- The welcome email goes out once, right after the person confirms their address.
alter table public.boond_waitlist_signups
  add column if not exists welcomed_at timestamptz;
