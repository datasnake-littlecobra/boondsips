// Boond waitlist endpoint (Supabase Edge Function, public, verify_jwt = false).
// Actions: signup, vote, unvote, tally, suggest, story, unsubscribe. The service key is injected by
// Supabase at runtime and never leaves it. Tables are boond_* with RLS on.
//
// Secrets: RESEND_API_KEY, MAIL_TEST_TO (owner's inbox, used until the postal address is set), BOOND_POSTAL_ADDRESS.
//
// Keep CONSENT_TEXT identical to the text shown next to the checkboxes on the site.
import { createClient } from "npm:@supabase/supabase-js@2";

const FLAVORS = ["cucumber", "watermelon", "mango", "guava", "plum", "lemon"];
const SOURCES = ["hero", "story", "join", "suggest", "vote"];
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

function cleanVoter(v: unknown): string | null {
  return typeof v === "string" && UUID_RE.test(v) ? v.toLowerCase() : null;
}

// Attach this browser's anonymous votes to the signup, so the owner can see who voted for what.
async function linkVotes(signupId: string, voter: string | null) {
  if (!voter) return;
  const { error } = await db
    .from("boond_flavor_votes")
    .update({ signup_id: signupId })
    .eq("voter_token", voter)
    .is("signup_id", null);
  if (error) throw error;
}

// ---- Email (Resend). Sent from hello@boondsips.com. The key lives only in Supabase secrets. ----
const MAIL_FROM = "Boond <hello@boondsips.com>";
const MAIL_REPLY_TO = "hello@boondsips.com";
const SITE = "https://boondsips.com";

