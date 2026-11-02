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

## Domain and email

- boondsips.com stays registered at Hostinger; its DNS (nameservers) points to Cloudflare.
- hello@boondsips.com is a Hostinger mailbox. Never delete or change the MX, SPF, DKIM or DMARC
  records, and keep them **DNS only** (grey cloud, not proxied).

## Secrets

Never commit API tokens, passwords or keys. Put them in Cloudflare
(Worker > Settings > Variables and Secrets) or in a local `.dev.vars` file, which is git-ignored.

## Before pushing

- Check the page at 400px wide and in both light and dark mode.
