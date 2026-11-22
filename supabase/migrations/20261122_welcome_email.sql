-- Track whether the welcome email was sent, so a signup gets it at most once.
alter table public.boond_waitlist_signups
  add column if not exists welcome_sent_at timestamptz;
