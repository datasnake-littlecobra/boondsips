# Boond website

Static site for **Boond** (salty sweet, by the drop) at boondsips.com.

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

## Learn section

- `/learn/` is the hub, `/learn/marketing/` is the course index, and `/learn/marketing/module-N/` are the module pages.
- The hub and the course index are drawn from one data file each: `public/learn/content.js` and
  `public/learn/marketing/modules.js`. Adding content never needs a layout edit.
- Shared files: `public/learn/learn.css`, `public/learn/learn.js`, and `public/learn/config.js`
  (`donateUrl` is empty by default, which hides the donate link).
- **Add a module:** put its page at `public/learn/marketing/module-N/index.html`, then change that module's
  `status` to `"live"` in `modules.js`. Wrap a new module page the way `module-1` is wrapped: the `bn-` header,
  the "All modules" back link and the `bn-` footer (their styles are inside the page, prefixed `bn-` so they never
  clash with the module's own styles), and `<script src="../../config.js"></script>` before the module's script.
  Keep the module's own content and its OpenStax credit as they are.
- No analytics, cookies or third-party scripts. The only outside request is the Google Fonts stylesheet,
  the same as the main page.

## Demo pages

- `/demo-home/` previews the dark "Rind & Salt" look with the same content as the home page, plus a light/dark
  switch and a concept render of the stick packs. It is not linked from anywhere, it is `noindex`, and its forms
  are switched off (nothing is sent or saved). Delete the folder once a look is chosen.

## Tests

```
cd tests
npm install
npx playwright install chromium
npm test
```

The test starts its own local server for `public/`, so nothing is deployed. To use a browser you already have,
set `CHROMIUM_PATH=/path/to/chrome`. The `tests/` folder has its own `package.json` so the site deploy never
installs anything.

## Domain and email

- boondsips.com stays registered at Hostinger; its DNS (nameservers) points to Cloudflare.
- hello@boondsips.com is a Hostinger mailbox. Never delete or change the MX, SPF, DKIM or DMARC
  records, and keep them **DNS only** (grey cloud, not proxied).

## Secrets

Never commit API tokens, passwords or keys. Put them in Cloudflare
(Worker > Settings > Variables and Secrets) or in a local `.dev.vars` file, which is git-ignored.

## Before pushing

- Check the page at 400px wide and in both light and dark mode.
