const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "docs", "screenshots");
const BASE = process.env.SOMACUE_BASE_URL || "http://localhost:3100/";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const errors = [];

const chromeCandidates = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const CHROME = chromeCandidates.find((candidate) => fs.existsSync(candidate));

if (!CHROME) {
  console.error(
    "Chrome was not found. Set CHROME_PATH to a Chrome or Chromium executable and retry.",
  );
  process.exit(1);
}

function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function stateLabel(page) {
  return page.$eval('[role="status"]', (el) => (el.textContent || "").trim());
}

async function waitState(page, re, timeout = 40000) {
  await page.waitForFunction(
    (source) => new RegExp(source).test(document.querySelector('[role="status"]')?.textContent || ""),
    { timeout },
    re.source,
  );
}

async function readTime(page) {
  const text = await page.$eval("output", (el) => el.textContent || "");
  const match = text.match(/([\d.]+)/);
  return match ? Number(match[1]) : NaN;
}

async function waitForImage(page) {
  await page.waitForFunction(
    () => {
      const img = document.querySelector("img");
      return Boolean(img && img.complete && img.naturalWidth > 0);
    },
    { timeout: 30000 },
  );
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  console.log(`Verifying ${BASE} with ${CHROME}`);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });

  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`PAGE: ${err.message}`));

  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await page.evaluate(() => localStorage.removeItem("somacue.theme"));
  await page.reload({ waitUntil: "networkidle0" });
  await waitState(page, /Paused|Failed/);
  await sleep(1800);

  check("desktop defaults to light", (await page.evaluate(() => document.documentElement.dataset.theme)) === "light");
  check("movement starts paused", (await stateLabel(page)) === "Paused");
  check("no horizontal overflow at 1440", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(SHOTS, "desktop-light.png") });

  // Theme toggle and persistence
  await page.click('button[aria-label="Switch colour theme"]');
  await sleep(200);
  check("theme toggles to dark", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  await page.screenshot({ path: path.join(SHOTS, "desktop-dark.png") });
  await page.reload({ waitUntil: "networkidle0" });
  await waitState(page, /Paused|Failed/);
  check("dark choice persists after reload", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  await page.click('button[aria-label="Switch colour theme"]');
  await sleep(200);
  check("theme toggles back to light", (await page.evaluate(() => document.documentElement.dataset.theme)) === "light");

  // Asset notes dialog
  await page.click("button::-p-text(Asset notes)");
  await sleep(300);
  check("asset notes dialog opens", await page.evaluate(() => document.querySelector("dialog")?.open === true));
  await page.keyboard.press("Escape");
  await sleep(300);
  check("asset notes closes with Escape", await page.evaluate(() => document.querySelector("dialog")?.open === false));

  // Movement transport
  await page.click("button::-p-text(Play)");
  await sleep(700);
  const playingLabel = await stateLabel(page);
  const t1 = await readTime(page);
  check("play advances the clip", playingLabel === "Playing" && t1 > 0.1, `state=${playingLabel} time=${t1}`);

  await page.click("button::-p-text(Pause)");
  const pausedTime = await readTime(page);
  await sleep(450);
  const stillTime = await readTime(page);
  check("pause stops the clip", Math.abs(stillTime - pausedTime) < 0.02, `${pausedTime} -> ${stillTime}`);

  // Scrub
  await page.$eval('input[type="range"]', (el) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, "1.42");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(300);
  const scrubbed = await readTime(page);
  check("scrub seeks the clip", Math.abs(scrubbed - 1.42) < 0.08, `time=${scrubbed}`);

  // Speed affects playback rate only
  await page.select("select", "0.5");
  await page.click("button::-p-text(Play)");
  await sleep(1200);
  await page.click("button::-p-text(Pause)");
  const slowAdvance = (await readTime(page)) - scrubbed;
  check("0.5x speed advances at about half rate", slowAdvance > 0.25 && slowAdvance < 0.85, `advanced ${slowAdvance.toFixed(2)} s in 1.2 s`);

  // Replay
  await page.click("button::-p-text(Replay)");
  await sleep(250);
  const replayTime = await readTime(page);
  check("replay restarts the clip", replayTime < 0.5, `time=${replayTime}`);
  await page.click("button::-p-text(Pause)");

  // Text view
  await page.click("button::-p-text(Text view)");
  await waitForImage(page);
  const imgInfo = await page.$eval("img", (el) => ({
    src: el.getAttribute("src"),
    width: el.naturalWidth,
    height: el.naturalHeight,
  }));
  check(
    "text view shows the captured still",
    imgInfo.width > 0 && imgInfo.height > 0 && Math.abs(imgInfo.width / imgInfo.height - 1200 / 900) < 0.02,
    JSON.stringify(imgInfo),
  );
  check(
    "text view explains that it is a static view",
    await page.$eval('[aria-label="Static model view"]', (el) => el.textContent?.includes("Static view") === true),
  );
  await page.screenshot({ path: path.join(SHOTS, "desktop-static.png") });
  await page.click("button::-p-text(3D view)");
  await waitState(page, /Paused|Interactive/);
  await sleep(800);

  // Anatomy tab, URL and presets
  await page.click('[role="tab"]:nth-of-type(2)');
  await waitState(page, /Interactive|Failed/);
  await sleep(1200);
  check("anatomy tab is selected", await page.evaluate(() => document.querySelectorAll('[role="tab"]')[1]?.getAttribute("aria-selected") === "true"));
  check("URL records the anatomy view", (await page.evaluate(() => location.search)) === "?view=anatomy");
  await page.screenshot({ path: path.join(SHOTS, "desktop-light-anatomy.png") });

  const before = await page.screenshot({ encoding: "base64" });
  await page.click("button::-p-text(Side)");
  await sleep(900);
  const after = await page.screenshot({ encoding: "base64" });
  check("side preset changes the camera", before !== after);
  await page.click("button::-p-text(Reset view)");
  await sleep(900);
  await page.click('button[aria-label="Zoom in"]');
  await sleep(600);
  const zoomed = await page.screenshot({ encoding: "base64" });
  await page.click('button[aria-label="Zoom out"]');
  await sleep(600);
  const unzoomed = await page.screenshot({ encoding: "base64" });
  check("zoom controls change the camera", zoomed !== unzoomed);

  // Reload the anatomy URL directly
  await page.reload({ waitUntil: "networkidle0" });
  await waitState(page, /Interactive|Failed/);
  check("anatomy URL restores on reload", await page.evaluate(() => document.querySelectorAll('[role="tab"]')[1]?.getAttribute("aria-selected") === "true"));

  // Keyboard tabs
  await page.focus('[role="tab"]:nth-of-type(1)');
  await page.keyboard.press("ArrowRight");
  await sleep(300);
  check("arrow keys move between stage tabs", await page.evaluate(() => document.activeElement?.textContent?.trim() === "Anatomy"));

  // Completion persistence
  await page.click("button::-p-text(Mark demo complete)");
  await sleep(200);
  check("completion toggles on", await page.evaluate(() => document.querySelector('button[aria-pressed="true"]')?.textContent?.includes("Demo complete") === true));
  await page.reload({ waitUntil: "networkidle0" });
  await waitState(page, /Interactive|Failed/);
  check("completion persists on this device", await page.evaluate(() => document.querySelector('button[aria-pressed="true"]')?.textContent?.includes("Demo complete") === true));
  await page.click("button::-p-text(Demo complete)");
  await sleep(200);
  check("completion can be cleared", await page.evaluate(() => document.querySelector('button[aria-pressed="false"]') !== null));

  // Mobile layout
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.evaluate(() => localStorage.removeItem("somacue.theme"));
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await waitState(page, /Paused|Failed/);
  await sleep(1400);
  const mobile = await page.evaluate(() => {
    const stage = document.querySelector('[aria-label="3D demonstration stage"]')?.getBoundingClientRect();
    const guidance = document.querySelector("aside")?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      docWidth: document.documentElement.scrollWidth,
      innerWidth,
      stageTop: stage?.top,
      stageBottom: stage?.bottom,
      guidanceTop: guidance?.top,
      stageWidth: stage?.width,
    };
  });
  check("mobile has no horizontal overflow", !mobile.overflow, JSON.stringify(mobile));
  check("mobile stacks the stage above guidance", mobile.stageBottom <= mobile.guidanceTop + 1, JSON.stringify(mobile));
  await page.screenshot({ path: path.join(SHOTS, "mobile-light.png"), fullPage: true });

  // 320px overflow
  await page.setViewport({ width: 320, height: 720, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: "networkidle0" });
  await waitState(page, /Paused|Failed/);
  check("no horizontal overflow at 320px", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), await page.evaluate(() => `${document.documentElement.scrollWidth}/${innerWidth}`));

  // Reduced motion
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.reload({ waitUntil: "networkidle0" });
  await waitState(page, /Paused|Failed/);
  check("reduced motion is reported", await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches));

  // Failure state: block the GLB
  const failPage = await browser.newPage();
  failPage.on("pageerror", (err) => errors.push(`FAIL PAGE: ${err.message}`));
  await failPage.setViewport({ width: 1440, height: 900 });
  await failPage.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await failPage.setRequestInterception(true);
  failPage.on("request", (request) => {
    if (request.url().endsWith(".glb")) request.abort();
    else request.continue();
  });
  await failPage.goto(BASE, { waitUntil: "networkidle0" });
  await waitState(failPage, /Failed/);
  await sleep(500);
  check("GLB failure shows the failed state", (await stateLabel(failPage)) === "Failed");
  await failPage.screenshot({ path: path.join(SHOTS, "desktop-failure.png") });
  await failPage.click("button::-p-text(Text view)");
  await waitForImage(failPage);
  check(
    "failure offers a still fallback",
    await failPage.$eval("img", (el) => el.complete && el.naturalWidth > 0 && Math.abs(el.naturalWidth / el.naturalHeight - 1200 / 900) < 0.02),
  );

  // WebGL unavailable
  const noGlPage = await browser.newPage();
  await noGlPage.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await noGlPage.setViewport({ width: 1440, height: 900 });
  await noGlPage.evaluateOnNewDocument(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      return original.call(this, type, ...args);
    };
  });
  await noGlPage.goto(BASE, { waitUntil: "networkidle0" });
  await waitState(noGlPage, /Static/);
  await waitForImage(noGlPage);
  check("WebGL unavailable shows the static state", (await stateLabel(noGlPage)) === "Static");
  check(
    "WebGL fallback still frame loads",
    await noGlPage.$eval("img", (el) => el.complete && el.naturalWidth > 0 && Math.abs(el.naturalWidth / el.naturalHeight - 1200 / 900) < 0.02),
  );
  await noGlPage.screenshot({ path: path.join(SHOTS, "desktop-webgl-unavailable.png") });

  console.log("\nConsole errors seen:", errors.length);
  for (const error of [...new Set(errors)]) console.log(" -", error);

  const failed = results.filter((result) => !result.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
