/**
 * Step 1 of the athlete-male build: read the CC4 FBX in headless Chrome and write raw.json.
 *
 *   node scripts/athlete-male/extract.cjs <dir containing unity.fbx> <out dir>
 *
 * Uses three's FBXLoader (from apps/web/node_modules) and puppeteer-core (repo root).
 */
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png" };
// 1x1 transparent PNG, answers every texture request so FBXLoader never waits on a BMP.
const STUB_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

function serve(sourceDir) {
  const mounts = {
    "/three/": path.join(ROOT, "apps/web/node_modules/three/"),
    "/source/": sourceDir + path.sep,
    "/harness/": __dirname + path.sep,
  };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    if (url === "/stub.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(STUB_PNG);
      return;
    }
    const mount = Object.keys(mounts).find((m) => url.startsWith(m));
    if (!mount) { res.writeHead(404); res.end(); return; }
    const file = path.resolve(mounts[mount], url.slice(mount.length));
    if (!file.startsWith(path.resolve(mounts[mount]))) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function extract(sourceDir, outDir, fbxName = "unity.Fbx") {
  const puppeteer = require(path.join(ROOT, "node_modules/puppeteer-core"));
  const server = await serve(sourceDir);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error("page error:", e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/harness/extract.html`);
    const raw = await page.evaluate(
      (config) => window.extract(config),
      {
        fbx: fbxName,
        rootBone: "CC_Base_BoneRoot",
        meshes: [{ name: "CC_Base_Body" }, { name: "Boxers" }, { name: "CC_Game_Eye" }],
      },
    );
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "raw.json"), JSON.stringify(raw));
    return raw;
  } finally {
    await browser.close();
    server.close();
  }
}

module.exports = { extract };

if (require.main === module) {
  const [sourceDir, outDir] = process.argv.slice(2);
  if (!sourceDir || !outDir) throw new Error("usage: extract.cjs <dir with unity.Fbx> <out dir>");
  extract(path.resolve(sourceDir), path.resolve(outDir)).then((raw) => {
    console.log(`bones: ${raw.bones.length}`);
    for (const [name, mesh] of Object.entries(raw.meshes)) {
      console.log(`${name}: ${mesh.vertexCount} vertices, indexed=${mesh.indexed}, groups=${mesh.groups.map((g) => g.material).join(",")}`);
    }
    console.log("max morph influence:", JSON.stringify(raw.morphMax));
    console.log("bone world scale (root):", raw.rootWorldScale);
    const bad = raw.bones.filter((b) => b.worldScale.some((s) => Math.abs(s - 1) > 1e-3));
    console.log("bones with non-unit world scale:", bad.length);
  }).catch((e) => { console.error(e); process.exit(1); });
}
