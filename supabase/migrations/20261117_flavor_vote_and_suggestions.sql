-- Applied to the Foundeez Supabase project on 2026-11-17.
-- One anonymous vote per browser per flavor, and a private inbox for flavor suggestions.
alter table public.boond_flavor_votes add column if not exists voter_token uuid;
create unique index if not exists boond_flavor_votes_voter_flavor_key on public.boond_flavor_votes (voter_token, flavor);

create table if not exists public.boond_flavor_suggestions (
  id uuid primary key default gen_random_uuid(),
  suggestion text not null check (char_length(suggestion) between 2 and 60),
  signup_id uuid references public.boond_waitlist_signups(id) on delete set null,
  status text not null default 'new' check (status in ('new','reviewed','added','declined')),
  created_at timestamptz not null default now()
);
alter table public.boond_flavor_suggestions enable row level security;
revoke all on public.boond_flavor_suggestions from anon, authenticated;

alter table public.boond_waitlist_signups drop constraint if exists boond_waitlist_signups_source_check;
alter table public.boond_waitlist_signups add constraint boond_waitlist_signups_source_check check (source in ('hero','story','join','suggest'));

create or replace function public.boond_flavor_tally()
returns table(flavor text, votes bigint)
language sql stable set search_path = public
as $$ select v.flavor, count(*)::bigint from public.boond_flavor_votes v group by v.flavor $$;
revoke all on function public.boond_flavor_tally() from public, anon, authenticated;
grant execute on function public.boond_flavor_tally() to service_role;
