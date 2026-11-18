-- Applied to the Foundeez Supabase project on 2026-11-18.
-- Readable inboxes for the owner: the same rows as the tables, with the email shown instead of an id.
-- security_invoker so they follow the table permissions; no access for the public roles.
create or replace view public.boond_flavor_suggestions_inbox with (security_invoker = true) as
select s.created_at, s.status, s.suggestion, g.email, g.unsubscribed_at is not null as unsubscribed, s.id
from public.boond_flavor_suggestions s
left join public.boond_waitlist_signups g on g.id = s.signup_id
order by s.created_at desc;

create or replace view public.boond_stories_inbox with (security_invoker = true) as
select t.created_at, t.story, g.email, g.unsubscribed_at is not null as unsubscribed, t.id
from public.boond_stories t
left join public.boond_waitlist_signups g on g.id = t.signup_id
order by t.created_at desc;

revoke all on public.boond_flavor_suggestions_inbox from public, anon, authenticated;
revoke all on public.boond_stories_inbox from public, anon, authenticated;
