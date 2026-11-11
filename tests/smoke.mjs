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

// ---------- Config ----------
{
  const page = await newPage(390);
  await open(page, "/learn/");
  await page.addScriptTag({ url: `${BASE}/learn/config.js` });
  const donate = await page.evaluate(() => window.MIP_CONFIG && window.MIP_CONFIG.donateUrl);
  check(donate === "", "donateUrl is empty by default", JSON.stringify(donate));
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
