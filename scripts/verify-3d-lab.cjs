// Browser verification and screenshots for the experimental /3d-lab route.
// Needs a running server: pnpm start (port 3100) or SOMACUE_LAB_URL=... for another one.
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "docs", "3d-lab", "screenshots");
const URL_ = process.env.SOMACUE_LAB_URL || "http://localhost:3100/3d-lab";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const errors = [];

const CHROME = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]
  .filter(Boolean)
  .find((c) => fs.existsSync(c));

const LABELS = {
  skeletal: "Skeleton", muscular: "Muscles", connective: "Connective tissue", nervous: "Nervous system",
  arterial: "Arteries", venous: "Veins", lymphatic: "Lymphatic", cardiac: "Heart", respiratory: "Respiratory",
  digestive: "Digestive", urinary: "Urinary", reproductive: "Reproductive", endocrine: "Endocrine",
  sensory: "Sensory organs", integumentary: "Atlas skin and hair",
};
const DEFAULT_LAYERS = ["skeletal", "muscular", "cardiac", "respiratory", "digestive", "urinary", "nervous", "arterial", "venous"];

function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function clickButton(page, text) {
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === t);
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }, text);
  if (!ok) throw new Error(`Button "${text}" not found or disabled`);
}

async function setChecked(page, ariaOrLabel, want) {
  await page.evaluate(
    (key, value) => {
      const inputs = [...document.querySelectorAll("input[type=checkbox]")];
      const input =
        inputs.find((el) => el.getAttribute("aria-label") === key) ||
        inputs.find((el) => el.closest("label")?.textContent.trim() === key);
      if (!input) throw new Error(`Checkbox ${key} not found`);
      if (input.checked !== value) input.click();
    },
    ariaOrLabel,
    want,
  );
}

async function setLayers(page, ids) {
  for (const [id, label] of Object.entries(LABELS)) await setChecked(page, label, ids.includes(id));
}

async function shot(page, name) {
  await sleep(1400);
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  console.log("  screenshot", path.relative(ROOT, file));
}

