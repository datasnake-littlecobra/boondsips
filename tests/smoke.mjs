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

await browser.close();
server.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
