# Boond site: project rules

Boond is a US powder drink-stick brand (salty-sweet, "hydration with fiber"). This repo is its website. The owner is Prabhakar (Founder, Boond). The company's legal name is NOT stored in this file because the repo is public: ask the owner, and confirm the exact legal name before it appears anywhere public.

## Hosting and deploy

- Hosting: Cloudflare Workers with static assets, built from this GitHub repo by Cloudflare's Git builds. Build command is blank, deploy command is `npx wrangler deploy`. A push to `main` deploys to production. Other branches get preview builds.
- Domain: boondsips.com, registered at Hostinger. DNS is moving to Cloudflare.
- Email: hello@boondsips.com is a Hostinger mailbox. NEVER delete or change the MX, SPF, DKIM or DMARC records. Mail records must stay "DNS only" (not proxied).
- Do not connect this repo to Hostinger's Git deployment. There must be one deploy target.
- Never put API tokens, passwords or keys in the repo, in commits, or in chat. Secrets go in Cloudflare environment settings or local environment variables. Ask the owner to do any browser sign-in or authorization step.
- Site is plain static HTML in `public/index.html`. `wrangler.jsonc` at the repo root points the assets directory at `./public`, so only the contents of `public/` are published. Keep CLAUDE.md, README and config files OUT of `public/`. The `name` in `wrangler.jsonc` must match the project name chosen in Cloudflare. No build step.

## Brand

- Name: Boond (not "Boond Sips"). "sips" appears only in the domain and handle (boondsips.com, @boondsips).
- Tagline: "salted sweet, by the drop". Descriptor: "hydration with fiber".
- Colors: cream #FFF2D6, brown #3A2A16, orange #FF8A1F, teal #14B5B0, pink #FF7DA0, green #3FBF7A. Flavors: lemon #FFD23F, mango #FF8A1F, watermelon #FF4F7E, plum #7A3FB8, guava #FF9DB0, cucumber mint #3FBF7A.
- Fonts: Fredoka (wordmark, numbers), Nunito (everything else).
- Six flavors: lemon, mango, watermelon, plum, guava, cucumber mint.

## Content rules (these are standing rules, do not relax them)

- No health claims, stated or implied: no gut, digestion, immunity, energy, recovery, detox, "healthy", "prebiotic".
- Never use the word "gentle" in public copy.
- No marketing to children and no children in images.
- Per-stick numbers (4 g fiber, 4 g sugar, about 200 mg sodium, about 100 mg potassium, about 25 calories) are TARGETS, not final. Keep the "targets, not final" wording wherever they appear.
- The product is not for sale yet. Call to action is "join the waitlist", never "buy".
- Cite sources for any factual claim; link them.
- Only use facts and links from sources someone has actually opened. Unverified links stay out of the page.
- Never use another company's trademark in our copy (say "chile-lime", not a brand name).
- Public repo: no marketing plans, outreach lists, prompts or personal data in this repo. Keep those in private documents.

## Waitlist

- The three forms on the page (heroForm, storyForm, joinForm) are design mocks that save nothing. Replace them with a real signup before the QR code on the flyer is shared.
- Collect only what is needed: email, optional flavor picks, optional story. Show clear consent text and say how to unsubscribe. Ask the owner before choosing where data is stored.
- Page copy that says "This is a design mock" must be removed when the real signup goes live.

## Working agreement

- Make small commits with clear messages. Use a branch and a pull request for anything larger than a copy tweak, and check the preview URL before merging.
- Check the page at 400px width and in light and dark mode before pushing.
