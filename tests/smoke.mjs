// Smoke tests for the Boond site (static files in ../public). Run: cd tests && npm install && npx playwright install chromium && npm test
// Starts a tiny local static server, so nothing is deployed and no network is needed except fonts (font failures are ignored).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const check = (cond, name, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  -> " + detail : ""}`);
};

// Optional: CHROMIUM_PATH=/path/to/chrome to use an already installed browser instead of the one Playwright downloads.
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const newPage = async (width = 390, height = 844, colorScheme = "light") => {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (/fonts\.(googleapis|gstatic)\.com/.test(m.location().url || "")) return; // ignore font load failures
    page.errors.push(m.text());
  });
  // Stand-in for the waitlist function, so tests never touch the real database.
  page.api = { calls: [], tally: { cucumber: 0, watermelon: 0, mango: 0, guava: 0, plum: 0, lemon: 0 }, total: 0 };
  await page.route("**/functions/v1/boond-waitlist", async (route) => {
    const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS", "content-type": "application/json" };
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    const body = JSON.parse(req.postData() || "{}");
    page.api.calls.push(body);
    if (page.api.respond) { const r = page.api.respond(body); if (r) return route.fulfill({ status: r.status || 200, headers: H, body: JSON.stringify(r.body) }); }
    if (body.action === "tally") return route.fulfill({ status: 200, headers: H, body: JSON.stringify({ ok: true, tally: page.api.tally, total: page.api.total }) });
    return route.fulfill({ status: 200, headers: H, body: JSON.stringify({ ok: true, mailed: page.api.mailed === true }) });
  });
  return page;
};
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const open = async (page, url) => { const r = await page.goto(BASE + url); await page.waitForLoadState("load"); return r.status(); };

// ---------- Home: nav button, footer link ----------
{
  const page = await newPage(390);
  check((await open(page, "/")) === 200, "home loads");
  const learn = page.locator(".site-header .btn--learn");
  const join = page.locator(".site-header a.btn[href='#join']");
  check(await learn.isVisible(), "Learn nav button is visible at 390px");
  check((await learn.getAttribute("href")) === "learn/", "Learn nav button links to learn/");
  const [lb, jb] = [await learn.boundingBox(), await join.boundingBox()];
  check(lb && jb && jb.width * jb.height >= lb.width * lb.height, "Join stays at least as big as Learn", JSON.stringify({ lb, jb }));
  const [lbg, jbg] = await Promise.all([learn.evaluate((e) => getComputedStyle(e).backgroundColor), join.evaluate((e) => getComputedStyle(e).backgroundColor)]);
  check(lbg !== jbg, "Learn and Join have different accent colors", `${lbg} vs ${jbg}`);
  check(await page.locator(".foot-links a[href='learn/']").count() === 1, "footer has a Learn link");
  // Instagram: easy to find (menu, under the hero form, under the join form, footer), all opening safely in a new tab
  const IG = "https://www.instagram.com/boondsips/";
  const igLinks = page.locator(`a[href='${IG}']`);
  check((await igLinks.count()) === 4, "Instagram link appears four times (menu, hero, join, footer)", String(await igLinks.count()));
  const igAttrs = await igLinks.evaluateAll((els) => els.map((e) => e.target === "_blank" && /noopener/.test(e.rel)));
  check(igAttrs.every(Boolean), "every Instagram link opens in a new tab with rel=noopener");
  check(await page.locator(".follow--hero a").isVisible(), "hero 'Follow @boondsips on Instagram' is visible at 390px");
  await page.click("#burger");
  check(await page.locator(`.menu nav a[href='${IG}']`).isVisible(), "menu shows an Instagram link");
  await page.click("#menuClose");

  for (const w of [360, 390, 430]) {
    await page.setViewportSize({ width: w, height: 844 });
    check(await noSideScroll(page), `home: no sideways scroll at ${w}px`);
    check(await learn.isVisible() && await join.isVisible(), `home: Learn and Join both visible at ${w}px`);
  }
  // 320px: only the header is checked. (The daily-value calculator on the existing page overflows by 1px at 320px, which predates the Learn section.)
  await page.setViewportSize({ width: 320, height: 844 });
  const jb320 = await join.boundingBox();
  check(jb320 && jb320.x + jb320.width <= 320 && (await learn.boundingBox()).x >= 0, "home: header buttons fit inside 320px");
  await page.setViewportSize({ width: 390, height: 844 });
  await Promise.all([page.waitForURL("**/learn/"), learn.click()]);
  check(page.url().endsWith("/learn/"), "Learn nav button goes to /learn/");
  check(page.errors.length === 0, "home: no console errors", page.errors.join(" | "));
}

// ---------- Hub ----------
let hubItems = [];
{
  const page = await newPage(390);
  check((await open(page, "/learn/")) === 200, "/learn/ loads");
  hubItems = await page.evaluate(() => window.LEARN_ITEMS);
  check(Array.isArray(hubItems) && hubItems.length >= 2, "hub data file has items");
  check((await page.locator("#learn-list > li").count()) === hubItems.length, "hub renders one card per data item");
  const course = page.locator("#learn-list a.card", { hasText: "Marketing in Public" });
  check(await course.count() === 1, "Marketing in Public is a live link");
  const soon = page.locator("#learn-list .card.is-soon", { hasText: "Brand stories" });
  check(await soon.count() === 1 && (await soon.evaluate((e) => e.tagName)) === "DIV", "Brand stories is coming soon and is not a link");
  check(await page.locator(".site-header .btn--learn").isVisible(), "hub: nav Learn button shows at 390px");
  check(await noSideScroll(page), "hub: no sideways scroll at 390px");
  await Promise.all([page.waitForURL("**/learn/marketing/"), course.click()]);
  check(page.url().endsWith("/learn/marketing/"), "hub link goes to /learn/marketing/");
  check(page.errors.length === 0, "hub: no console errors", page.errors.join(" | "));
}

// ---------- Course index ----------
{
  const page = await newPage(390);
  check((await open(page, "/learn/marketing/")) === 200, "/learn/marketing/ loads");
  const modules = await page.evaluate(() => window.LEARN_ITEMS);
  check(modules.length === 12, "course data lists 12 modules", String(modules.length));
  check((await page.locator("#learn-list > li").count()) === modules.length, "course index renders one card per module");
  const liveCount = modules.filter((m) => String(m.status).toLowerCase() === "live").length;
  check((await page.locator("#learn-list a.card").count()) === liveCount, "only live modules are links", `${liveCount} live`);
  check(await noSideScroll(page), "course index: no sideways scroll at 390px");
  await Promise.all([page.waitForURL("**/learn/"), page.locator(".back").click()]);
  check(page.url().endsWith("/learn/"), "course index 'All lessons' link goes back to the hub");
  check(page.errors.length === 0, "course index: no console errors", page.errors.join(" | "));

  // Every live module must load, link back to the course index, and have no console errors. (Module-specific tab, donate and keyboard checks are in the Module 1 block below.)
  for (const m of modules.filter((x) => String(x.status).toLowerCase() === "live")) {
    const mp = await newPage(390);
    const status = await open(mp, `/learn/marketing/${m.url}`);
    check(status === 200, `module ${m.number} loads`);
    check(await mp.locator("a[href='../']").count() >= 1, `module ${m.number} links back to the course index`);
    check(await noSideScroll(mp), `module ${m.number}: no sideways scroll at 390px`);
    check(mp.errors.length === 0, `module ${m.number}: no console errors`, mp.errors.join(" | "));
  }
  if (liveCount === 0) console.log("NOTE  no live modules yet, so no module page checks ran");
}

// ---------- Module 1: wrapper, tabs, hash routing, donate link, keyboard, no network ----------
{
  const M1 = "/learn/marketing/module-1/";
  const page = await newPage(390);
  const external = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!u.protocol.startsWith("http") || u.origin === BASE || /^fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) return;
    external.push(r.url());
  });
  check((await open(page, M1)) === 200, "module 1 loads");
  check(await page.locator(".bn-header").isVisible() && await page.locator(".bn-footer").isVisible(), "module 1 has the site header and footer");
  check(await page.locator(".bn-header a[href='../../']").isVisible(), "module 1: header Learn button shows at 390px");
  check((await page.locator(".foot-note").innerText()).includes("Access for free at openstax.org"), "module 1 keeps the OpenStax credit");
  check(!/Boond Sips/.test(await page.content()), "module 1 never says 'Boond Sips'");

  // four tabs switch, panels follow, hash follows
  const tabs = ["learn", "cards", "quiz", "apply"];
  for (const t of tabs) {
    await page.click(`.tab[data-tab=${t}]`);
    const visible = await Promise.all(tabs.map((x) => page.locator(`#p-${x}`).isVisible()));
    check(visible.every((v, i) => v === (tabs[i] === t)) && (await page.locator(`.tab[data-tab=${t}]`).getAttribute("aria-selected")) === "true" && page.url().endsWith("#" + t), `tab "${t}" switches (panel, aria-selected, #hash)`);
    check(await noSideScroll(page), `module 1: no sideways scroll on the ${t} tab at 390px`);
  }
  // hash routing on first load
  await page.goto(BASE + M1 + "#quiz");
  check(await page.locator("#p-quiz").isVisible() && !(await page.locator("#p-learn").isVisible()), "opening #quiz shows the Quiz tab");

  // flashcards and quiz respond; apply-it answers stay in localStorage
  await page.click(".tab[data-tab=cards]"); await page.click("#flip");
  check((await page.locator("#card").getAttribute("class")).includes("flipped"), "flashcard flips");
  await page.click(".tab[data-tab=quiz]"); await page.locator(".opt").first().click();
  check(await page.locator("#fb .fb").isVisible(), "quiz shows feedback after an answer");
  await page.click(".tab[data-tab=apply]"); await page.fill("#f-vp", "test sentence");
  check(((await page.evaluate(() => localStorage.getItem("mip-m1-apply"))) || "").includes("test sentence"), "apply-it answers are saved in localStorage");
  // Apply-it: Boond is the only worked example; "Your brand" has a name field so others can try it
  check(!/Foundeez|DataSnake|healthy/i.test(await page.content()), "module 1 has no Foundeez, DataSnake or 'healthy'");
  check((await page.locator(".track").count()) === 2, "Apply-it offers two tracks: Your brand and Boond");
  await page.fill("#f-name", "Acme Salt Co");
  await page.click("#copyans");
  check(((await page.inputValue("#copyta")) || "").startsWith("Marketing in Public, Module 1: Acme Salt Co"), "copied answers use the typed brand name");
  await page.click(".track[data-t=boond]");
  check((await page.locator("#f-name").count()) === 0, "Boond track has no name field");
  await page.click("#copyans");
  check(((await page.inputValue("#copyta")) || "").startsWith("Marketing in Public, Module 1: Boond\n"), "Boond track copies as 'Boond'");
  await page.click(".track[data-t=mine]");
  check((await page.inputValue("#f-name")) === "Acme Salt Co", "typed brand name is remembered in this browser");
  check(external.length === 0, "module 1 makes no network calls except fonts", external.join(" | "));
  check(page.errors.length === 0, "module 1: no console errors", page.errors.join(" | "));

  // back link goes to the course index
  await Promise.all([page.waitForURL("**/learn/marketing/"), page.locator(".bn-back").click()]);
  check(page.url().endsWith("/learn/marketing/"), "module 1 'All modules' link goes to /learn/marketing/");

  // donate link: hidden by default, shown only for an https URL
  const d = await newPage(390);
  await open(d, M1);
  check(await d.locator("#donate-wrap").isHidden(), "donate link is hidden by default");
  for (const [url, shown] of [["https://example.org/give", true], ["http://example.org/give", false], ["javascript:alert(1)", false]]) {
    const dp = await newPage(390);
    await dp.route("**/learn/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: `window.MIP_CONFIG={donateUrl:${JSON.stringify(url)}};` }));
    await open(dp, M1);
    const vis = await dp.locator("#donate-wrap").isVisible();
    check(vis === shown && (!shown || (await dp.locator("#donate-link").getAttribute("href")) === url), `donateUrl ${url} -> link ${shown ? "shown" : "hidden"}`);
  }

  // keyboard: all four tabs can be reached with the Tab key
  const k = await newPage(390);
  await open(k, M1);
  const reached = new Set();
  for (let i = 0; i < 40; i++) {
    await k.keyboard.press("Tab");
    const t = await k.evaluate(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.tab);
    if (t) reached.add(t);
  }
  check(tabs.every((t) => reached.has(t)), "all four tabs are reachable with the keyboard", [...reached].join(","));
}