const sceneState = (page) =>
  page.evaluate(() => {
    const lab = window.__somacueLab.lab;
    const atlas = lab.root.getObjectByName("atlas-group");
    const body = [];
    lab.root.traverse((o) => {
      if (o.isSkinnedMesh && !o.name.startsWith("atlas-")) body.push(o);
    });
    return {
      atlasVisible: atlas.visible,
      rigVisible: body.some((o) => o.visible),
      skeletalVisible: lab.root.getObjectByName("atlas-skeletal").visible,
      muscularVisible: lab.root.getObjectByName("atlas-muscular").visible,
    };
  });

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  console.log(`Verifying ${URL_} with ${CHROME}`);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    // The anatomy is 2.3 million triangles: use the real GPU where Windows exposes one.
    args: process.platform === "win32" ? ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] : [],
  });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`PAGE: ${err.message}`));
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const t0 = Date.now();
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__somacueLab || document.querySelector('[role="alert"]'), {
    timeout: 240000,
  });
  const loadSeconds = (Date.now() - t0) / 1000;
  const ready = await page.evaluate(() => Boolean(window.__somacueLab));
  check("lab builds both models and the measurements", ready, `${loadSeconds.toFixed(1)} s`);
  if (!ready) throw new Error("Lab did not build");

  const res = await page.evaluate(() => window.__somacueLab.results);
  fs.writeFileSync(path.join(ROOT, "docs", "3d-lab", "results.json"), JSON.stringify(res, null, 2));
  check("page title marks the route experimental", (await page.title()).includes("experimental"));
  check("route is not indexable", await page.evaluate(() => document.querySelector('meta[name="robots"]')?.content.includes("noindex")));
  check("verdict panel is shown", await page.evaluate(() => Boolean(document.querySelector('[data-testid="lab-verdict"]'))));
  check(
    "verdict text matches the computed result",
    await page.evaluate((usable) => {
      const t = document.querySelector('[data-testid="lab-verdict"]').textContent;
      return usable ? t.includes("Compatible as tested") && !t.includes("Not compatible") : t.includes("Not compatible as tested");
    }, res.verdict.usableTogether),
    res.verdict.summary,
  );
  check("a failing criterion is never hidden", res.verdict.usableTogether || (await page.evaluate(() => document.querySelectorAll('[data-testid="lab-checks"] [data-pass="false"]').length)) === res.verdict.failed);
  check("the inside/outside test validates against the rig's own surface", res.validation.inwardInsidePct >= 95 && res.validation.outwardInsidePct <= 5, `${res.validation.inwardInsidePct.toFixed(1)}% in, ${res.validation.outwardInsidePct.toFixed(1)}% out`);
  check("all three sources are credited in the page", await page.evaluate(() => {
    const t = document.body.textContent;
    return t.includes("BodyParts3D, © The Database Center for Life Science") && t.includes("Innerscene Corp") && t.includes("Mesh2Motion");
  }));

  // --- Independent visibility
  let s = await sceneState(page);
  check("both models are visible at start", s.atlasVisible && s.rigVisible);
  await setChecked(page, "Show Innerscene human", false);
  s = await sceneState(page);
  check("Innerscene can be hidden alone", s.atlasVisible && !s.rigVisible);
  await setLayers(page, DEFAULT_LAYERS);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Front").click());
  await shot(page, "01-human-atlas-only");
  await setLayers(page, ["skeletal"]);
  await shot(page, "02-human-atlas-skeleton-only");
  await setLayers(page, ["skeletal", "muscular"]);
  await shot(page, "03-human-atlas-muscles-and-skeleton");
  await setLayers(page, DEFAULT_LAYERS);

  await setChecked(page, "Show Innerscene human", true);
  await setChecked(page, "Show Human Atlas anatomy", false);
  s = await sceneState(page);
  check("Human Atlas can be hidden alone", !s.atlasVisible && s.rigVisible);
  await clickButton(page, "Solid skin");
  await shot(page, "04-innerscene-human-only");

  await setChecked(page, "Show Human Atlas anatomy", true);
  s = await sceneState(page);
  check("both models can be shown together", s.atlasVisible && s.rigVisible);
  await setChecked(page, "Show Innerscene human", false);
  await setChecked(page, "Show Innerscene human", true);

  // --- Together
  await setLayers(page, ["skeletal"]);
  await clickButton(page, "Ghost skin");
  await shot(page, "05-together-skeleton-in-ghost-skin-front");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Side").click());
  await shot(page, "06-together-skeleton-in-ghost-skin-side");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Torso").click());
  await shot(page, "07-together-torso-detail");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Front").click());
  await setLayers(page, ["skeletal", "muscular"]);
  await shot(page, "08-together-muscles-in-ghost-skin");
  await clickButton(page, "Solid skin");
  await setLayers(page, DEFAULT_LAYERS);
  await shot(page, "09-together-solid-skin-anatomy-showing-through");
  await clickButton(page, "Ghost skin");
  await setLayers(page, ["skeletal"]);

  // --- Native A-pose: the atlas must follow the arms back to the file's pose
  await clickButton(page, "Native A-pose");
  await shot(page, "10-native-a-pose-anatomy-follows");
  await clickButton(page, "Matched rest");

  // --- Motion
  await clickButton(page, "Jumping jacks");
  await clickButton(page, "Play");
  await sleep(500);
  const t1 = await page.$eval('[data-testid="lab-time"]', (el) => parseFloat(el.textContent));
  check("play advances the clip", t1 > 0.1, `time=${t1}`);
  await clickButton(page, "Pause");
  const paused = await page.$eval('[data-testid="lab-time"]', (el) => parseFloat(el.textContent));
  await sleep(400);
  const paused2 = await page.$eval('[data-testid="lab-time"]', (el) => parseFloat(el.textContent));
  check("pause holds the pose", Math.abs(paused - paused2) < 0.02, `${paused} -> ${paused2}`);

  await setLayers(page, ["skeletal", "muscular"]);
  for (const [i, t] of [[11, 0.2], [12, 0.6], [13, 1.0]]) {
    await page.evaluate((tt) => {
      const input = document.querySelector('input[type="range"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, String(tt));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, t);
    await shot(page, `${i}-jumping-jacks-t${String(t).replace(".", "")}-muscles-and-skeleton`);
  }
  await setLayers(page, ["skeletal"]);
  await page.evaluate(() => {
    const input = document.querySelector('input[type="range"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "0.6");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await shot(page, "14-jumping-jacks-skeleton-in-ghost-skin");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Back").click());
  await shot(page, "15-jumping-jacks-back-view");

  // Return to rest, then the results panel
  await clickButton(page, "Matched rest");
  const restored = await page.$eval('[data-testid="lab-time"]', (el) => parseFloat(el.textContent));
  check("returning to rest resets the clock", restored === 0);
  await page.evaluate(() => document.getElementById("lab-results").scrollIntoView());
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = false)));
  await shot(page, "16-results-panel");
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  await page.evaluate(() => document.querySelector('[data-testid="lab-checks"]').scrollIntoView());
  await shot(page, "17-results-detail");

  // 320 px layout
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await sleep(600);
  check("no horizontal overflow at 390 px", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks pass`);
  fs.writeFileSync(path.join(ROOT, "docs", "3d-lab", "browser-checks.json"), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