// Commercial email needs a postal address in the footer. Until BOOND_POSTAL_ADDRESS is set,
// mail goes only to MAIL_TEST_TO (the owner's own inbox), so no real signup gets an email early.
function mailAllowed(email: string): boolean {
  if (!Deno.env.get("RESEND_API_KEY")) return false;
  if (Deno.env.get("BOOND_POSTAL_ADDRESS")) return true;
  const test = (Deno.env.get("MAIL_TEST_TO") ?? "").trim().toLowerCase();
  return test !== "" && test === email;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function welcomeMail(unsubUrl: string) {
  const address = Deno.env.get("BOOND_POSTAL_ADDRESS") ?? "";
  const voteUrl = `${SITE}/#vote`;
  const text = [
    "Thanks for joining the Boond list.",
    "",
    "Boond is a salty-sweet drink we're still testing. It isn't for sale yet.",
    "",
    "What to expect: a few emails about the taste test and the launch.",
    "",
    "Help us decide what to make first:",
    voteUrl,
    "",
    "Have a question, or a food memory that tastes like home? Just reply to this email. It goes to a real inbox.",
    "",
    "salty sweet, by the drop",
    "Boond",
    "",
    "--",
    "You got this because you joined the Boond list at boondsips.com.",
    `Unsubscribe: ${unsubUrl}`,
    address,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#FFF2D6;">
<div style="max-width:520px;margin:0 auto;padding:28px 20px;font-family:Arial,Helvetica,sans-serif;color:#3A2A16;font-size:16px;line-height:1.5;">
<div style="font-size:30px;font-weight:700;color:#FF8A1F;">Boond</div>
<p style="margin:18px 0 0;"><strong>Thanks for joining the list.</strong></p>
<p>Boond is a salty-sweet drink we're still testing. It isn't for sale yet.</p>
<p>What to expect: a few emails about the taste test and the launch.</p>
<p><a href="${voteUrl}" style="display:inline-block;background:#FF8A1F;color:#3A2A16;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:999px;">Vote for a flavor</a></p>
<p>Have a question, or a food memory that tastes like home? Just reply to this email. It goes to a real inbox.</p>
<p style="margin-top:24px;">salty sweet, by the drop<br><strong>Boond</strong></p>
<hr style="border:none;border-top:1px solid #3A2A1633;margin:28px 0 14px;">
<p style="font-size:12px;color:#3A2A16b3;margin:0;">You got this because you joined the Boond list at boondsips.com.
<a href="${unsubUrl}" style="color:#3A2A16;">Unsubscribe</a><br>${esc(address)}</p>
</div></body></html>`;
  return { subject: "You're on the Boond list", text, html };
}

async function sendMail(to: string, mail: { subject: string; text: string; html: string }, unsubUrl: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [to],
      reply_to: MAIL_REPLY_TO,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      headers: { "List-Unsubscribe": `<${unsubUrl}>, <mailto:${MAIL_REPLY_TO}?subject=unsubscribe>` },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`resend_${res.status}`);
}

// Send the welcome email once per signup. Never lets an email problem fail the signup itself.
async function sendWelcome(signupId: string, email: string) {
  try {
    if (!mailAllowed(email)) return;
    // Claim the send first, so two quick requests cannot both send.
    const { data: claimed, error } = await db
      .from("boond_waitlist_signups")
      .update({ welcome_sent_at: new Date().toISOString() })
      .eq("id", signupId)
      .is("welcome_sent_at", null)
      .is("unsubscribed_at", null)
      .select("unsubscribe_token");
    if (error || !claimed || claimed.length === 0) return;
    const unsubUrl = `${SITE}/unsubscribe/?t=${claimed[0].unsubscribe_token}`;
    try {
      await sendMail(email, welcomeMail(unsubUrl), unsubUrl);
    } catch (e) {
      await db.from("boond_waitlist_signups").update({ welcome_sent_at: null }).eq("id", signupId);
      throw e;
    }
  } catch (e) {
    console.error("boond-waitlist mail error:", e instanceof Error ? e.message : "unknown");
  }
}

// Emails are always stored lowercase, so equality is safe (and a unique index backs it).
async function upsertSignup(email: string, flavors: string[], source: string, voter: string | null = null): Promise<string> {
  const id = await upsertSignupRow(email, flavors, source);
  await linkVotes(id, voter);
  await sendWelcome(id, email);
  return id;
}

async function upsertSignupRow(email: string, flavors: string[], source: string): Promise<string> {
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
        await upsertSignup(email, cleanFlavors(body.flavors), source, cleanVoter(body.voter));
        return json({ ok: true }, 200, cors); // same answer whether or not the email existed
      }

      case "vote": {
        if (typeof body.flavor !== "string" || !FLAVORS.includes(body.flavor)) {
          return json({ error: "invalid_flavor" }, 400, cors);
        }
        const voter = typeof body.voter === "string" && UUID_RE.test(body.voter) ? body.voter.toLowerCase() : null;
        if (await tooMany("boond_flavor_votes", 60)) return json({ error: "busy" }, 429, cors);
        if (voter) {
          // one anonymous vote per browser per flavor; repeats change nothing
          const { data: linked, error: lerr } = await db
            .from("boond_flavor_votes")
            .select("signup_id")
            .eq("voter_token", voter)
            .not("signup_id", "is", null)
            .limit(1);
          if (lerr) throw lerr;
          const { error } = await db
            .from("boond_flavor_votes")
            .upsert(
              { flavor: body.flavor, voter_token: voter, signup_id: linked?.[0]?.signup_id ?? null },
              { onConflict: "voter_token,flavor", ignoreDuplicates: true },
            );
          if (error) throw error;
        } else {
          const { error } = await db.from("boond_flavor_votes").insert({ flavor: body.flavor });
          if (error) throw error;
        }
        return json({ ok: true }, 200, cors);
      }

      case "unvote": {
        if (typeof body.flavor !== "string" || !FLAVORS.includes(body.flavor)) {
          return json({ error: "invalid_flavor" }, 400, cors);
        }
        if (typeof body.voter !== "string" || !UUID_RE.test(body.voter)) return json({ error: "invalid_voter" }, 400, cors);
        const { error } = await db
          .from("boond_flavor_votes")
          .delete()
          .eq("voter_token", body.voter.toLowerCase())
          .eq("flavor", body.flavor);
        if (error) throw error;
        return json({ ok: true }, 200, cors);
      }

      case "tally": {
        const { data, error } = await db.rpc("boond_flavor_tally");
        if (error) throw error;
        const tally: Record<string, number> = {};
        for (const f of FLAVORS) tally[f] = 0;
        for (const row of (data ?? []) as { flavor: string; votes: number }[]) {
          if (FLAVORS.includes(row.flavor)) tally[row.flavor] = Number(row.votes);
        }
        const total = Object.values(tally).reduce((a, b) => a + b, 0);
        return json({ ok: true, tally, total }, 200, cors);
      }

      case "suggest": {
        const text = typeof body.suggestion === "string" ? body.suggestion.replace(/\s+/g, " ").trim() : "";
        if (text.length < 2 || text.length > 60) return json({ error: "invalid_suggestion" }, 400, cors);
        if (/https?:|www\.|@|<|>/i.test(text)) return json({ error: "invalid_suggestion" }, 400, cors);
        if (await tooMany("boond_flavor_suggestions", 20)) return json({ error: "busy" }, 429, cors);
        let signupId: string | null = null;
        const rawEmail = typeof body.email === "string" ? body.email.trim() : "";
        if (rawEmail !== "") {
          const email = cleanEmail(rawEmail);
          if (!email) return json({ error: "invalid_email" }, 400, cors);
          if (body.consent !== true) return json({ error: "consent_required" }, 400, cors);
          signupId = await upsertSignup(email, [], "suggest", cleanVoter(body.voter));
        }
        const { error } = await db.from("boond_flavor_suggestions").insert({ suggestion: text, signup_id: signupId });
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
          signupId = await upsertSignup(email, [], "story", cleanVoter(body.voter));
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