// ---------- Demo home (dark look preview; nothing is saved) ----------
{
  const page = await newPage(390);
  const external = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!u.protocol.startsWith("http") || u.origin === BASE || /^fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) return;
    external.push(r.url());
  });
  check((await open(page, "/demo-home/")) === 200, "demo home loads");
  check(((await page.locator("meta[name=robots]").getAttribute("content")) || "").includes("noindex"), "demo home is noindex");
  check((await page.getAttribute("html", "data-theme")) === "dark", "demo home opens in the dark theme");
  const chips = (await page.locator(".chips .chip").allInnerTexts()).join("|");
  check(chips === "4 g fiber|4 g sugar|about 200 mg sodium|about 25 cal", "demo home shows the four target chips", chips);
  check((await page.locator(".targets").innerText()).includes("targets while we test"), "demo home says the numbers are targets while we test");
  check(await page.locator(".fan").isVisible(), "demo home shows the concept stick packs");
  check((await page.locator("#track .fcard").count()) === 6 && (await page.locator("#track .fcard h3").first().innerText()) === "Salty Cucumber Mint", "demo home lists six flavors, cucumber mint first");
  check(await page.locator(".nav-actions a", { hasText: "Learn" }).isVisible() && await page.locator(".nav-actions a[href='#join']").isVisible(), "demo home: Learn and Join are visible at 390px");

  // theme: toggle, remember, toggle back
  await page.click("#theme");
  check((await page.getAttribute("html", "data-theme")) === "light", "theme button switches to light");
  await page.reload(); await page.waitForLoadState("load");
  check((await page.getAttribute("html", "data-theme")) === "light", "the chosen theme is remembered after a reload");
  for (const theme of ["light", "dark"]) {
    if ((await page.getAttribute("html", "data-theme")) !== theme) await page.click("#theme");
    for (const w of [360, 390, 430]) {
      await page.setViewportSize({ width: w, height: 844 });
      check(await noSideScroll(page), `demo home (${theme}): no sideways scroll at ${w}px`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });

  // calculator and forms
  await page.click("#plus");
  check((await page.textContent("#amt2")) === "400 mg", "calculator doubles the sodium target with 2 sticks");
  await page.fill("#heroEmail", "a@b.co");
  await page.click("#heroForm .btn");
  check((await page.textContent("#heroForm .msg")).includes("tick the box"), "demo form asks for consent");
  await page.check("#heroForm input[name=consent]");
  await page.click("#heroForm .btn");
  check((await page.textContent("#heroForm .msg")).includes("Demo page: nothing was saved"), "demo form says nothing was saved");
  check(external.length === 0, "demo home sends nothing to any server (fonts aside)", external.join(" | "));
  check(page.errors.length === 0, "demo home: no console errors", page.errors.join(" | "));
}

// ---------- Flavor vote and suggestions ----------
{
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const page = await newPage(390);
  await page.addInitScript(() => { try { localStorage.setItem("boondSheetDismissed", String(Date.now())); } catch (e) {} }); // keep the save sheet out of the way here
  check((await open(page, "/")) === 200, "vote: home loads");
  await page.waitForFunction(() => document.querySelectorAll("#vlist .vrow").length === 6);
  check(await page.locator(".menu nav a[href='#vote']").count() === 1, "vote: menu has a Vote link");
  const names = (await page.locator("#vlist .vname").allInnerTexts()).join("|");
  check(names === "Cucumber Mint|Watermelon|Mango|Guava|Plum|Lemon", "vote: six flavors in launch order", names);
  check((await page.locator("#vote").getAttribute("class")).includes("few") && !(await page.locator("#vlist .vbar").first().isVisible()), "vote: with few votes, no percentages are shown");
  check((await page.locator("#vnote").innerText()).includes("Be one of the first"), "vote: shows 'be one of the first' when there are few votes");
  check((await page.locator("#vnote").innerText()).includes("taste validation phase"), "vote: the note uses the friendly 'taste validation phase' wording");
  const body = await page.locator("body").innerText();
  check(!/lab data|draft direction|draft tasting/i.test(body), "wording: no 'lab data' or 'draft direction' left on the home page");

  // the Vote button near the top
  const jump = page.locator("#voteJump");
  check(await jump.isVisible() && (await jump.getAttribute("href")) === "#vote", "vote button: the home page has a 'Vote for a flavor' button linking to #vote");
  for (const [w, h] of [[390, 844], [360, 640]]) {
    await page.setViewportSize({ width: w, height: h }); await page.evaluate(() => window.scrollTo(0, 0));
    const bx = await jump.boundingBox();
    check(bx && bx.y >= 0 && bx.y + bx.height <= h, `vote button: visible without scrolling at ${w}x${h}`, JSON.stringify(bx));
  }
  const joinBox = await page.locator("#heroForm button[type=submit]").boundingBox(), vb = await jump.boundingBox();
  check(vb.height <= joinBox.height && vb.width <= 260 && (await page.locator("#heroForm button[type=submit]").evaluate((e) => getComputedStyle(e).backgroundColor)) !== (await jump.evaluate((e) => getComputedStyle(e).backgroundColor)), "vote button: Join stays the main button (pink) and the Vote button is the quieter one");
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0, 0));
  await jump.click();
  let last = -1; for (let i = 0; i < 30; i++) { await page.waitForTimeout(150); const y = await page.evaluate(() => window.scrollY); if (Math.abs(y - last) < 1) break; last = y; }
  const topOfVote = await page.evaluate(() => Math.round(document.getElementById("vote").getBoundingClientRect().top));
  check(topOfVote >= 0 && topOfVote <= 120, "vote button: clicking it scrolls down to the vote section", String(topOfVote));
  check(await page.locator("#vote-h").isVisible() && (await page.evaluate(() => location.hash)) === "#vote", "vote button: the vote heading is on screen and the address ends in #vote");
  await page.evaluate(() => window.scrollTo(0, 0));

  // percentages appear once there are enough votes
  page.api.tally = { cucumber: 10, watermelon: 6, mango: 4, guava: 0, plum: 0, lemon: 0 }; page.api.total = 20;
  await page.reload(); await page.waitForFunction(() => !document.getElementById("vote").classList.contains("few"));
  const pcts = (await page.locator("#vlist .vpct").allInnerTexts()).slice(0, 3).join("|");
  check(pcts === "50%|30%|20%", "vote: percentages match the tally", pcts);
  check(await page.locator("#vlist .vrow").first().evaluate((e) => e.querySelector(".vbar i").style.width) === "50%", "vote: bar width matches the percentage");
  check(!(await page.content()).includes("undefined"), "vote: nothing renders as 'undefined'");

  // voting, taking a vote back, one voter id, sync with the other buttons
  page.api.calls.length = 0;
  const mango = page.locator("#vlist .vrow[data-id=mango]");
  await mango.click();
  check((await mango.getAttribute("aria-pressed")) === "true" && (await mango.locator(".vact").innerText()).startsWith("Voted"), "vote: tapping a flavor votes for it");
  await page.waitForFunction(() => true); await page.waitForTimeout(250);
  const v1 = page.api.calls.find((c) => c.action === "vote");
  check(v1 && v1.flavor === "mango" && UUID.test(v1.voter), "vote: sends the flavor and an anonymous voter id", JSON.stringify(v1));
  check((await page.locator(".try[data-id=mango]").getAttribute("aria-pressed")) === "true", "vote: the carousel 'I'd try this' button follows");
  await mango.click(); await page.waitForTimeout(250);
  const u1 = page.api.calls.find((c) => c.action === "unvote");
  check((await mango.getAttribute("aria-pressed")) === "false" && u1 && u1.flavor === "mango" && u1.voter === v1.voter, "vote: tapping again takes the vote back with the same voter id");
  await page.reload(); await page.waitForFunction(() => document.querySelectorAll("#vlist .vrow").length === 6);
  await page.locator("#vlist .vrow[data-id=guava]").click(); await page.waitForTimeout(250);
  const v2 = page.api.calls.filter((c) => c.action === "vote").pop();
  check(v2.voter === v1.voter, "vote: the voter id is kept after a reload");
  await page.locator(".try[data-id=plum]").click(); await page.waitForTimeout(150);
  check((await page.locator("#vlist .vrow[data-id=plum]").getAttribute("aria-pressed")) === "true", "vote: the carousel button also marks the vote row");
  await page.check("#joinPicks input[value=lemon]"); await page.waitForTimeout(250);
  check(page.api.calls.some((c) => c.action === "vote" && c.flavor === "lemon") && (await page.locator("#vlist .vrow[data-id=lemon]").getAttribute("aria-pressed")) === "true", "vote: a flavor ticked in the join form counts as a vote");
  check((await page.locator("#joinPicks legend").innerText()).includes("count as votes"), "vote: the join form says those picks count as votes");

  // suggestions
  page.api.calls.length = 0;
  const msg = () => page.textContent("#suggestForm .form-msg");
  check(await page.locator("#suggestForm input[name=website]").count() === 1, "suggest: has a hidden spam-trap field");
  await page.click("#suggestForm button"); check((await msg()).includes("flavor name"), "suggest: empty is refused");
  await page.fill("#suggestText", "see www.spam.com"); await page.click("#suggestForm button"); check((await msg()).includes("no links"), "suggest: links are refused");
  await page.fill("#suggestText", "guava with chaat masala"); await page.fill("#suggestEmail", "not-an-email"); await page.click("#suggestForm button");
  check((await msg()).includes("valid email"), "suggest: a bad email is refused");
  await page.fill("#suggestEmail", "a@b.co"); await page.click("#suggestForm button");
  check((await msg()).includes("tick the box") && page.api.calls.length === 0, "suggest: an email without consent is refused and sends nothing");
  await page.fill("#suggestEmail", ""); await page.fill("#suggestText", "  tamarind   with salt  "); await page.click("#suggestForm button"); await page.waitForTimeout(300);
  const sg = page.api.calls.find((c) => c.action === "suggest");
  check(sg && sg.suggestion === "tamarind with salt" && sg.email === "" && sg.consent === false && sg.website === "", "suggest: sends the tidied text, with no email and no consent", JSON.stringify(sg));
  check((await msg()).includes("Thank you") && (await page.inputValue("#suggestText")) === "", "suggest: confirms and clears the form");
  check(!(await page.locator("body").innerText()).includes("tamarind"), "suggest: nothing typed is shown on the page");
  await page.fill("#suggestText", "kala khatta"); await page.fill("#suggestEmail", "c@d.co"); await page.check("#suggestForm input[name=consent]"); await page.click("#suggestForm button"); await page.waitForTimeout(300);
  const sg2 = page.api.calls.filter((c) => c.action === "suggest").pop();
  check(sg2.email === "c@d.co" && sg2.consent === true, "suggest: with an email and consent, both are sent");

  for (const w of [360, 390, 430]) { await page.setViewportSize({ width: w, height: 844 }); check(await noSideScroll(page), `vote: no sideways scroll at ${w}px`); }
  const dark = await newPage(390, 844, "dark"); await open(dark, "/"); await dark.waitForFunction(() => document.querySelectorAll("#vlist .vrow").length === 6);
  for (const w of [360, 390, 430]) { await dark.setViewportSize({ width: w, height: 844 }); check(await noSideScroll(dark), `vote (dark): no sideways scroll at ${w}px`); }
  check(page.errors.length === 0 && dark.errors.length === 0, "vote: no console errors", page.errors.concat(dark.errors).join(" | "));
}

