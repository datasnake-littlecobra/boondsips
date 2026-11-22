-- Double opt-in: a signup counts as "on the list" only after the person taps the confirm link.
-- welcome_sent_at (from the previous migration) now records when the confirmation email was last sent.
alter table public.boond_waitlist_signups
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirm_token uuid not null default gen_random_uuid();

create unique index if not exists boond_waitlist_signups_confirm_token_key
  on public.boond_waitlist_signups (confirm_token);
