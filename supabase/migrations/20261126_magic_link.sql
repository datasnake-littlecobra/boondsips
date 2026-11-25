-- Passwordless sign-in ("magic link") for the Boond list.
-- Only SHA-256 hashes of the one-time link token and of the session token are stored,
-- so a database leak does not expose usable links. RLS on, no public access.

create table public.boond_login_tokens (
  id uuid primary key default gen_random_uuid(),
  signup_id uuid not null references public.boond_waitlist_signups(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index boond_login_tokens_signup_idx on public.boond_login_tokens (signup_id, created_at desc);
create index boond_login_tokens_created_idx on public.boond_login_tokens (created_at);

create table public.boond_sessions (
  id uuid primary key default gen_random_uuid(),
  signup_id uuid not null references public.boond_waitlist_signups(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz
);
create index boond_sessions_signup_idx on public.boond_sessions (signup_id);

alter table public.boond_login_tokens enable row level security;
alter table public.boond_sessions enable row level security;
revoke all on public.boond_login_tokens from anon, authenticated;
revoke all on public.boond_sessions from anon, authenticated;
