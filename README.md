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
- Flavor vote and suggestions (the "Flavor vote" section on the home page): each browser gets an anonymous random
  voter id, so one browser has one vote per flavor and can take it back. The page shows live percentages once
  there are at least 10 votes. Suggestions go to the private `boond_flavor_suggestions` table with status
  `new`; they are never shown on the site. To read them with the sender email next to each one, open the
  views `boond_flavor_suggestions_inbox` and `boond_stories_inbox` in the Supabase Table Editor.
- Save your picks: the first vote on a visit opens a small "Save your picks" sheet (one email field, the same
  consent text). The sign-up is recorded with source `vote` and the browser's anonymous votes are attached to it,
  so the Supabase table shows who voted for what. The browser only remembers a "joined" flag
  (`boondJoined`), never the email, and "Use a different email" clears it. No magic link or password yet;
  that needs an email sending service.
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

## Welcome email

Joining counts immediately. A new signup gets one welcome email (where Boond is now, a vote button, links to Learn and Instagram, a reply line, and a one-tap unsubscribe), sent through Resend from hello@boondsips.com. It is sent at most once per address (`welcomed_at`) and at most `MAIL_DAILY_CAP` (default 60) per day. Joining again after unsubscribing puts the address back and sends the welcome email again. Supabase secrets: `RESEND_API_KEY`, `MAIL_TEST_TO` (until the postal address is set, mail goes only to this address), `BOOND_POSTAL_ADDRESS` (footer address; setting it opens sending to everyone). The checkbox wording lives in the site forms and in `CONSENT_TEXT` in the function; keep them identical.

## Sign in (magic link) and My Boond

Pages: `/signin/` (ask for a link), `/me/` (profile: picks, email setting, sign out, delete my data) and `/help/email/` (finding our emails). They are not linked from the home page yet.

How it works: `signin_request` emails a one-time link, `https://boondsips.com/me/#t=<token>`, to an address that is on the list and not unsubscribed. The token sits after the `#`, so it is never sent to a server or logged. `/me/` sends it once (`signin_redeem`), removes it from the address bar, and keeps a session token in the browser (`boondSession`, 30 days). Only SHA-256 hashes of both tokens are stored (`boond_login_tokens`, `boond_sessions`). A link works once and expires after 15 minutes. The answer to `signin_request` is the same whether or not the address is on the list. Limits: 3 sign-in emails per address per hour, and `MAIL_LOGIN_DAILY_CAP` (default 100) per day. Actions after sign-in: `me_get`, `me_update` (picks, kept in step with the person's votes), `me_prefs` (email on or off), `me_delete` (removes the signup, votes, and any linked story or flavor idea), `signout`.

## Shared shell for pages other than the home page

`public/shell.css` and `public/shell.js` hold the home page's own header, menu, footer, button and form styles (taken from `public/index.html`), so `/signin/`, `/me/` and `/help/email/` look the same as the home page. The "calmer" look (soft shadows, thinner borders, tighter spacing) is one block at the end of the home page's CSS and the same block in `shell.css`; change both together. The home page keeps its CSS inline.

## Sign in button, back-to-top button, and theme switch

The home page hero has a quiet **Sign in** button next to "Vote for a flavor" (it becomes **My Boond** in a browser that is signed in, `boondSession`). A floating **back-to-top** button (`#toTop`) appears after about 700px of scrolling. The **Auto / Light / Dark** switch lives in the menu and the footer on every page: Auto follows the phone or computer setting, Light and Dark are remembered (`boondTheme`), applied before first paint, and the footer follows the theme (yellow in Light, brown in Dark). On the home page this code is inline; on the other pages it is in `shell.js` and `shell.css`. Keep the two in step.