// ---------- Save your picks sheet and "you're on the list" memory ----------
{
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const voteRow = (p, id) => p.locator(`#vlist .vrow[data-id=${id}]`);
  const ready = (p) => p.waitForFunction(() => document.querySelectorAll("#vlist .vrow").length === 6);

  // 1. the first vote opens the sheet; "No thanks" closes it and it stays away
  let page = await newPage(390);
  await open(page, "/"); await ready(page);
  check(await page.locator("#saveSheet").isHidden(), "sheet: hidden before anyone votes");
  await voteRow(page, "mango").click();
  await page.waitForSelector("#saveSheet:not([hidden])", { timeout: 4000 });
  check((await page.locator("#saveTitle").innerText()) === "Save your picks" && await page.locator("#saveEmail").isVisible(), "sheet: opens after the first vote with one email field");
  check((await page.locator("#saveSheet").innerText()).includes("unsubscribe anytime") && (await page.locator("#saveSheet").innerText()).includes("our newsletter"), "sheet: shows the consent text (taste test updates, launch news, newsletter)");
  check(!/magic link|password|sign in/i.test(await page.locator("#saveSheet").innerText()), "sheet: promises no magic link or password (not available yet)");
  await page.waitForTimeout(600);
  const sb = await page.locator("#saveForm").boundingBox();
  check(sb && sb.x >= 0 && sb.x + sb.width <= 390 && sb.y >= 0, "sheet: fits inside a 390px screen", JSON.stringify(sb));
  await page.click("#saveLater");
  check(await page.locator("#saveSheet").isHidden(), "sheet: 'No thanks' closes it");
  await voteRow(page, "guava").click(); await page.waitForTimeout(1000);
  check(await page.locator("#saveSheet").isHidden(), "sheet: does not come back for the next vote");
  await page.reload(); await ready(page); await voteRow(page, "plum").click(); await page.waitForTimeout(1000);
  check(await page.locator("#saveSheet").isHidden(), "sheet: stays closed after a reload (dismissed on this device)");
  check(page.errors.length === 0, "sheet: no console errors", page.errors.join(" | "));

  // 2. Escape closes it, and a vote from the join form never opens it
  page = await newPage(390); await open(page, "/"); await ready(page);
  await page.check("#joinPicks input[value=lemon]"); await page.waitForTimeout(1000);
  check(await page.locator("#saveSheet").isHidden(), "sheet: a flavor ticked in the join form does not open it");
  await voteRow(page, "watermelon").click(); await page.waitForSelector("#saveSheet:not([hidden])");
  await page.keyboard.press("Escape");
  check(await page.locator("#saveSheet").isHidden(), "sheet: Escape closes it");

  // 3. saving: validation, payload, and the remembered state
  page = await newPage(390); await open(page, "/"); await ready(page);
  await voteRow(page, "mango").click(); await page.waitForSelector("#saveSheet:not([hidden])");
  const m = () => page.textContent("#saveForm .form-msg");
  await page.click("#saveForm button[type=submit]"); check((await m()).includes("valid email"), "sheet: empty email is refused");
  await page.fill("#saveEmail", "a@b.co"); await page.click("#saveForm button[type=submit]");
  check((await m()).includes("tick the box") && !page.api.calls.some((c) => c.action === "signup"), "sheet: no consent, nothing is sent");
  await page.check("#saveForm input[name=consent]"); await page.click("#saveForm button[type=submit]"); await page.waitForTimeout(400);
  const su = page.api.calls.find((c) => c.action === "signup");
  check(su && su.email === "a@b.co" && su.consent === true && su.source === "vote" && su.flavors.includes("mango") && UUID.test(su.voter) && su.website === "", "sheet: sends the email, consent, source 'vote', the picks and the anonymous voter id", JSON.stringify(su));
  const vt = page.api.calls.find((c) => c.action === "vote");
  check(vt && vt.voter === su.voter, "sheet: the sign-up and the vote use the same voter id");
  await page.waitForSelector("#saveSheet", { state: "hidden", timeout: 4000 });
  check(await page.locator("#heroFormJoined").isVisible() && await page.locator("#heroForm").isHidden(), "joined: the hero form is replaced by 'You're on the list'");
  check((await page.locator("#joinFormJoined").innerText()).includes("You're on the list") && await page.locator("#joinForm").isHidden(), "joined: the join form is replaced too");
  check(!(await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)))).includes("a@b.co"), "joined: the email address is not kept in the browser");

  // 4. the memory survives a reload, no sheet for a joined browser, and it can be undone
  await page.reload(); await ready(page);
  check(await page.locator("#heroFormJoined").isVisible(), "joined: still remembered after a reload");
  await voteRow(page, "guava").click(); await page.waitForTimeout(1000);
  check(await page.locator("#saveSheet").isHidden(), "joined: no save sheet for someone who already joined");
  await page.locator("#heroFormJoined .later").click();
  check(await page.locator("#heroForm").isVisible() && await page.locator("#heroFormJoined").isHidden(), "joined: 'Use a different email' brings the form back");

  // 5. the hero form also marks the browser as joined, and sends the voter id
  page = await newPage(390); await open(page, "/"); await ready(page);
  await page.fill("#heroEmail", "c@d.co"); await page.check("#heroForm input[name=consent]"); await page.click("#heroForm button[type=submit]"); await page.waitForTimeout(400);
  const hs = page.api.calls.find((c) => c.action === "signup");
  check(hs && hs.source === "hero" && UUID.test(hs.voter), "joined: the hero form sends the voter id too", JSON.stringify(hs));
  check(await page.locator("#heroFormJoined").isVisible(), "joined: joining through the hero form is remembered");

  check(!/welcome email from/.test(await page.locator("#heroFormJoined").innerText()), "email note: no 'we sent an email' claim when the server did not send one");
  check(await page.locator("#heroFormJoined details").count() === 1 && (await page.locator("#heroFormJoined details").innerText()).includes("What's in the email?"), "email note: 'What's in the email?' is offered");

  // 5b. when the server really sent a welcome email, the page says so and lists what is in it
  page = await newPage(390); await open(page, "/"); await ready(page);
  page.api.mailed = true;
  await page.fill("#heroEmail", "e@f.co"); await page.check("#heroForm input[name=consent]"); await page.click("#heroForm button[type=submit]"); await page.waitForTimeout(400);
  const sent = await page.locator("#heroFormJoined").innerText();
  check(sent.includes("You're on the list") && sent.includes("welcome email from hello@boondsips.com") && sent.includes("spam"), "email note: says a welcome email was sent, from where, and to check spam", sent);
  await page.locator("#heroFormJoined summary").click();
  const inside = await page.locator("#heroFormJoined details").innerText();
  check(inside.includes("not for sale yet") && inside.includes("vote for a flavor") && inside.includes("Learn") && inside.includes("Instagram") && inside.includes("unsubscribe link"), "email note: the list shows what is in the email (status, vote, Learn and Instagram links, unsubscribe)", inside);
  check(await noSideScroll(page), "email note: no sideways scroll at 390px");
  await page.reload(); await ready(page);
  check(!/welcome email from/.test(await page.locator("#heroFormJoined").innerText()), "email note: after a reload it no longer claims an email was just sent");

  // 6. small phones and dark mode
  for (const [w, h, scheme] of [[360, 640, "light"], [390, 844, "dark"]]) {
    const q = await newPage(w, h, scheme); await open(q, "/"); await ready(q);
    await voteRow(q, "mango").click(); await q.waitForSelector("#saveSheet:not([hidden])"); await q.waitForTimeout(600); // let the slide-up finish
    const bx = await q.locator("#saveForm").boundingBox();
    check(bx && bx.x >= 0 && bx.x + bx.width <= w && bx.y >= 0 && bx.y + bx.height <= h, `sheet: fits the screen at ${w}x${h} (${scheme})`, JSON.stringify(bx));
    check(await noSideScroll(q), `sheet: no sideways scroll at ${w}px (${scheme})`);
    check(q.errors.length === 0, `sheet: no console errors at ${w}px (${scheme})`, q.errors.join(" | "));
  }
}

