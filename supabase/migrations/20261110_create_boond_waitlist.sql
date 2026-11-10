-- Boond pre-launch waitlist. Applied to the Foundeez Supabase project on 2026-11-10.
-- All tables are prefixed boond_ and locked down: RLS on, no policies, no
-- anon/authenticated grants. Only the server-side (service role) key used by
-- the Cloudflare function can read or write.

create table public.boond_waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 5 and 254 and position('@' in email) > 1),
  flavor_picks text[] not null default '{}',
  source text not null check (source in ('hero','story','join')),
  consent_text text not null,
  consented_at timestamptz not null default now(),
  unsubscribe_token uuid not null default gen_random_uuid(),
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint boond_flavor_picks_valid
    check (flavor_picks <@ array['cucumber','watermelon','mango','guava','plum','lemon']::text[])
);
create unique index boond_waitlist_signups_email_key on public.boond_waitlist_signups (lower(email));
create unique index boond_waitlist_signups_token_key on public.boond_waitlist_signups (unsubscribe_token);

create table public.boond_flavor_votes (
  id uuid primary key default gen_random_uuid(),
  flavor text not null check (flavor in ('cucumber','watermelon','mango','guava','plum','lemon')),
  signup_id uuid references public.boond_waitlist_signups(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index boond_flavor_votes_flavor_idx on public.boond_flavor_votes (flavor);

create table public.boond_stories (
  id uuid primary key default gen_random_uuid(),
  story text not null check (char_length(story) between 1 and 1000),
  signup_id uuid references public.boond_waitlist_signups(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.boond_waitlist_signups enable row level security;
alter table public.boond_flavor_votes enable row level security;
alter table public.boond_stories enable row level security;

revoke all on public.boond_waitlist_signups from anon, authenticated;
revoke all on public.boond_flavor_votes from anon, authenticated;
revoke all on public.boond_stories from anon, authenticated;
