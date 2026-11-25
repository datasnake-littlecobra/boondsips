// Boond waitlist endpoint (Supabase Edge Function, public, verify_jwt = false).
// Actions: signup, vote, unvote, tally, suggest, story, unsubscribe,
// signin_request, signin_redeem, me_get, me_update, me_prefs, me_delete, signout (passwordless sign-in). The service key is injected by
// Supabase at runtime and never leaves it. Tables are boond_* with RLS on.
//
// Secrets: RESEND_API_KEY, MAIL_TEST_TO (owner's inbox, used until the postal address is set), BOOND_POSTAL_ADDRESS.
//
// Keep CONSENT_TEXT identical to the text shown next to the checkboxes on the site.
import { createClient } from "npm:@supabase/supabase-js@2";

const FLAVORS = ["cucumber", "watermelon", "mango", "guava", "plum", "lemon"];
const SOURCES = ["hero", "story", "join", "suggest", "vote"];
const CONSENT_TEXT =
  "I agree to get emails from Boond: taste test updates, launch news and our newsletter. I can unsubscribe anytime with the link in any email or by writing to hello@boondsips.com.";

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

// ---- Passwordless sign-in. Only SHA-256 hashes of tokens are stored. ----
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const LOGIN_TTL_MS = 15 * 60_000;                 // a sign-in link works once, for 15 minutes
const SESSION_TTL_MS = 30 * 24 * 3600_000;        // a signed-in browser stays signed in for 30 days
const LOGIN_HOURLY_PER_PERSON = 3;                // sign-in emails per address per hour
const LOGIN_DAILY_CAP = Number(Deno.env.get("MAIL_LOGIN_DAILY_CAP") ?? "100");

