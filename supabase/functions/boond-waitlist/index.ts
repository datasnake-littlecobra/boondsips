// Boond waitlist endpoint (Supabase Edge Function, public, verify_jwt = false).
// Actions: signup, vote, story, unsubscribe. The service key is injected by
// Supabase at runtime and never leaves it. Tables are boond_* with RLS on.
//
// Keep CONSENT_TEXT identical to the text shown next to the checkboxes on the site.
import { createClient } from "npm:@supabase/supabase-js@2";

const FLAVORS = ["cucumber", "watermelon", "mango", "guava", "plum", "lemon"];
const SOURCES = ["hero", "story", "join"];
const CONSENT_TEXT =
  "I agree to get emails from Boond about the taste test and launch. I can unsubscribe anytime with the link in any email or by writing to hello@boondsips.com.";

// Soft anti-abuse only (browsers send Origin; scripts can fake it).
const ALLOWED_ORIGINS = [
  /^https:\/\/(www\.)?boondsips\.com$/,
  /^https:\/\/([a-z0-9-]+-)?boondsips\.[a-z0-9-]+\.workers\.dev$/,
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// Global flood guard: refuse when too many rows were created in the last minute.
async function tooMany(table: string, limit: number): Promise<boolean> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await db
    .from(table)
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if (error) throw error;
  return (count ?? 0) >= limit;
}

function cleanEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length >= 5 && e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

function cleanFlavors(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x) => typeof x === "string" && FLAVORS.includes(x)))];
}

// Emails are always stored lowercase, so equality is safe (and a unique index backs it).
async function upsertSignup(email: string, flavors: string[], source: string): Promise<string> {
  const now = new Date().toISOString();
  const find = () =>
    db.from("boond_waitlist_signups").select("id, flavor_picks").eq("email", email).maybeSingle();

  let { data: existing, error } = await find();
  if (error) throw error;

  if (!existing) {
    const ins = await db
      .from("boond_waitlist_signups")
      .insert({ email, flavor_picks: flavors, source, consent_text: CONSENT_TEXT, consented_at: now })
      .select("id")
      .single();
    if (!ins.error) return ins.data.id;
    if (ins.error.code !== "23505") throw ins.error; // not a duplicate: real error
    ({ data: existing, error } = await find()); // lost a race: fall through to update
    if (error || !existing) throw error ?? new Error("signup_not_found");
  }

  const merged = [...new Set([...(existing.flavor_picks ?? []), ...flavors])];
  const upd = await db
    .from("boond_waitlist_signups")
    .update({
      flavor_picks: merged,
      unsubscribed_at: null,
      consent_text: CONSENT_TEXT,
      consented_at: now,
    })
    .eq("id", existing.id);
  if (upd.error) throw upd.error;
  return existing.id;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  const allowed = ALLOWED_ORIGINS.some((r) => r.test(origin));
  const cors: Record<string, string> = allowed
    ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    }
    : {};

  if (req.method === "OPTIONS") return new Response(null, { status: allowed ? 204 : 403, headers: cors });
  if (!allowed) return json({ error: "forbidden" }, 403, cors);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
  if (Number(req.headers.get("content-length") ?? 0) > 6000) return json({ error: "too_large" }, 413, cors);

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("bad");
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "bad_request" }, 400, cors);
  }

  // Honeypot: real people never fill this hidden field. Pretend success.
  if (typeof body.website === "string" && body.website.trim() !== "") return json({ ok: true }, 200, cors);

  try {
    switch (body.action) {
      case "signup": {
        const email = cleanEmail(body.email);
        if (!email) return json({ error: "invalid_email" }, 400, cors);
        if (body.consent !== true) return json({ error: "consent_required" }, 400, cors);
        const source = typeof body.source === "string" && SOURCES.includes(body.source) ? body.source : "join";
        if (await tooMany("boond_waitlist_signups", 20)) return json({ error: "busy" }, 429, cors);
        await upsertSignup(email, cleanFlavors(body.flavors), source);
        return json({ ok: true }, 200, cors); // same answer whether or not the email existed
      }

      case "vote": {
        if (typeof body.flavor !== "string" || !FLAVORS.includes(body.flavor)) {
          return json({ error: "invalid_flavor" }, 400, cors);
        }
        if (await tooMany("boond_flavor_votes", 60)) return json({ error: "busy" }, 429, cors);
        const { error } = await db.from("boond_flavor_votes").insert({ flavor: body.flavor });
        if (error) throw error;
        return json({ ok: true }, 200, cors);
      }

      case "story": {
        const story = typeof body.story === "string" ? body.story.trim() : "";
        if (story.length < 1 || story.length > 1000) return json({ error: "invalid_story" }, 400, cors);
        if (await tooMany("boond_stories", 20)) return json({ error: "busy" }, 429, cors);
        let signupId: string | null = null;
        const rawEmail = typeof body.email === "string" ? body.email.trim() : "";
        if (rawEmail !== "") {
          const email = cleanEmail(rawEmail);
          if (!email) return json({ error: "invalid_email" }, 400, cors);
          if (body.consent !== true) return json({ error: "consent_required" }, 400, cors);
          signupId = await upsertSignup(email, [], "story");
        }
        const { error } = await db.from("boond_stories").insert({ story, signup_id: signupId });
        if (error) throw error;
        return json({ ok: true }, 200, cors);
      }

      case "unsubscribe": {
        const token = typeof body.token === "string" ? body.token.trim() : "";
        if (!UUID_RE.test(token)) return json({ error: "invalid_token" }, 400, cors);
        const { error } = await db
          .from("boond_waitlist_signups")
          .update({ unsubscribed_at: new Date().toISOString() })
          .eq("unsubscribe_token", token)
          .is("unsubscribed_at", null);
        if (error) throw error;
        return json({ ok: true }, 200, cors); // same answer for unknown tokens
      }

      default:
        return json({ error: "unknown_action" }, 400, cors);
    }
  } catch (e) {
    console.error("boond-waitlist error:", e instanceof Error ? e.message : "unknown");
    return json({ error: "server_error" }, 500, cors);
  }
});
