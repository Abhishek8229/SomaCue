// Focused regression check for paused clip selection: choosing "Jumping jacks"
// must display the clip's first frame immediately, without pressing Play.
// Needs a running server: pnpm start (port 3100) or SOMACUE_LAB_URL=...
// This script writes no files, so it does not touch the historical artifacts.
const fs = require("node:fs");
const puppeteer = require("puppeteer-core");

const URL_ = process.env.SOMACUE_LAB_URL || "http://localhost:3100/3d-lab";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Three's quaternion accumulator can differ by a few hundredths of a degree
// between equivalent evaluations; this is far below a visible difference.
const ANGLE_TOLERANCE = 0.002; // radians, about 0.11 degrees
const POSITION_TOLERANCE = 1e-5;
const results = [];
const errors = [];

const CHROME = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]
  .filter(Boolean)
  .find((candidate) => fs.existsSync(candidate));

function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function clickButton(page, text) {
  const ok = await page.evaluate((label) => {
    const button = [...document.querySelectorAll("button")].find(
      (element) => element.textContent.trim() === label,
    );
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, text);
  if (!ok) throw new Error(`Button "${text}" not found or disabled`);
}

function readPose(page) {
  return page.evaluate(() => {
    const bones = [];
    window.__somacueLab.lab.root.traverse((object) => {
      if (!object.isBone) return;
      bones.push({
        name: object.name,
        position: object.position.toArray(),
        quaternion: object.quaternion.toArray(),
      });
    });
    return bones;
  });
}

function poseDiff(before, after) {
  const worst = {
    changed: Number.POSITIVE_INFINITY,
    radians: Number.POSITIVE_INFINITY,
    metres: Number.POSITIVE_INFINITY,
  };
  if (before.length !== after.length) return worst;

  let changed = 0;
  let radians = 0;
  let metres = 0;
  for (let i = 0; i < before.length; i++) {
    const a = before[i];
    const b = after[i];
    if (a.name !== b.name) return worst;

    const dot = Math.abs(
      a.quaternion[0] * b.quaternion[0] +
        a.quaternion[1] * b.quaternion[1] +
        a.quaternion[2] * b.quaternion[2] +
        a.quaternion[3] * b.quaternion[3],
    );
    const boneRadians = 2 * Math.acos(Math.min(1, dot));
    const boneMetres = Math.hypot(
      a.position[0] - b.position[0],
      a.position[1] - b.position[1],
      a.position[2] - b.position[2],
    );
    if (boneRadians > ANGLE_TOLERANCE || boneMetres > POSITION_TOLERANCE) {
      changed++;
    }
    radians = Math.max(radians, boneRadians);
    metres = Math.max(metres, boneMetres);
  }
  return { changed, radians, metres };
}

function readClock(page) {
  return page.evaluate(() => {
    const lab = window.__somacueLab.lab;
    const output = document.querySelector('[data-testid="lab-time"]');
    const transport = [...document.querySelectorAll("button")].find((button) => {
      const label = button.textContent.trim();
      return label === "Play" || label === "Pause";
    });
    return {
      runtime: lab.time(),
      ui: output ? Number.parseFloat(output.textContent) : Number.NaN,
      transport: transport ? transport.textContent.trim() : null,
    };
  });
}

const formatDiff = (diff) =>
  `${diff.changed} bones differ; max ${((diff.radians * 180) / Math.PI).toFixed(4)}°`;

async function main() {
  if (!CHROME) {
    console.error(
      "Chrome was not found. Set CHROME_PATH to a Chrome or Chromium executable and retry.",
    );
    process.exit(1);
  }

  console.log(`Verifying ${URL_} with ${CHROME}`);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args:
      process.platform === "win32"
        ? ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"]
        : [],
  });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`PAGE: ${err.message}`));
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.__somacueLab || document.querySelector('[role="alert"]'),
    { timeout: 240000 },
  );
  const ready = await page.evaluate(() => Boolean(window.__somacueLab));
  check("lab builds both models and the measurements", ready);
  if (!ready) throw new Error("Lab did not build");
  await sleep(250);

  // Start from a rest pose that is visibly different from the clip's first
  // frame, so the selection has a previous pose that could stay on screen.
  await clickButton(page, "Native A-pose");
  await sleep(100);
  const previous = await readPose(page);

  // Regression: selecting the clip while paused must replace the previous pose
  // with the clip's first frame immediately, without playback.
  await clickButton(page, "Jumping jacks");
  await sleep(100);
  const selected = await readPose(page);
  const clock = await readClock(page);

  // The explicit seek path already applies the first frame. Taking it from the
  // same starting pose keeps bones the clip does not animate unchanged in both
  // snapshots, so only the clip-driven bones are compared.
  await page.evaluate(() => window.__somacueLab.lab.seek(0));
  await sleep(100);
  const firstFrame = await readPose(page);

  const setupDiff = poseDiff(previous, firstFrame);
  const selectedDiff = poseDiff(selected, firstFrame);
  const previousDiff = poseDiff(selected, previous);
  check(
    "the previous Native A-pose differs from the clip first frame",
    setupDiff.changed > 0,
    formatDiff(setupDiff),
  );
  check(
    "selecting Jumping jacks displays the first frame while paused",
    selectedDiff.changed === 0,
    formatDiff(selectedDiff),
  );
  check(
    "the paused selection replaced the previous pose",
    previousDiff.changed > 0,
    `${previousDiff.changed} bones changed from Native A-pose`,
  );
  check(
    "the clock is zero and Play is shown after reset",
    Math.abs(clock.runtime) < 1e-9 &&
      Math.abs(clock.ui) < 0.005 &&
      clock.transport === "Play",
    JSON.stringify(clock),
  );

  await clickButton(page, "Play");
  await sleep(600);
  const playing = await readClock(page);
  check(
    "Play starts the clip from the selected first frame",
    playing.runtime > 0.05 && playing.transport === "Pause",
    JSON.stringify(playing),
  );

  await clickButton(page, "Pause");
  await sleep(150);
  const paused = await readClock(page);
  await sleep(450);
  const pausedAgain = await readClock(page);
  check(
    "Pause freezes the clip",
    Math.abs(paused.runtime - pausedAgain.runtime) < 1e-3 &&
      Math.abs(pausedAgain.ui - pausedAgain.runtime) < 0.02 &&
      pausedAgain.transport === "Play",
    `${paused.runtime} -> ${pausedAgain.runtime}; ui ${pausedAgain.ui}`,
  );

  await clickButton(page, "Matched rest");
  await sleep(100);
  const matched = await readPose(page);
  const matchedClock = await readClock(page);
  check(
    "Matched rest is restored and resets the clock",
    poseDiff(matched, firstFrame).changed > 0 &&
      Math.abs(matchedClock.runtime) < 1e-9 &&
      matchedClock.transport === "Play",
    `${formatDiff(poseDiff(matched, firstFrame))}; ${JSON.stringify(matchedClock)}`,
  );

  await clickButton(page, "Native A-pose");
  await sleep(100);
  const native = await readPose(page);
  const nativeClock = await readClock(page);
  check(
    "Native A-pose is restored and resets the clock",
    poseDiff(native, matched).changed > 0 &&
      Math.abs(nativeClock.runtime) < 1e-9 &&
      nativeClock.transport === "Play",
    `${formatDiff(poseDiff(native, matched))}; ${JSON.stringify(nativeClock)}`,
  );

  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();

  const failed = results.filter((result) => !result.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks pass`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