async function sha256Hex(v: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Returns the signup id for a valid, unexpired session token, otherwise null.
async function sessionFor(token: unknown): Promise<string | null> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const { data, error } = await db
    .from("boond_sessions")
    .select("id, signup_id, expires_at")
    .eq("token_hash", await sha256Hex(token))
    .maybeSingle();
  if (error) throw error;
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return null;
  await db.from("boond_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  return data.signup_id as string;
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
function mailGate(email: string): "ok" | "no_key" | "test_only" {
  if (!Deno.env.get("RESEND_API_KEY")) return "no_key";
  if (Deno.env.get("BOOND_POSTAL_ADDRESS")) return "ok";
  const test = (Deno.env.get("MAIL_TEST_TO") ?? "").trim().toLowerCase();
  return test !== "" && test === email ? "ok" : "test_only";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function welcomeMail(unsubUrl: string) {
  const address = Deno.env.get("BOOND_POSTAL_ADDRESS") ?? "";
  const voteUrl = `${SITE}/#vote`;
  const learnUrl = `${SITE}/learn/`;
  const igUrl = "https://www.instagram.com/boondsips/";
  const text = [
    "Thanks for joining the Boond list.",
    "",
    "Boond is a salty-sweet drink we're still testing. It isn't for sale yet.",
    "",
    "WHERE WE ARE",
    "We're in our taste validation phase. We're deciding which flavors to make first, and your vote helps decide.",
    `Vote for a flavor: ${voteUrl}`,
    "",
    "WHAT'S NEXT",
    "More taste tests, then launch news. You'll get progress notes and launch news in your inbox.",
    "",
    "WHILE YOU WAIT",
    `Learn: free lessons from building Boond in public: ${learnUrl}`,
    `Instagram: @boondsips: ${igUrl}`,
    "",
    "Have a question, or a food memory that tastes like home? Just reply to this email. It goes to a real inbox.",
    "",
    "salty sweet, by the drop",
    "Boond",
    "",
    "--",
    "You got this because you joined the Boond list at boondsips.com. If that wasn't you, unsubscribe in one tap.",
    `Unsubscribe: ${unsubUrl}`,
    `Landed in spam or Promotions? Here is how to fix it: ${SITE}/help/email/`,
    address,
  ].join("\n");
  const h = (t: string) => `<p style="margin:22px 0 4px;font-size:12px;letter-spacing:.08em;font-weight:700;color:#3A2A16b3;">${t}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#FFF2D6;">
<div style="max-width:520px;margin:0 auto;padding:28px 20px;font-family:Arial,Helvetica,sans-serif;color:#3A2A16;font-size:16px;line-height:1.5;">
<div style="font-size:30px;font-weight:700;color:#FF8A1F;">Boond</div>
<p style="margin:18px 0 0;"><strong>Thanks for joining the Boond list.</strong></p>
<p>Boond is a salty-sweet drink we're still testing. It isn't for sale yet.</p>
${h("WHERE WE ARE")}
<p style="margin-top:0;">We're in our taste validation phase. We're deciding which flavors to make first, and your vote helps decide.</p>
<p><a href="${voteUrl}" style="display:inline-block;background:#FF8A1F;color:#3A2A16;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:999px;">Vote for a flavor</a></p>
${h("WHAT'S NEXT")}
<p style="margin-top:0;">More taste tests, then launch news. You'll get progress notes and launch news in your inbox.</p>
${h("WHILE YOU WAIT")}
<p style="margin-top:0;"><a href="${learnUrl}" style="color:#3A2A16;font-weight:700;">Learn</a>: free lessons from building Boond in public.<br>
<a href="${igUrl}" style="color:#3A2A16;font-weight:700;">Instagram @boondsips</a></p>
<p>Have a question, or a food memory that tastes like home? Just reply to this email. It goes to a real inbox.</p>
<p style="margin-top:24px;">salty sweet, by the drop<br><strong>Boond</strong></p>
<hr style="border:none;border-top:1px solid #3A2A1633;margin:28px 0 14px;">
<p style="font-size:12px;color:#3A2A16b3;margin:0;">You got this because you joined the Boond list at boondsips.com. If that wasn't you, <a href="${unsubUrl}" style="color:#3A2A16;">unsubscribe in one tap</a>.<br>Landed in spam or Promotions? <a href="${SITE}/help/email/" style="color:#3A2A16;">Here is how to fix it</a>.<br>${esc(address)}</p>
</div></body></html>`;
  return { subject: "Welcome to Boond", text, html };
}

async function sendMail(to: string, mail: { subject: string; text: string; html: string }, unsubUrl?: string) {
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
      ...(unsubUrl ? { headers: { "List-Unsubscribe": `<${unsubUrl}>, <mailto:${MAIL_REPLY_TO}?subject=unsubscribe>` } } : {}),
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`resend_${res.status}`);
}

type MailStatus = "sent" | "skipped" | "failed";

const DAILY_CAP = Number(Deno.env.get("MAIL_DAILY_CAP") ?? "60"); // keeps a bot from using up the sending quota

// Send the welcome email once per signup. Never lets an email problem fail the signup itself.
// Logs only a reason, never an address.
async function sendWelcome(signupId: string, email: string): Promise<MailStatus> {
  try {
    const gate = mailGate(email);
    if (gate !== "ok") {
      console.log("boond-waitlist mail skipped:", gate);
      return "skipped";
    }
    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count, error: cerr } = await db
      .from("boond_waitlist_signups")
      .select("id", { count: "exact", head: true })
      .gte("welcomed_at", dayAgo);
    if (cerr) throw cerr;
    if ((count ?? 0) >= DAILY_CAP) {
      console.log("boond-waitlist mail skipped: daily_cap");
      return "skipped";
    }
    // Claim the send first, so two quick requests cannot both send.
    const { data: claimed, error } = await db
      .from("boond_waitlist_signups")
      .update({ welcomed_at: new Date().toISOString() })
      .eq("id", signupId)
      .is("welcomed_at", null)
      .is("unsubscribed_at", null)
      .select("unsubscribe_token");
    if (error || !claimed || claimed.length === 0) {
      console.log("boond-waitlist mail skipped:", error ? "claim_error" : "already_welcomed_or_unsubscribed");
      return "skipped";
    }
    const unsubUrl = `${SITE}/unsubscribe/?t=${claimed[0].unsubscribe_token}`;
    try {
      await sendMail(email, welcomeMail(unsubUrl), unsubUrl);
    } catch (e) {
      await db.from("boond_waitlist_signups").update({ welcomed_at: null }).eq("id", signupId);
      throw e;
    }
    console.log("boond-waitlist mail sent");
    return "sent";
  } catch (e) {
    console.error("boond-waitlist mail error:", e instanceof Error ? e.message : "unknown");
    return "failed";
  }
}

function signinMail(url: string) {
  const address = Deno.env.get("BOOND_POSTAL_ADDRESS") ?? "";
  const help = `${SITE}/help/email/`;
  const text = [
    "Tap this link to sign in to Boond:",
    url,
    "",
    "It works once and expires in 15 minutes. If you didn't ask for it, you can ignore this email.",
    "",
    `Can't find our emails? ${help}`,
    "",
    "salty sweet, by the drop",
    "Boond",
    "",
    "--",
    "You got this because someone asked to sign in at boondsips.com with this address.",
    address,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#FFF2D6;">
<div style="max-width:520px;margin:0 auto;padding:28px 20px;font-family:Arial,Helvetica,sans-serif;color:#3A2A16;font-size:16px;line-height:1.5;">
<div style="font-size:30px;font-weight:700;color:#FF8A1F;">Boond</div>
<p style="margin:18px 0 0;"><strong>Your sign-in link</strong></p>
<p><a href="${url}" style="display:inline-block;background:#FF8A1F;color:#3A2A16;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:999px;">Sign in to Boond</a></p>
<p>It works once and expires in 15 minutes. If you didn't ask for it, you can ignore this email.</p>
<p style="margin-top:24px;">salty sweet, by the drop<br><strong>Boond</strong></p>
<hr style="border:none;border-top:1px solid #3A2A1633;margin:28px 0 14px;">
<p style="font-size:12px;color:#3A2A16b3;margin:0;">You got this because someone asked to sign in at boondsips.com with this address. Can't find our emails? <a href="${help}" style="color:#3A2A16;">Here is how</a>.<br>${esc(address)}</p>
</div></body></html>`;
  return { subject: "Your Boond sign-in link", text, html };
}

// Email a sign-in link if this address is on the list. Always quiet about the outcome, so nobody can
// use it to find out who is on the list. The link carries its token after a "#", which browsers never
// send to a server and email scanners that only fetch the page cannot use.
async function requestSignin(email: string): Promise<void> {
  try {
    if (mailGate(email) !== "ok") { console.log("boond-waitlist signin skipped: gate"); return; }
    const { data: row, error } = await db
      .from("boond_waitlist_signups").select("id, unsubscribed_at").eq("email", email).maybeSingle();
    if (error) throw error;
    if (!row || row.unsubscribed_at) { console.log("boond-waitlist signin skipped: no_account"); return; }
    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const day = await db.from("boond_login_tokens").select("id", { count: "exact", head: true }).gte("created_at", dayAgo);
    if (day.error) throw day.error;
    if ((day.count ?? 0) >= LOGIN_DAILY_CAP) { console.log("boond-waitlist signin skipped: daily_cap"); return; }
    const hour = await db.from("boond_login_tokens").select("id", { count: "exact", head: true }).eq("signup_id", row.id).gte("created_at", hourAgo);
    if (hour.error) throw hour.error;
    if ((hour.count ?? 0) >= LOGIN_HOURLY_PER_PERSON) { console.log("boond-waitlist signin skipped: hourly_limit"); return; }
    const token = newToken();
    const ins = await db.from("boond_login_tokens")
      .insert({ signup_id: row.id, token_hash: await sha256Hex(token), expires_at: new Date(Date.now() + LOGIN_TTL_MS).toISOString() })
      .select("id").single();
    if (ins.error) throw ins.error;
    try {
      await sendMail(email, signinMail(`${SITE}/me/#t=${token}`));
    } catch (e) {
      await db.from("boond_login_tokens").delete().eq("id", ins.data.id);
      throw e;
    }
    console.log("boond-waitlist signin sent");
  } catch (e) {
    console.error("boond-waitlist signin error:", e instanceof Error ? e.message : "unknown");
  }
}

