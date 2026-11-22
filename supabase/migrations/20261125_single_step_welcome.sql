-- The welcome email now goes out at signup (no confirm step), tracked by welcomed_at.
-- The earlier confirmed_at, confirm_token and welcome_sent_at columns are no longer used by the function.
-- They are left in place on purpose (harmless, nothing reads them); drop them later if you want a tidy table.
alter table public.boond_waitlist_signups add column if not exists welcomed_at timestamptz;
