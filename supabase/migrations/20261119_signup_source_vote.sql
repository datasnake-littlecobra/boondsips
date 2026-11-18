-- Applied to the Foundeez Supabase project on 2026-11-19.
alter table public.boond_waitlist_signups drop constraint if exists boond_waitlist_signups_source_check;
alter table public.boond_waitlist_signups add constraint boond_waitlist_signups_source_check check (source in ('hero','story','join','suggest','vote'));
create index if not exists boond_flavor_votes_signup_idx on public.boond_flavor_votes (signup_id);