// Emails are always stored lowercase, so equality is safe (and a unique index backs it).
async function upsertSignup(
  email: string,
  flavors: string[],
  source: string,
  voter: string | null = null,
): Promise<{ id: string; mail: MailStatus }> {
  const id = await upsertSignupRow(email, flavors, source);
  await linkVotes(id, voter);
  const mail = await sendWelcome(id, email);
  return { id, mail };
}

async function upsertSignupRow(email: string, flavors: string[], source: string): Promise<string> {
  const now = new Date().toISOString();
  const find = () =>
    db.from("boond_waitlist_signups").select("id, flavor_picks, unsubscribed_at").eq("email", email).maybeSingle();

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
  // Joining again after an unsubscribe puts the address back on the list, and sends the welcome email again
  // so the owner of the address always hears about it (with a one-tap unsubscribe).
  const wasUnsubscribed = existing.unsubscribed_at !== null;
  const upd = await db
    .from("boond_waitlist_signups")
    .update({
      flavor_picks: merged,
      unsubscribed_at: null,
      consent_text: CONSENT_TEXT,
      consented_at: now,
      ...(wasUnsubscribed ? { welcomed_at: null } : {}),
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
        const { mail } = await upsertSignup(email, cleanFlavors(body.flavors), source, cleanVoter(body.voter));
        // "mailed" is true only when a welcome email really went out just now.
        return json({ ok: true, mailed: mail === "sent" }, 200, cors);
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
          signupId = (await upsertSignup(email, [], "suggest", cleanVoter(body.voter))).id;
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
          signupId = (await upsertSignup(email, [], "story", cleanVoter(body.voter))).id;
        }
        const { error } = await db.from("boond_stories").insert({ story, signup_id: signupId });
        if (error) throw error;
        return json({ ok: true }, 200, cors);
      }

      case "signin_request": {
        const email = cleanEmail(body.email);
        if (!email) return json({ error: "invalid_email" }, 400, cors);
        await requestSignin(email);
        return json({ ok: true }, 200, cors); // same answer whether or not the address is on the list
      }

      case "signin_redeem": {
        const token = typeof body.token === "string" ? body.token.trim() : "";
        if (!TOKEN_RE.test(token)) return json({ error: "invalid_token" }, 400, cors);
        const nowIso = new Date().toISOString();
        const { data: used, error } = await db
          .from("boond_login_tokens")
          .update({ used_at: nowIso })
          .eq("token_hash", await sha256Hex(token))
          .is("used_at", null)
          .gt("expires_at", nowIso)
          .select("signup_id");
        if (error) throw error;
        if (!used || used.length === 0) return json({ error: "invalid_token" }, 400, cors);
        const session = newToken();
        const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
        const { error: serr } = await db
          .from("boond_sessions")
          .insert({ signup_id: used[0].signup_id, token_hash: await sha256Hex(session), expires_at: expires });
        if (serr) throw serr;
        return json({ ok: true, session, expires_at: expires }, 200, cors);
      }

      case "me_get": {
        const id = await sessionFor(body.session);
        if (!id) return json({ error: "invalid_session" }, 401, cors);
        const { data: su, error } = await db
          .from("boond_waitlist_signups").select("email, flavor_picks, unsubscribed_at, created_at").eq("id", id).single();
        if (error) throw error;
        const { data: votes, error: verr } = await db.from("boond_flavor_votes").select("flavor").eq("signup_id", id);
        if (verr) throw verr;
        const flavors = [...new Set([...(su.flavor_picks ?? []), ...(votes ?? []).map((v: { flavor: string }) => v.flavor)])]
          .filter((f) => FLAVORS.includes(f));
        return json({ ok: true, email: su.email, flavors, subscribed: su.unsubscribed_at === null, joined: su.created_at }, 200, cors);
      }

      case "me_update": {
        const id = await sessionFor(body.session);
        if (!id) return json({ error: "invalid_session" }, 401, cors);
        const flavors = cleanFlavors(body.flavors);
        const up = await db.from("boond_waitlist_signups").update({ flavor_picks: flavors }).eq("id", id);
        if (up.error) throw up.error;
        // keep this person's votes in step with their picks
        const { data: have, error } = await db.from("boond_flavor_votes").select("id, flavor").eq("signup_id", id);
        if (error) throw error;
        const haveFlavors = new Set((have ?? []).map((v: { flavor: string }) => v.flavor));
        const remove = (have ?? []).filter((v: { flavor: string }) => !flavors.includes(v.flavor)).map((v: { id: string }) => v.id);
        if (remove.length) {
          const del = await db.from("boond_flavor_votes").delete().in("id", remove);
          if (del.error) throw del.error;
        }
        const add = flavors.filter((f) => !haveFlavors.has(f));
        if (add.length) {
          const ins = await db.from("boond_flavor_votes").insert(add.map((f) => ({ flavor: f, signup_id: id })));
          if (ins.error) throw ins.error;
        }
        return json({ ok: true, flavors }, 200, cors);
      }

      case "me_prefs": {
        const id = await sessionFor(body.session);
        if (!id) return json({ error: "invalid_session" }, 401, cors);
        if (typeof body.subscribed !== "boolean") return json({ error: "bad_request" }, 400, cors);
        const up = await db.from("boond_waitlist_signups")
          .update({ unsubscribed_at: body.subscribed ? null : new Date().toISOString() }).eq("id", id);
        if (up.error) throw up.error;
        return json({ ok: true, subscribed: body.subscribed }, 200, cors);
      }

      case "me_delete": {
        const id = await sessionFor(body.session);
        if (!id) return json({ error: "invalid_session" }, 401, cors);
        if (body.confirm !== true) return json({ error: "confirm_required" }, 400, cors);
        // stories and flavor ideas are kept only as long as they are linked to this person
        for (const table of ["boond_stories", "boond_flavor_suggestions"]) {
          const d = await db.from(table).delete().eq("signup_id", id);
          if (d.error) throw d.error;
        }
        const del = await db.from("boond_waitlist_signups").delete().eq("id", id); // also removes votes, links and sessions
        if (del.error) throw del.error;
        return json({ ok: true }, 200, cors);
      }

      case "signout": {
        if (typeof body.session === "string" && TOKEN_RE.test(body.session)) {
          const d = await db.from("boond_sessions").delete().eq("token_hash", await sha256Hex(body.session));
          if (d.error) throw d.error;
        }
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
