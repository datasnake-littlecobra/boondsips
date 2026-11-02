# Boond website

Static site for **Boond** (salted sweet, by the drop) at boondsips.com.

## Layout

- `index.html` at the repo root is the whole site. Plain static HTML, no build step.
- `functions/` (added later) will hold Cloudflare Pages Functions for the waitlist and flavor vote.

## Deploy (Cloudflare Pages, Git integration)

- Hosting is Cloudflare Pages, connected to this repo through Cloudflare's Git integration.
- A push to `main` deploys to production (`<project>.pages.dev`, later boondsips.com).
- Any other branch or pull request gets its own preview URL. Check the preview before merging.
- Build settings in Cloudflare:
  - Framework preset: **None**
  - Build command: **(leave blank)**
  - Build output directory: **/** (repo root)
  - Production branch: **main**
- There is exactly one deploy target. Do not also connect this repo to Hostinger's Git deployment.

## Domain and email

- boondsips.com is registered at Hostinger; DNS is moving to Cloudflare.
- hello@boondsips.com is a Hostinger mailbox. When DNS moves, keep the MX, SPF, DKIM and DMARC
  records exactly as they are and leave them **DNS only** (grey cloud, not proxied).

## Secrets

Never commit API tokens, passwords or keys. Put them in Cloudflare
(Pages project > Settings > Variables and Secrets) or in a local `.dev.vars` file, which is git-ignored.

## Before pushing

- Check the page at 400px wide and in both light and dark mode.
- Use a branch and pull request for anything bigger than a copy tweak.
