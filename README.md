# Boond website

Static site for **Boond** (salted sweet, by the drop) at boondsips.com.

## Layout

- `public/index.html` is the whole site. Plain static HTML, no build step.
- `wrangler.jsonc` tells Cloudflare to publish only the `public/` folder. Keep this README,
  CLAUDE.md and config files OUT of `public/`.
- The `name` in `wrangler.jsonc` (`boondsips`) must match the Worker's name in Cloudflare.

## Deploy (Cloudflare Workers with static assets, Git builds)

- Cloudflare builds this repo through its Git integration. A push to `main` deploys to production.
  Other branches get preview builds. Check the preview before merging anything bigger than a copy tweak.
- Cloudflare build settings:
  - Build command: **(blank)**
  - Deploy command: `npx wrangler deploy`
  - Production branch: `main`
- One deploy target only. Do not also connect this repo to Hostinger's Git deployment.

## Waitlist (live)

- The three forms (hero, story, join) post to a Supabase Edge Function, `boond-waitlist`
  (source: `supabase/functions/boond-waitlist/index.ts`). The function holds the database key
  inside Supabase, so **no key is ever on this site or in this repo**.
- Data lives in three locked-down tables (`boond_waitlist_signups`, `boond_flavor_votes`,
  `boond_stories`; schema in `supabase/migrations/`). Row-level security is on and the public roles
  have no access.
- `CONSENT_TEXT` in the function must match the consent text next to the checkboxes on the page.
- Unsubscribe page: `/unsubscribe/?t=<token>`. Each signup has an unsubscribe token in the database.
- Redeploy the function with the Supabase dashboard or CLI. It is not deployed by Cloudflare.

## Domain and email

- boondsips.com stays registered at Hostinger; its DNS (nameservers) points to Cloudflare.
- hello@boondsips.com is a Hostinger mailbox. Never delete or change the MX, SPF, DKIM or DMARC
  records, and keep them **DNS only** (grey cloud, not proxied).

## Secrets

Never commit API tokens, passwords or keys. Put them in Cloudflare
(Worker > Settings > Variables and Secrets) or in a local `.dev.vars` file, which is git-ignored.

## Before pushing

- Check the page at 400px wide and in both light and dark mode.