// ---------- Config ----------
{
  const page = await newPage(390);
  await open(page, "/learn/");
  await page.addScriptTag({ url: `${BASE}/learn/config.js` });
  const donate = await page.evaluate(() => window.MIP_CONFIG && window.MIP_CONFIG.donateUrl);
  check(donate === "", "donateUrl is empty by default", JSON.stringify(donate));
}

// ---------- Theme demo: Auto / Light / Dark switch (the demo page only; the real page is untouched) ----------
{
  const bg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const LIGHT = "rgb(255, 242, 214)", DARK = "rgb(30, 22, 12)";
  const themeAttr = (p) => p.evaluate(() => document.documentElement.getAttribute("data-theme"));
  const pressed = (p, scope) => p.evaluate((sc) => [...document.querySelectorAll(sc + " [data-theme-choice]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("data-theme-choice")).join(","), scope);
  const file = fs.readFileSync(path.join(ROOT, "demo-theme", "index.html"), "utf8");
  check(file.indexOf('localStorage.getItem("boondTheme")') < file.indexOf("<style>"), "theme demo: the saved theme is applied before the styles load (no flash)");
  check(/name="robots" content="noindex"/.test(file), "theme demo: not indexed by search engines");

  let page = await newPage(390, 844, "light");
  check(await open(page, "/demo-theme/") === 200 && page.errors.length === 0, "theme demo: loads without errors", page.errors.join(" | "));
  check(await page.locator(".demo-strip").isVisible(), "theme demo: says it is a demo and nothing is saved");
  check(await bg(page) === LIGHT && await pressed(page, ".foot") === "auto", "theme demo: Auto follows a light system", await bg(page));
  await page.emulateMedia({ colorScheme: "dark" });
  check(await bg(page) === DARK, "theme demo: Auto follows the system when it switches to dark", await bg(page));
  await page.emulateMedia({ colorScheme: "light" });

  // Dark chosen in the footer, on a light system
  await page.locator(".foot [data-theme-choice=dark]").scrollIntoViewIfNeeded();
  await page.locator(".foot [data-theme-choice=dark]").click();
  check(await themeAttr(page) === "dark" && await bg(page) === DARK, "theme demo: Dark overrides a light system");
  check(await pressed(page, ".foot") === "dark" && await pressed(page, ".menu") === "dark", "theme demo: the footer and menu controls stay in sync");
  check(await page.evaluate(() => localStorage.getItem("boondTheme")) === "dark", "theme demo: the choice is remembered in this browser");
  await page.reload(); await page.waitForLoadState("load");
  check(await themeAttr(page) === "dark" && await bg(page) === DARK, "theme demo: the choice survives a reload");
  const pb = await page.evaluate(() => { const b = document.querySelector(".foot [data-theme-choice=dark]"); const c = getComputedStyle(b.querySelector("span")).color; return [c, getComputedStyle(b).backgroundColor]; });
  check(pb[0] !== pb[1], "theme demo: the selected button's text is readable against its fill", pb.join(" on "));

  // Light chosen on a dark system, from the menu
  page = await newPage(390, 844, "dark"); await open(page, "/demo-theme/");
  check(await bg(page) === DARK && await pressed(page, ".menu") === "auto", "theme demo: Auto follows a dark system");
  await page.click("#burger"); await page.waitForTimeout(500);
  const box = await page.locator(".menu .theme-row").boundingBox();
  check(box && box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844, "theme demo: the control fits inside the open menu at 390px", JSON.stringify(box));
  await page.locator(".menu [data-theme-choice=light]").click();
  check(await themeAttr(page) === "light" && await bg(page) === LIGHT, "theme demo: Light overrides a dark system (chosen in the menu)");
  await page.locator(".menu [data-theme-choice=auto]").click();
  check(await themeAttr(page) === null && await bg(page) === DARK && await page.evaluate(() => localStorage.getItem("boondTheme")) === null, "theme demo: Auto removes the override and follows the system again");

  // Nothing is saved, and the real page's memory is untouched
  page = await newPage(390, 844, "light"); await open(page, "/demo-theme/");
  await page.waitForFunction(() => document.querySelectorAll("#vlist .vrow").length === 6);
  await page.fill("#heroEmail", "demo@example.com"); await page.check("#heroForm input[name=consent]"); await page.click("#heroForm button[type=submit]"); await page.waitForTimeout(500);
  check(await page.locator("#heroFormJoined").isVisible(), "theme demo: the form still behaves like the real one");
  check(!page.api.calls.some((c) => c.action === "signup"), "theme demo: the signup never reaches the server");
  const keys = await page.evaluate(() => Object.keys(localStorage));
  check(keys.every((k) => k === "boondTheme" || k.startsWith("demo_")), "theme demo: the demo does not touch the real page's saved state", keys.join(","));
  check(await page.evaluate(() => [...document.querySelectorAll("a[href]")].filter((a) => /^learn\//.test(a.getAttribute("href"))).length) === 0, "theme demo: links to other pages are absolute");

  // Fit on small phones, both themes
  for (const [w, h, scheme] of [[360, 640, "light"], [360, 640, "dark"], [390, 844, "dark"]]) {
    const q = await newPage(w, h, scheme); await open(q, "/demo-theme/");
    check(await noSideScroll(q), `theme demo: no sideways scroll at ${w}px (${scheme})`);
  }
}

// ---------- Type demo: Today / New type / Calmer, same content (demo page only; the real page is untouched) ----------
{
  const file = fs.readFileSync(path.join(ROOT, "demo-type", "index.html"), "utf8");
  const real = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  check(file.indexOf('localStorage.getItem("demo_boondStyle")') < file.indexOf("<style>"), "type demo: the saved style is applied before the styles load (no flash)");
  check(/name="robots" content="noindex"/.test(file), "type demo: not indexed by search engines");
  // Same content as the real page: every section and every heading of the real page is on the demo
  const heads = (h) => [...h.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)].map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  const miss = heads(real).filter((x) => !heads(file).includes(x));
  check(miss.length === 0, "type demo: has every heading of the real page", miss.join(" | "));
  const ids = (h) => [...h.matchAll(/<section[^>]*id="([^"]+)"/g)].map((m) => m[1]);
  check(ids(real).every((id) => ids(file).includes(id)), "type demo: has every section of the real page", ids(real).join(","));

  const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const fam = (p, sel) => p.evaluate((q) => getComputedStyle(document.querySelector(q)).fontFamily, sel);
  const css = (p, sel, prop) => p.evaluate(([q, pr]) => getComputedStyle(document.querySelector(q))[pr], [sel, prop]);
  const styleAttr = (p) => p.evaluate(() => document.documentElement.getAttribute("data-style"));

  let page = await newPage(390, 844, "light");
  check(await open(page, "/demo-type/") === 200 && page.errors.length === 0, "type demo: loads without errors", page.errors.join(" | "));
  check(await styleAttr(page) === null && /Fredoka/.test(await fam(page, ".hero h1")) && /Nunito/.test(await fam(page, "body")), "type demo: starts as Today (Fredoka and Nunito)");
  check(/3px/.test(await css(page, ".hero h1", "webkitTextStrokeWidth")), "type demo: Today keeps the headline outline");

  await page.click("#cmpFab");
  check(await page.locator("#cmpPanel").isVisible(), "type demo: the Aa button opens the compare panel");
  const pb = await page.locator("#cmpPanel").boundingBox();
  check(pb && pb.x >= 0 && pb.x + pb.width <= 390 && pb.y >= 0 && pb.y + pb.height <= 844, "type demo: the panel fits on a 390px phone", JSON.stringify(pb));
  await page.click("[data-style-choice=type]");
  check(await styleAttr(page) === "type" && /Bricolage/.test(await fam(page, ".hero h1")) && /Figtree/.test(await fam(page, "body")), "type demo: New type switches to Bricolage Grotesque and Figtree");
  check(/^0px$/.test(await css(page, ".hero h1", "webkitTextStrokeWidth")) && (await css(page, ".hero h1", "textShadow")) === "none", "type demo: New type removes the headline outline and shadow");
  check(/Fredoka/.test(await fam(page, ".site-header .wordmark")), "type demo: the logo keeps Fredoka");
  check(await page.evaluate(() => [...document.querySelectorAll("[data-style-choice]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.styleChoice).join()) === "type", "type demo: the pressed button follows the style");
  await page.click("[data-style-choice=calm]"); await page.waitForTimeout(500); // buttons animate their shadow for a moment
  const sh = await css(page, ".btn", "boxShadow");
  check(await styleAttr(page) === "calm" && /Fredoka/.test(await fam(page, ".hero h1")) && /Nunito/.test(await fam(page, "body")) && !/5px 5px/.test(sh), "type demo: Calmer keeps today's fonts and softens the button shadow", sh);
  check(/3px/.test(await css(page, ".hero h1", "webkitTextStrokeWidth")), "type demo: Calmer keeps today's headline outline");
  const shadows = await page.evaluate(() => ["#heroForm .btn", ".chip", ".pill", ".site-header .btn", ".site-header .btn--learn", ".btn--vote", ".card", ".try"].map((q) => { const e = document.querySelector(q); return e ? [q, getComputedStyle(e).boxShadow] : [q, "MISSING"]; }));
  check(shadows.every(([, v]) => v !== "MISSING" && !/(\d+)px (\d+)px 0px/.test(v.replace(/rgba?\([^)]*\)/g, "")) || !/ [3-9]px [3-9]px 0px/.test(v)), "type demo: Calmer has no hard offset shadow on buttons, chips, pills and cards", JSON.stringify(shadows));
  check(await page.evaluate(() => localStorage.getItem("boondStyle")) === "calm" && await page.evaluate(() => Object.keys(localStorage).every((k) => k === "boondTheme" || k.startsWith("demo_"))), "type demo: the choice is remembered, under demo-only keys");
  await page.reload(); await page.waitForLoadState("load");
  check(await styleAttr(page) === "calm", "type demo: the style survives a reload");
  await page.click("#cmpFab");
  await page.click("[data-style-choice=today]");
  check(await styleAttr(page) === null && /Fredoka/.test(await fam(page, ".hero h1")), "type demo: Today restores the current look");

  // Headings stay readable without the outline, in both themes
  for (const scheme of ["light", "dark"]) {
    const q = await newPage(390, 844, scheme);
    await q.addInitScript(() => localStorage.setItem("demo_boondStyle", "type"));
    await open(q, "/demo-type/");
    const bgc = await css(q, "body", "backgroundColor");
    const c1 = await css(q, ".hero h1 .l1", "color"), c2 = await css(q, ".hero h1 .l2", "color");
    check(ratio(c1, bgc) >= 4.5, `type demo: hero line one is readable on the page (${scheme})`, `${c1} on ${bgc} = ${ratio(c1, bgc).toFixed(2)}`);
    check(ratio(c2, bgc) >= 3, `type demo: hero line two (large text) is readable on the page (${scheme})`, `${c2} on ${bgc} = ${ratio(c2, bgc).toFixed(2)}`);
    const jb = await q.evaluate(() => getComputedStyle(document.querySelector(".join")).backgroundColor);
    const jc = await css(q, ".join .h2", "color");
    check(ratio(jc, jb) >= 4.5, `type demo: the Join heading is readable on its background (${scheme})`, `${jc} on ${jb} = ${ratio(jc, jb).toFixed(2)}`);
  }

  // Same behavior as the real page, nothing saved, fits small phones in every style and theme
  page = await newPage(390, 844, "light"); await open(page, "/demo-type/");
  await page.waitForFunction(() => document.querySelectorAll("#vlist .vrow").length === 6);
  await page.fill("#heroEmail", "demo@example.com"); await page.check("#heroForm input[name=consent]"); await page.click("#heroForm button[type=submit]"); await page.waitForTimeout(500);
  check(await page.locator("#heroFormJoined").isVisible() && !page.api.calls.some((c) => c.action === "signup"), "type demo: the form works like the real one and nothing reaches the server");
  for (const style of ["today", "type", "calm"]) for (const [w, h, scheme] of [[360, 640, "light"], [390, 844, "dark"]]) {
    const q = await newPage(w, h, scheme);
    await q.addInitScript((st) => { if (st !== "today") localStorage.setItem("demo_boondStyle", st); }, style);
    await open(q, "/demo-type/");
    check(await noSideScroll(q), `type demo: no sideways scroll at ${w}px (${style}, ${scheme})`);
  }
}

// ---------- Demo footers follow the theme ----------
{
  const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const read = (p) => p.evaluate(() => { const f = document.querySelector(".foot"); const g = (q) => getComputedStyle(f.querySelector(q)); return { bg: getComputedStyle(f).backgroundColor, ink: getComputedStyle(f).color, muted: g("p").color, link: g(".foot-links a").color, pressedText: g("[aria-pressed=true] span").color, pressedFill: g("[aria-pressed=true]").backgroundColor }; });
  for (const demo of ["demo-theme", "demo-type"]) {
    const light = await newPage(390, 844, "dark"); await open(light, "/" + demo + "/");
    await light.locator(".foot [data-theme-choice=light]").scrollIntoViewIfNeeded(); await light.locator(".foot [data-theme-choice=light]").click();
    const L = await read(light);
    check(L.bg === "rgb(255, 210, 63)", `${demo}: Light turns the footer yellow, even on a dark system`, L.bg);
    check(ratio(L.ink, L.bg) >= 4.5 && ratio(L.muted, L.bg) >= 4.5 && ratio(L.link, L.bg) >= 4.5, `${demo}: footer text and links are readable in Light`, JSON.stringify(L));
    check(ratio(L.pressedText, L.pressedFill) >= 4.5, `${demo}: the pressed theme button is readable in the Light footer`, `${L.pressedText} on ${L.pressedFill}`);
    await light.locator(".foot [data-theme-choice=dark]").click();
    const D = await read(light);
    check(D.bg === "rgb(58, 42, 22)" && ratio(D.ink, D.bg) >= 4.5 && ratio(D.muted, D.bg) >= 4.5 && ratio(D.pressedText, D.pressedFill) >= 4.5, `${demo}: Dark turns the footer brown and keeps it readable`, JSON.stringify(D));
    await light.locator(".foot [data-theme-choice=auto]").click();
    check((await read(light)).bg === "rgb(58, 42, 22)", `${demo}: Auto follows a dark system with the brown footer`);
    const auto = await newPage(390, 844, "light"); await open(auto, "/" + demo + "/");
    check((await read(auto)).bg === "rgb(255, 210, 63)" && await noSideScroll(auto), `${demo}: Auto follows a light system with the yellow footer, no sideways scroll`);
  }
}

// ---------- Home: Calmer look, Sign in links, and the sign-in pages matching the site ----------
{
  const hard = (v) => v.split(/,(?![^(]*\))/).some((layer) => { const parts = layer.replace(/rgba?\([^)]*\)/g, "").trim().split(/\s+/); return Math.abs(parseFloat(parts[0])) >= 2 && parseFloat(parts[2]) === 0; });
  const home = await newPage(390, 844, "light"); await open(home, "/");
  await home.waitForFunction(() => document.querySelectorAll("#vlist .vrow").length === 6); await home.evaluate(() => document.fonts.ready);
  const shadows = await home.evaluate(() => ["#heroForm .btn", ".chip", ".pill", ".site-header .btn", ".site-header .btn--learn", ".btn--vote", ".card", ".try", ".vrow", ".who-card", ".calc", ".suggest"].map((q) => { const e = document.querySelector(q); return [q, e ? getComputedStyle(e).boxShadow : "MISSING"]; }));
  check(shadows.every(([, v]) => v !== "MISSING" && v !== "none" && !hard(v)), "home calmer: buttons, chips, pill, cards, vote rows and boxes have soft shadows, not hard offsets", JSON.stringify(shadows.filter(([, v]) => v === "MISSING" || v === "none" || hard(v))));
  check(/3px/.test(await home.evaluate(() => getComputedStyle(document.querySelector(".hero h1")).webkitTextStrokeWidth)) && /Fredoka/.test(await home.evaluate(() => getComputedStyle(document.querySelector(".hero h1")).fontFamily)) && /Nunito/.test(await home.evaluate(() => getComputedStyle(document.body).fontFamily)), "home calmer: fonts and the headline outline stay as they were");
  const gaps = await home.evaluate(() => {
    const pad = (sel) => { const c = getComputedStyle(document.querySelector(sel)); return parseFloat(c.paddingTop) + parseFloat(c.paddingBottom); };
    return { hero: parseFloat(getComputedStyle(document.querySelector(".hero")).paddingTop), who: pad(".who"), why: pad(".why"), how: pad(".how"), vote: pad(".vote"), math: pad(".math"), story: pad(".story"), join: pad(".join") };
  });
  check(gaps.hero <= 40 && gaps.who <= 100 && gaps.why <= 110 && gaps.how <= 100 && gaps.vote <= 90 && gaps.math <= 110 && gaps.story <= 110 && gaps.join <= 110, "home calmer: the space above and between sections is tighter", JSON.stringify(gaps));
  await home.click("#burger"); await home.waitForTimeout(500);
  check(await home.locator('.menu nav a[href="/signin/"]').isVisible(), "home sign in: the menu has a Sign in link");
  await home.keyboard.press("Escape"); await home.waitForTimeout(400);
  check(await home.locator('.foot-links a[href="/signin/"]').count() === 1, "home sign in: the footer has a Sign in link");
  await home.fill("#heroEmail", "j@k.co"); await home.check("#heroForm input[name=consent]"); await home.click("#heroForm button[type=submit]"); await home.waitForTimeout(500);
  check(await home.locator('#heroFormJoined a[href="/signin/"]').count() === 1, "home sign in: after joining, the note offers Sign in to see or change picks");
  for (const [w, h, scheme] of [[360, 640, "light"], [390, 844, "dark"], [430, 932, "light"]]) {
    const q = await newPage(w, h, scheme); await open(q, "/");
    check(await noSideScroll(q), `home calmer: no sideways scroll at ${w}px (${scheme})`);
  }

  // the sign-in pages use the site's own header, menu, footer and button styles
  const styleOf = (p) => p.evaluate(() => { const g = (q) => { const e = document.querySelector(q); return e ? getComputedStyle(e) : null; }; const hd = g(".site-header"), ft = g(".foot"), bt = g(".site-header .btn"), jn = g(".site-header .btn:not(.btn--learn)"); return { hdBg: hd.backgroundColor, hdH: hd.height, ftBg: ft.backgroundColor, ftInk: ft.color, btnShadow: bt.boxShadow, btnBorder: jn.borderTopWidth, bodyBg: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.body).fontFamily }; });
  for (const scheme of ["light", "dark"]) {
    const ref = await newPage(390, 844, scheme); await open(ref, "/");
    const R = await styleOf(ref);
    for (const url of ["/signin/", "/me/", "/help/email/"]) {
      const q = await newPage(390, 844, scheme); q.api.respond = () => ({ status: 401, body: { error: "invalid_session" } }); await open(q, url); await q.waitForTimeout(300);
      const A = await styleOf(q);
      check(JSON.stringify(A) === JSON.stringify(R), `site look: ${url} has the same header, footer, button and page colors as the home page (${scheme})`, JSON.stringify([A, R]));
    }
  }
  for (const url of ["/signin/", "/me/", "/help/email/"]) {
    const q = await newPage(390, 844, "light"); q.api.respond = () => ({ status: 401, body: { error: "invalid_session" } }); await open(q, url); await q.waitForTimeout(300);
    const info = await q.evaluate(() => ({ css: !!document.querySelector('link[rel=stylesheet][href="/shell.css"]'), js: !!document.querySelector('script[src="/shell.js"]'), wm: document.querySelector(".site-header .wordmark").getAttribute("href"), learn: document.querySelector(".site-header .btn--learn").getAttribute("href"), join: document.querySelector('.site-header .btn:not(.btn--learn)').getAttribute("href"), foot: !!document.querySelector('.foot-links a[href="/signin/"]') }));
    check(info.css && info.js && info.wm === "/" && info.learn === "/learn/" && info.join === "/#join" && info.foot, `site look: ${url} has the site header (logo, Learn, Join), footer and shared files`, JSON.stringify(info));
    await q.click("#burger"); await q.waitForTimeout(500);
    check(await q.locator('.menu nav a[href="/signin/"]').isVisible() && await q.locator('.menu nav a[href="/#flavors"]').isVisible(), `site look: the menu works on ${url} and links back to the home page sections`);
    await q.keyboard.press("Escape"); await q.waitForTimeout(400);
    check(!(await q.evaluate(() => document.getElementById("menu").classList.contains("open"))), `site look: Escape closes the menu on ${url}`);
  }
}

// ---------- Home: Sign in button, back-to-top button, Auto / Light / Dark switch ----------
{
  const bg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const LIGHT = "rgb(255, 242, 214)", DARK = "rgb(30, 22, 12)";
  const attr = (p) => p.evaluate(() => document.documentElement.getAttribute("data-theme"));
  const pressed = (p, scope) => p.evaluate((sc) => [...document.querySelectorAll(sc + " [data-theme-choice]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("data-theme-choice")).join(","), scope);
  const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const foot = (p) => p.evaluate(() => { const f = document.querySelector(".foot"); const g = (q) => getComputedStyle(f.querySelector(q)); return { bg: getComputedStyle(f).backgroundColor, ink: getComputedStyle(f).color, muted: g("p").color, link: g(".foot-links a").color, pt: g("[aria-pressed=true] span").color, pf: g("[aria-pressed=true]").backgroundColor }; });

  // ---- hero: Sign in next to Vote
  let page = await newPage(390, 844, "light"); await open(page, "/");
  await page.waitForFunction(() => document.querySelectorAll("#vlist .vrow").length === 6);
  const ha = await page.evaluate(() => { const v = document.querySelector("#voteJump").getBoundingClientRect(), s = document.querySelector("#signInBtn").getBoundingClientRect(); const a = document.querySelector("#signInBtn"); return { inActions: !!document.querySelector(".hero-actions #voteJump") && !!document.querySelector(".hero-actions #signInBtn"), href: a.getAttribute("href"), label: document.getElementById("signInLabel").textContent, signTop: s.top, voteTop: v.top, aboveFold: s.bottom < innerHeight, bg: getComputedStyle(a).backgroundColor, pink: getComputedStyle(document.querySelector(".site-header .btn:not(.btn--learn)")).backgroundColor }; });
  check(ha.inActions && ha.href === "/signin/" && ha.label === "Sign in", "sign in button: it sits with the Vote button and goes to /signin/", JSON.stringify(ha));
  check(ha.aboveFold, "sign in button: it is visible on the first screen of a phone, without scrolling", JSON.stringify(ha));
  check(ha.bg !== ha.pink, "sign in button: it is a quiet (cream) button, so Join stays the main call to action", ha.bg);
  const wide = await newPage(1100, 800, "light"); await open(wide, "/");
  check(await wide.evaluate(() => { const v = document.querySelector("#voteJump").getBoundingClientRect(), s = document.querySelector("#signInBtn").getBoundingClientRect(); return Math.abs(v.top - s.top) < 8; }), "sign in button: on a wide screen it sits on the same row as Vote");
  const signed = await newPage(390, 844, "light"); await signed.addInitScript(() => localStorage.setItem("boondSession", "x")); await open(signed, "/");
  check(await signed.textContent("#signInLabel") === "My Boond" && await signed.getAttribute("#signInBtn", "href") === "/me/", "sign in button: a signed-in browser sees My Boond, which goes to /me/");
  await page.click("#voteJump"); await page.waitForTimeout(900);
  check(await page.evaluate(() => document.getElementById("vote").getBoundingClientRect().top < 300), "sign in button: the Vote button still scrolls to the vote");

  // ---- back to top
  page = await newPage(390, 844, "light"); await open(page, "/");
  const topState = async () => page.evaluate(() => { const b = document.getElementById("toTop"); const c = getComputedStyle(b); return { visible: c.visibility === "visible" && parseFloat(c.opacity) > 0.5, cls: b.classList.contains("show"), y: Math.round(scrollY) }; });
  check(!(await topState()).visible, "back to top: the button is hidden at the top of the page");
  await page.evaluate(() => window.scrollTo({ top: 1500, behavior: "instant" })); await page.waitForTimeout(500);
  check((await topState()).visible, "back to top: the button appears once you have scrolled down");
  const tb = await page.evaluate(() => { const r = document.getElementById("toTop").getBoundingClientRect(); return { r: r.right, b: r.bottom, w: r.width, h: r.height, label: document.getElementById("toTop").getAttribute("aria-label") }; });
  check(tb.r <= 390 && tb.b <= 844 && tb.w >= 44 && tb.h >= 44 && tb.label === "Back to top", "back to top: it sits inside the phone screen, is a big enough tap target, and has a label", JSON.stringify(tb));
  await page.click("#toTop"); await page.waitForFunction(() => scrollY < 5, null, { timeout: 8000 }).catch(() => {});
  check((await topState()).y < 5 && !(await topState()).visible, "back to top: tapping it returns to the top and the button hides again");
  await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" })); await page.waitForTimeout(400);
  check(!(await topState()).visible, "back to top: a short scroll does not show it");

  // ---- theme switch
  page = await newPage(390, 844, "light"); await open(page, "/");
  check(await bg(page) === LIGHT && await pressed(page, ".foot") === "auto" && (await foot(page)).bg === "rgb(255, 210, 63)", "theme: Auto on a light system is the cream page with the yellow footer");
  await page.emulateMedia({ colorScheme: "dark" });
  check(await bg(page) === DARK && (await foot(page)).bg === "rgb(58, 42, 22)", "theme: Auto follows the system into dark (brown footer)");
  await page.emulateMedia({ colorScheme: "light" });
  await page.locator(".foot [data-theme-choice=dark]").scrollIntoViewIfNeeded(); await page.locator(".foot [data-theme-choice=dark]").click();
  check(await attr(page) === "dark" && await bg(page) === DARK && (await foot(page)).bg === "rgb(58, 42, 22)", "theme: Dark overrides a light system, footer included");
  check(await pressed(page, ".foot") === "dark" && await pressed(page, ".menu") === "dark", "theme: the footer and menu controls stay in sync");
  check(await page.evaluate(() => localStorage.getItem("boondTheme")) === "dark", "theme: the choice is remembered in this browser");
  await page.reload(); await page.waitForLoadState("load");
  check(await attr(page) === "dark" && await bg(page) === DARK, "theme: the choice survives a reload");
  const D = await foot(page);
  check(ratio(D.ink, D.bg) >= 4.5 && ratio(D.muted, D.bg) >= 4.5 && ratio(D.link, D.bg) >= 4.5 && ratio(D.pt, D.pf) >= 4.5, "theme: the dark footer is readable", JSON.stringify(D));
  await page.locator(".foot [data-theme-choice=light]").scrollIntoViewIfNeeded(); await page.locator(".foot [data-theme-choice=light]").click();
  const L = await foot(page);
  check(await bg(page) === LIGHT && L.bg === "rgb(255, 210, 63)" && ratio(L.ink, L.bg) >= 4.5 && ratio(L.muted, L.bg) >= 4.5 && ratio(L.link, L.bg) >= 4.5 && ratio(L.pt, L.pf) >= 4.5, "theme: Light gives the cream page and a readable yellow footer, even on a dark system");
  await page.locator(".foot [data-theme-choice=auto]").click();
  check(await attr(page) === null && await page.evaluate(() => localStorage.getItem("boondTheme")) === null, "theme: Auto removes the saved choice");

  // ---- the menu on a short phone: nothing is cut off
  const short = await newPage(360, 640, "light"); await open(short, "/");
  await short.click("#burger"); await short.waitForTimeout(500);
  await short.locator(".menu [data-theme-choice=dark]").scrollIntoViewIfNeeded(); await short.waitForTimeout(200);
  const rect = await short.locator(".menu [data-theme-choice=dark]").boundingBox();
  check(rect && rect.y >= 0 && rect.y + rect.height <= 640 && await short.evaluate(() => getComputedStyle(document.getElementById("menu")).overflowY === "auto"), "menu: on a short phone it scrolls, so the theme control can always be reached", JSON.stringify(rect));
  await short.locator(".menu [data-theme-choice=dark]").click();
  check(await attr(short) === "dark", "menu: the theme control works from the menu on a short phone");

  // ---- the same switch and button on the sign-in pages, and the choice follows you between pages
  for (const url of ["/signin/", "/me/", "/help/email/"]) {
    const q = await newPage(390, 844, "light"); q.api.respond = () => ({ status: 401, body: { error: "invalid_session" } }); await open(q, url); await q.waitForTimeout(300);
    check(await q.locator(".menu [data-theme-choice]").count() === 3 && await q.locator(".foot [data-theme-choice]").count() === 3 && await q.locator("#toTop").count() === 1, `site look: ${url} has the theme switch (menu and footer) and the back-to-top button`);
    await q.locator(".foot [data-theme-choice=dark]").scrollIntoViewIfNeeded(); await q.locator(".foot [data-theme-choice=dark]").click();
    const f = await q.evaluate(() => getComputedStyle(document.querySelector(".foot")).backgroundColor);
    check(await attr(q) === "dark" && await bg(q) === DARK && f === "rgb(58, 42, 22)", `site look: Dark works on ${url}`);
  }
  const hop = await newPage(390, 844, "light"); hop.api.respond = () => ({ status: 401, body: { error: "invalid_session" } });
  await open(hop, "/signin/"); await hop.locator(".foot [data-theme-choice=dark]").scrollIntoViewIfNeeded(); await hop.locator(".foot [data-theme-choice=dark]").click();
  await hop.goto(BASE + "/"); await hop.waitForLoadState("load");
  check(await attr(hop) === "dark" && await bg(hop) === DARK, "site look: a theme chosen on the sign-in page carries over to the home page");
  for (const [w, h, scheme, choice] of [[360, 640, "light", null], [360, 640, "dark", null], [390, 844, "dark", "light"], [390, 844, "light", "dark"], [1100, 800, "light", null]]) {
    const q = await newPage(w, h, scheme);
    if (choice) await q.addInitScript((c) => localStorage.setItem("boondTheme", c), choice);
    await open(q, "/");
    check(await noSideScroll(q), `theme: no sideways scroll on the home page at ${w}px (${scheme}${choice ? ", forced " + choice : ""})`);
  }
}

// ---------- Type demo: founder note and FAQ (demo page only; the real home page is untouched) ----------
{
  const file = fs.readFileSync(path.join(ROOT, "demo-type", "index.html"), "utf8");
  const real = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  check(!/id="founder"|id="faq"|founder\.jpg|demo-type/.test(real), "founder/faq: the real home page has no founder note, no FAQ, no photo and no link to the demo");
  const grab = (re) => (file.match(re) || [""])[0];
  const founder = grab(/<section class="founder"[\s\S]*?<\/section>/), faq = grab(/<section class="faq"[\s\S]*?<\/section>/);
  check(founder.length > 200 && faq.length > 200, "founder/faq: the demo has the founder note and the FAQ");
  const words = /\b(healthy|electrolytes?|gut|digest\w*|immun\w*|energy|detox\w*|gentle|buy|sister|stick|sticks|powder|concentrate|packet|recovery|prebiotic)\b/i;
  const plain = (h) => h.replace(/<[^>]+>/g, " ");
  check(!words.test(plain(founder)) && !words.test(plain(faq)), "founder/faq: no health claims, no product-format words, no family mentions", (plain(founder) + plain(faq)).match(words)?.[0]);
  check(/targets while we test/.test(faq) && /isn't for sale yet|It isn't for sale/.test(faq), "founder/faq: the FAQ says the numbers are targets while we test, and that it is not for sale yet");
  check((faq.match(/<details>/g) || []).length === 8, "founder/faq: the FAQ has eight questions");

  const page = await newPage(390, 844, "light");
  check(await open(page, "/demo-type/") === 200 && page.errors.length === 0, "founder/faq: the demo still loads without errors", page.errors.join(" | "));
  const order = await page.evaluate(() => [...document.querySelectorAll("main > section")].map((x) => x.id || x.className.split(" ")[0]));
  check(order[0] === "hero" && order[1] === "founder" && order[2] === "flavors", "founder/faq: the founder note sits right under the hero", order.slice(0, 4).join(" > "));
  check(order.indexOf("story") < order.indexOf("faq") && order.indexOf("faq") + 1 === order.indexOf("join"), "founder/faq: the FAQ sits after the story form and before Join", order.join(" > "));
  await page.locator("#founder img").scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
  const img = await page.evaluate(() => { const i = document.querySelector("#founder img"); return { ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth, alt: i.alt, l: i.getBoundingClientRect().left, r: i.getBoundingClientRect().right }; });
  check(img.ok && img.w === 640 && img.alt.length > 10 && img.l >= 0 && img.r <= 390, "founder/faq: the photo loads, has alt text and fits the phone", JSON.stringify(img));

  const open0 = await page.evaluate(() => [...document.querySelectorAll("#faq details")].filter((d) => d.open).length);
  await page.locator("#faq details").first().scrollIntoViewIfNeeded();
  await page.locator("#faq summary").first().click();
  const afterClick = await page.evaluate(() => [...document.querySelectorAll("#faq details")].map((d) => d.open));
  check(open0 === 0 && afterClick[0] === true && afterClick.slice(1).every((o) => o === false), "founder/faq: questions start closed and one opens on tap");
  await page.locator("#faq summary").nth(1).focus(); await page.keyboard.press("Enter");
  check(await page.evaluate(() => document.querySelectorAll("#faq details")[1].open), "founder/faq: a question opens from the keyboard");
  await page.locator("#faq summary").first().click();
  check(!(await page.evaluate(() => document.querySelectorAll("#faq details")[0].open)), "founder/faq: a question closes on a second tap");

  // fonts follow the chosen style, and the text stays readable in both themes
  const fam = (p, sel) => p.evaluate((q) => getComputedStyle(document.querySelector(q)).fontFamily, sel);
  check(/Fredoka/.test(await fam(page, "#faq summary")) && /Fredoka/.test(await fam(page, "#founder .h2")), "founder/faq: Today uses Fredoka for the new headings");
  await page.click("#cmpFab"); await page.click("[data-style-choice=type]");
  check(/Bricolage/.test(await fam(page, "#faq summary")) && /Bricolage/.test(await fam(page, "#founder .h2")) && /Figtree/.test(await fam(page, "#faq details p")), "founder/faq: New type switches the new sections too");
  const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const scheme of ["light", "dark"]) {
    const q = await newPage(390, 844, scheme); await open(q, "/demo-type/");
    const c = await q.evaluate(() => { const d = document.querySelector("#faq details"); const sm = d.querySelector("summary"); const p = d.querySelector("p"); const body = document.querySelector("#founder .founder-body p:nth-of-type(2)"); return { dbg: getComputedStyle(d).backgroundColor, sc: getComputedStyle(sm).color, pc: getComputedStyle(p).color, bodyBg: getComputedStyle(document.body).backgroundColor, fc: getComputedStyle(body).color }; });
    check(ratio(c.sc, c.dbg) >= 4.5 && ratio(c.pc, c.dbg) >= 4.5 && ratio(c.fc, c.bodyBg) >= 4.5, `founder/faq: the new sections are readable (${scheme})`, JSON.stringify(c));
  }
  // wide screens
  const wide = await newPage(1100, 800, "light"); await open(wide, "/demo-type/");
  check(await wide.evaluate(() => { const i = document.querySelector("#founder img").getBoundingClientRect(), t = document.querySelector("#founder .founder-body").getBoundingClientRect(); return t.left > i.right; }) && await noSideScroll(wide), "founder/faq: on a wide screen the photo and text sit side by side, no sideways scroll");
}

// ---------- Sign-in (magic link), My Boond, and the email-help page ----------
{
  const T = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
  const SESSION = "SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS";
  const files = Object.fromEntries(["signin", "me", "help/email"].map((d) => [d, fs.readFileSync(path.join(ROOT, d, "index.html"), "utf8")]));
  const real = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  check(Object.values(files).every((f) => /name="robots" content="noindex"/.test(f)), "signin/me/help: not indexed by search engines for now");
  check(/href="\/signin\/"/.test(real) && !/href="\/me\//.test(real), "signin/me/help: the home page links to Sign in (menu and footer), and My Boond is reached from there");
  const firstStyle = (f) => Math.min(...["rel=\"stylesheet\"", "<style"].map((k) => f.indexOf(k)).filter((i) => i >= 0));
  check(Object.values(files).every((f) => f.indexOf('localStorage.getItem("boondTheme")') < firstStyle(f)), "signin/me/help: the saved theme is applied before the styles load");
  const words = /\b(healthy|electrolytes?|gut|digest\w*|immun\w*|energy|detox\w*|gentle|buy|stick|sticks|powder|concentrate|packet|recovery|prebiotic)\b/i;
  check(Object.values(files).every((f) => !words.test(f.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " "))), "signin/me/help: no health claims and no product-format words");

  // ---- /signin/
  let page = await newPage(390, 844, "light");
  check(await open(page, "/signin/") === 200 && page.errors.length === 0, "signin: loads without errors", page.errors.join(" | "));
  await page.fill("#email", "not-an-email"); await page.click("#go");
  check((await page.textContent("#msg")).includes("valid email") && !page.api.calls.some((c) => c.action === "signin_request"), "signin: a bad address is refused and nothing is sent");
  await page.fill("#email", "Me@Example.com"); await page.click("#go"); await page.waitForTimeout(400);
  const sc = page.api.calls.find((c) => c.action === "signin_request");
  check(sc && sc.email === "Me@Example.com" && sc.website === "", "signin: sends the address and an empty spam-trap field", JSON.stringify(sc));
  check(await page.locator("#sent").isVisible() && await page.locator("#ask").isHidden(), "signin: shows 'Check your email' after sending");
  check((await page.textContent("#sent")).includes("If that address is on the Boond list") && await page.locator('#sent a[href="/help/email/"]').count() === 1, "signin: the message does not reveal who is on the list, and links to the email help");
  await page.click("#again");
  check(await page.locator("#ask").isVisible() && (await page.inputValue("#email")) === "", "signin: 'Use a different email' brings the form back, empty");
  page.api.respond = (b) => b.action === "signin_request" ? { status: 500, body: { error: "server_error" } } : null;
  await page.fill("#email", "me@example.com"); await page.click("#go"); await page.waitForTimeout(400);
  check((await page.textContent("#msg")).includes("Something went wrong") && await page.locator("#sent").isHidden(), "signin: a server problem shows a friendly message");
  const signed = await newPage(390, 844, "light");
  await signed.addInitScript(() => localStorage.setItem("boondSession", "x"));
  await open(signed, "/signin/");
  check(await signed.locator("#already").isVisible(), "signin: a signed-in browser is offered My Boond");

  // ---- /me/
  const meOpen = async (url, respond, init) => { const p = await newPage(390, 844, "light"); if (init) await p.addInitScript(init); p.api.respond = respond; await open(p, url); await p.waitForTimeout(500); return p; };
  const good = (b) => ({ signin_redeem: { body: { ok: true, session: SESSION, expires_at: "2099-01-01T00:00:00Z" } }, me_get: { body: { ok: true, email: "someone-with-a-rather-long-address@example-domain.com", flavors: ["mango", "lemon"], subscribed: true, joined: "2026-11-22T00:00:00Z" } }, me_update: { body: { ok: true } }, me_prefs: { body: { ok: true } }, signout: { body: { ok: true } }, me_delete: { body: { ok: true } } })[b.action] || null;

  page = await meOpen("/me/", good);
  check(await page.locator("#vOut").isVisible() && await page.locator('#vOut a[href="/signin/"]').count() === 1 && page.api.calls.length === 0, "me: with no link and no session it asks you to sign in, and sends nothing");

  page = await meOpen("/me/#t=" + T, good);
  const redeem = page.api.calls.find((c) => c.action === "signin_redeem");
  check(redeem && redeem.token === T, "me: a sign-in link sends its token once", JSON.stringify(redeem));
  check(!page.url().includes("#t=") && !page.url().includes(T), "me: the token is removed from the address bar", page.url());
  check(await page.evaluate(() => localStorage.getItem("boondSession")) === SESSION, "me: the session is kept in this browser");
  const mg = page.api.calls.find((c) => c.action === "me_get");
  check(mg && mg.session === SESSION && await page.locator("#vIn").isVisible(), "me: loads the profile with the session");
  check((await page.textContent("#who")).includes("someone-with-a-rather-long-address@example-domain.com"), "me: shows the signed-in email");
  check(await page.evaluate(() => [...document.querySelectorAll('#picks input:checked')].map((i) => i.value).join()) === "mango,lemon" && await page.isChecked("#subscribed"), "me: shows the saved picks and email setting");
  check(await noSideScroll(page), "me: a long email does not cause sideways scroll at 390px");

  await page.uncheck('#picks input[value=lemon]'); await page.check('#picks input[value=guava]'); await page.click("#savePicks"); await page.waitForTimeout(400);
  const up = page.api.calls.find((c) => c.action === "me_update");
  check(up && up.session === SESSION && [...up.flavors].sort().join() === "guava,mango", "me: saving picks sends the chosen flavors", JSON.stringify(up));
  check((await page.textContent("#picksMsg")).includes("Saved"), "me: tells you the picks are saved");
  await page.uncheck("#subscribed"); await page.click("#savePrefs"); await page.waitForTimeout(400);
  const pf = page.api.calls.find((c) => c.action === "me_prefs");
  check(pf && pf.subscribed === false && (await page.textContent("#prefsMsg")).includes("won't email"), "me: turning emails off is sent and confirmed");

  await page.click("#delAsk");
  check(await page.locator("#delBox").isVisible(), "me: 'Delete my data' asks first");
  await page.click("#delNo");
  check(await page.locator("#delBox").isHidden() && !page.api.calls.some((c) => c.action === "me_delete"), "me: 'Keep my data' cancels, nothing is deleted");
  await page.click("#delAsk"); await page.click("#delYes"); await page.waitForTimeout(400);
  const dl = page.api.calls.find((c) => c.action === "me_delete");
  check(dl && dl.confirm === true && await page.locator("#vGone").isVisible() && await page.evaluate(() => localStorage.getItem("boondSession")) === null, "me: confirmed delete is sent, the browser forgets the session, and a goodbye page shows");

  page = await meOpen("/me/", good, () => localStorage.setItem("boondSession", "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT"));
  check(await page.locator("#vIn").isVisible() && page.api.calls[0].action === "me_get" && page.api.calls[0].session === "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT", "me: a returning browser goes straight to the profile");
  await page.click("#signout"); await page.waitForTimeout(400);
  check(page.api.calls.some((c) => c.action === "signout") && await page.locator("#vOut").isVisible() && await page.evaluate(() => localStorage.getItem("boondSession")) === null, "me: signing out ends the session here and on the server");

  page = await meOpen("/me/", (b) => b.action === "me_get" ? { status: 401, body: { error: "invalid_session" } } : null, () => localStorage.setItem("boondSession", "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT"));
  check(await page.locator("#vOut").isVisible() && (await page.textContent("#outMsg")).includes("expired") && await page.evaluate(() => localStorage.getItem("boondSession")) === null, "me: an expired session says so and is cleared");
  page = await meOpen("/me/#t=" + T, (b) => b.action === "signin_redeem" ? { status: 400, body: { error: "invalid_token" } } : null);
  check(await page.locator("#vOut").isVisible() && (await page.textContent("#outMsg")).includes("expired or was already used") && await page.evaluate(() => localStorage.getItem("boondSession")) === null, "me: a used or old link explains itself and offers a new one");
  page = await meOpen("/me/#t=tooshort", good);
  check(await page.locator("#vOut").isVisible() && !page.api.calls.some((c) => c.action === "signin_redeem"), "me: a malformed link sends nothing");

  // ---- /help/email/
  page = await newPage(390, 844, "light");
  check(await open(page, "/help/email/") === 200 && page.errors.length === 0, "help: loads without errors", page.errors.join(" | "));
  const hl = await page.evaluate(() => ({ steps: document.querySelectorAll("ol > li").length, text: document.body.innerText, ext: [...document.querySelectorAll("a[href^=http]")].map((a) => new URL(a.href).hostname) }));
  check(hl.steps === 4 && hl.text.includes("hello@boondsips.com") && /Not spam/.test(hl.text) && /Not junk/.test(hl.text), "help: four steps, the sender address, and both common button names");
  check(hl.ext.every((h) => h === "www.instagram.com"), "help: the only outside link is Instagram, no unverified provider links", hl.ext.join());

  // ---- small phones and dark mode
  for (const [u, w, h, scheme] of [["/signin/", 360, 640, "light"], ["/signin/", 390, 844, "dark"], ["/me/", 360, 640, "dark"], ["/help/email/", 360, 640, "light"], ["/help/email/", 390, 844, "dark"]]) {
    const q = await newPage(w, h, scheme); q.api.respond = good; await q.addInitScript(() => localStorage.setItem("boondSession", "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT"));
    await open(q, u); await q.waitForTimeout(300);
    check(await noSideScroll(q), `signin/me/help: no sideways scroll on ${u} at ${w}px (${scheme})`);
  }
}

// ---------- Type demo: Calmer spacing ----------
{
  const measure = async (style) => {
    const q = await newPage(390, 844, "light");
    await q.addInitScript((st) => { if (st !== "today") localStorage.setItem("demo_boondStyle", st); }, style);
    await open(q, "/demo-type/"); await q.waitForFunction(() => document.querySelectorAll("#vlist .vrow").length === 6); await q.evaluate(() => document.fonts.ready); await q.waitForTimeout(500);
    return q.evaluate(() => {
      const top = (sel) => document.querySelector(sel).getBoundingClientRect().top + scrollY;
      const pad = (sel) => { const c = getComputedStyle(document.querySelector(sel)); return [parseFloat(c.paddingTop), parseFloat(c.paddingBottom)]; };
      const hdr = document.querySelector(".site-header").getBoundingClientRect().height;
      return { total: document.documentElement.scrollHeight, heroPill: top(".pill") - hdr - document.querySelector(".demo-strip").getBoundingClientRect().height, pillToEyebrow: document.querySelector(".hero .eyebrow").getBoundingClientRect().top - document.querySelector(".pill").getBoundingClientRect().bottom, eyebrowToH1: document.querySelector(".hero h1").getBoundingClientRect().top - document.querySelector(".hero .eyebrow").getBoundingClientRect().bottom, who: pad(".who"), why: pad(".why"), how: pad(".how"), math: pad(".math"), vote: pad(".vote"), faq: pad(".faq"), join: pad(".join") };
    });
  };
  const T0 = await measure("today"), C = await measure("calm");
  console.log("   spacing today:", JSON.stringify({ total: T0.total, heroPill: T0.heroPill, who: T0.who, why: T0.why, vote: T0.vote }));
  console.log("   spacing calmer:", JSON.stringify({ total: C.total, heroPill: C.heroPill, who: C.who, why: C.why, vote: C.vote }));
  check(C.heroPill < T0.heroPill * 0.7, "type demo: Calmer shrinks the gap between the top bar and 'Launching soon'", `${T0.heroPill} -> ${C.heroPill}`);
  check(C.pillToEyebrow < T0.pillToEyebrow && C.eyebrowToH1 < T0.eyebrowToH1, "type demo: Calmer tightens the space around 'Salty sweet, by the drop'", `${T0.pillToEyebrow}/${T0.eyebrowToH1} -> ${C.pillToEyebrow}/${C.eyebrowToH1}`);
  check(["who", "why", "how", "math", "vote", "faq", "join"].every((k) => C[k][0] + C[k][1] < T0[k][0] + T0[k][1]), "type demo: Calmer cuts the padding of every section", JSON.stringify([T0.who, C.who]));
  check(C.total < T0.total * 0.95, "type demo: Calmer makes the whole page at least 5 percent shorter", `${T0.total} -> ${C.total}`);
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
