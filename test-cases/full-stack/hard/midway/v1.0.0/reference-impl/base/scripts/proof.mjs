// Midway — proof-of-implementation capture (specs/proof.md; DESIGN.md §7).
//
// Serves the BUILT dist under a non-root sub-path (proving base-path safety), drives the
// theme-park sim through representative states with the project-local Playwright + Chromium,
// and writes the exact proof/ artifacts the case declares. Also asserts the build loads with
// no console errors and that the park systems, economy, and the bankruptcy end state work.

import { chromium } from "playwright";
import http from "node:http";
import { readFile, mkdir, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dist = path.join(root, "dist");
const proofDir = path.join(root, "proof");
const videoDir = path.join(here, ".video");
const BASE = "/runs/demo/build";

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wav": "audio/wav", ".png": "image/png", ".webm": "video/webm" };

const server = http.createServer(async (req, res) => {
  let url = decodeURIComponent((req.url || "/").split("?")[0]);
  if (url.startsWith(BASE)) url = url.slice(BASE.length);
  if (url === "/" || url === "") url = "/index.html";
  const file = path.join(dist, url);
  if (!file.startsWith(dist) || !existsSync(file)) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const url = `http://localhost:${port}${BASE}/`;

await mkdir(proofDir, { recursive: true });
await rm(videoDir, { recursive: true, force: true });

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const errors = [];
function watch(page) {
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on("requestfailed", (r) => errors.push(`REQFAIL: ${r.url()} ${r.failure()?.errorText}`));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Build a lively demo park in one shot, from the New Park start. Laid out around the gate
// (col 32, bottom) so it sits centred in the default camera: a paved spine climbs from the
// plaza to a horizontal avenue (row 32), rides sit above the avenue and stalls below it (their
// entrances snapping to the adjacent path), scenery dresses the grass, and a staff crew works
// the paths. Exposed on every page (addInitScript) so both the captures and the checks reuse it.
async function installBuilder(page) {
  await page.addInitScript(() => {
    window.__demoPark = (opts = {}) => {
      const M = window.__midway;
      const g = M.game;
      M.newPark();
      M.devGrant(30000);
      // Paths: the spine up from the plaza, a top avenue, and a lower avenue — enough network
      // for a crowd to fan across.
      const spine = [];
      for (let r = 33; r <= 39; r++) spine.push([32, r]);
      M.layPath(spine);
      const avenue = [];
      for (let c = 20; c <= 44; c++) avenue.push([c, 32]);
      M.layPath(avenue);
      const lower = [];
      for (let c = 24; c <= 40; c++) lower.push([c, 36]);
      M.layPath(lower);
      // Rides above the avenue (footprint tops at row 29/30; entrances snap down to row 32).
      M.place("carousel", 24, 29);
      M.place("drop_tower", 30, 30);
      M.place("coaster", 34, 29);
      // Stalls below the avenue (entrances snap up to row 32).
      M.place("food", 22, 33);
      M.place("drink", 26, 33);
      M.place("souvenir", 38, 33);
      M.place("restroom", 41, 33);
      // Scenery on the grass.
      M.scenery("fountain", 20, 29);
      M.scenery("tree", 28, 30);
      M.scenery("tree", 33, 30);
      M.scenery("flowerbed", 43, 31);
      M.scenery("bench", 29, 33);
      M.scenery("lamp", 36, 33);
      // Staff crew.
      M.hire("janitor", 32, 38);
      M.hire("mechanic", 34, 32);
      if (opts.entertainer) M.hire("entertainer", 28, 32);
      g.selection = "none";
      g.selectedId = -1;
      const byKind = (k) => g.attractions.find((a) => a.kind === k);
      return {
        coasterId: byKind("coaster")?.id,
        carouselId: byKind("carousel")?.id,
        foodId: byKind("food")?.id,
        drinkId: byKind("drink")?.id,
        rideIds: g.attractions.filter((a) => a.category === "ride").map((a) => a.id),
      };
    };
  });
}

// ---- 1. title.png -------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await installBuilder(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await sleep(500);
  await page.mouse.move(100, 100); // pointer off the menu for a clean title
  await sleep(200);
  await page.screenshot({ path: path.join(proofDir, "title.png") });
  // A gesture so the produced audio may decode; assert it does not error.
  await page.mouse.click(100, 100);
  await sleep(1000);
  const ok = await page.evaluate(() => !!window.__midway && !!window.__midway.audio);
  console.log("title captured; audio gesture ok:", ok);
  await page.close();
}

// ---- 2. gameplay.png (a lively in-park frame, full HUD) ------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await installBuilder(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.mouse.click(100, 100);
  await sleep(200);
  const ids = await page.evaluate(() => {
    const built = window.__demoPark({ entertainer: true });
    const M = window.__midway;
    M.game.speed = 3;
    M.devGrant(12000);
    M.spawnGuests(70);
    return built;
  });
  // Let the crowd fan across the paths, a queue form, a ride run, a stall serve.
  let gsnap = {};
  for (let i = 0; i < 90; i++) {
    gsnap = await page.evaluate(() => {
      const g = window.__midway.game;
      const rides = g.attractions.filter((a) => a.category === "ride");
      const stalls = g.attractions.filter((a) => a.category === "stall");
      return {
        walking: g.guests.filter((gu) => gu.state === "walking" || gu.state === "wandering").length,
        queued: g.guests.filter((gu) => gu.state === "queuing" || gu.state === "buying").length,
        running: rides.filter((a) => a.state === "running" || a.state === "loading").map((a) => a.id),
        stallServing: stalls.some((a) => a.queue.length > 0),
        guests: g.guests.length,
      };
    });
    if (gsnap.walking >= 8 && gsnap.running.length >= 1 && gsnap.queued >= 2 && gsnap.stallServing) break;
    await sleep(80);
  }
  // Frame the HUD: the Build palette open (bottom-left chips) and a running ride selected
  // (bottom-right context panel — price steppers, queue, takings).
  await page.evaluate(({ ids, running }) => {
    const g = window.__midway.game;
    g.speed = 1;
    g.tool.kind = "build";
    g.tool.buildRide = "carousel";
    g.selection = "attraction";
    g.selectedId = running[0] ?? ids.coasterId;
  }, { ids, running: gsnap.running });
  await page.mouse.move(640, 690); // pointer into the HUD so no build ghost floats in the park
  await sleep(250);
  await page.screenshot({ path: path.join(proofDir, "gameplay.png") });
  const snap = await page.evaluate(() => ({ day: window.__midway.game.day, guests: window.__midway.game.guests.length, cash: Math.round(window.__midway.game.ledger.cash), rating: Math.round(window.__midway.game.rating) }));
  console.log("gameplay stage:", JSON.stringify(gsnap));
  console.log("gameplay captured:", JSON.stringify(snap));
  await page.close();
}

// ---- 3. game-over.png (park closed — bankruptcy) ------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await installBuilder(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.mouse.click(100, 100);
  await sleep(200);
  await page.evaluate(() => {
    const M = window.__midway;
    const g = M.game;
    window.__demoPark({});
    M.devDay(9); // days operated to show on the closed screen
    g.day = 9;
    for (const a of g.attractions) M.setPrice(a.id, 60); // a thin, overpriced park
    M.setPrice("admission", 40);
    M.devArrivals(false); // no rescue at the gate
    M.devGrant(-2600); // sits below the bankruptcy floor; the grace timer runs down
    g.speed = 3;
  });
  for (let i = 0; i < 260; i++) {
    const s = await page.evaluate(() => window.__midway.game.state);
    if (s === "gameover") break;
    await sleep(100);
  }
  await sleep(400);
  await page.screenshot({ path: path.join(proofDir, "game-over.png") });
  const end = await page.evaluate(() => ({ state: window.__midway.game.state, day: window.__midway.game.day, peak: window.__midway.game.peakGuests }));
  console.log("game-over captured:", JSON.stringify(end));
  await page.close();
}

// ---- clip helper (records the whole timeline the drive fn plays) ---------------
async function clip(name, drive) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  watch(page);
  await installBuilder(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.mouse.click(100, 100); // audio gesture
  await sleep(200);
  await drive(page);
  const video = page.video();
  await page.close();
  await context.close();
  if (video) await copyFile(await video.path(), path.join(proofDir, name));
  console.log(`${name} captured`);
}

// ---- 4. systems.webm (park systems at work) -----------------------------------
await clip("systems.webm", async (page) => {
  await page.evaluate(() => {
    window.__demoPark({});
    const M = window.__midway;
    M.game.speed = 2;
    M.devGrant(12000);
    M.spawnGuests(45);
  });
  await sleep(2600); // guests enter, path to rides, queue, load/run/unload; stalls sell (coin)
  await page.evaluate(() => window.__midway.breakRide()); // a ride breaks down (alarm) -> mechanic repairs
  await sleep(600);
  await page.evaluate(() => {
    for (const cell of [[30, 32], [31, 32], [33, 32], [28, 32]]) window.__midway.litter(cell[0], cell[1], 0.7);
  });
  await sleep(6000); // mechanic pathfinds + repairs, janitor seeks + clears litter (cleanup puff)
});

// ---- 5. downturn.webm (financial + reputation pressure) -----------------------
await clip("downturn.webm", async (page) => {
  await page.evaluate(() => {
    window.__demoPark({});
    const M = window.__midway;
    M.game.speed = 2;
    M.devGrant(2500);
    M.spawnGuests(50);
  });
  await sleep(2200); // a moment of a working park
  await page.evaluate(() => {
    const M = window.__midway;
    const g = M.game;
    for (const a of g.attractions) M.setPrice(a.id, 99); // prices far above value
    M.setPrice("admission", 40);
    for (const a of g.attractions) if (a.category === "ride") M.breakRide(a.id); // rides break (alarms)
    for (let c = 20; c <= 44; c += 2) M.litter(c, 32, 0.9); // litter piles up
    M.devArrivals(false); // the gate dries up
    M.devGrant(-2600); // cash bleeds into the red past the floor
    g.speed = 3;
  });
  await sleep(8000); // happiness + rating fall, arrivals gone, cash red -> the park closes
});

// ---- functional assertions (systems, economy, end state) ----------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await installBuilder(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.mouse.click(100, 100);
  await sleep(200);
  const checks = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const M = window.__midway;
    const g = M.game;
    const COLS = 64;
    window.__demoPark({});
    M.devGrant(30000);
    g.speed = 3;
    M.spawnGuests(60);

    // A guest queues+rides+pays, and a stall sale credits cash.
    let rideTakings = 0;
    let stallTakings = 0;
    let sawRunning = false;
    for (let i = 0; i < 240; i++) {
      for (const a of g.attractions) {
        if (a.category === "ride") {
          if (a.state === "running") sawRunning = true;
          rideTakings = Math.max(rideTakings, a.takings);
        } else {
          stallTakings = Math.max(stallTakings, a.takings);
        }
      }
      if (rideTakings > 0 && stallTakings > 0 && sawRunning) break;
      await sleep(40);
    }

    // A breakdown + a mechanic repair completes.
    const ride = g.attractions.find((a) => a.category === "ride");
    M.breakRide(ride.id);
    const wasBroken = ride.state === "broken";
    let repaired = false;
    for (let i = 0; i < 300; i++) {
      if (ride.state !== "broken") {
        repaired = true;
        break;
      }
      await sleep(40);
    }

    // A janitor lowers a tile's litter.
    M.litter(30, 32, 0.85);
    const li = 32 * COLS + 30;
    const litterBefore = g.world.tiles[li].litter;
    let litterCleared = false;
    for (let i = 0; i < 300; i++) {
      if (g.world.tiles[li].litter < litterBefore - 0.3) {
        litterCleared = true;
        break;
      }
      await sleep(40);
    }

    // Raising prices (and the broken/littered park) drives the reputation target down.
    const targetBefore = g.ratingTarget;
    for (const a of g.attractions) M.setPrice(a.id, 99);
    M.setPrice("admission", 40);
    for (const a of g.attractions) if (a.category === "ride") M.breakRide(a.id);
    for (let c = 20; c <= 44; c += 2) M.litter(c, 32, 0.9);
    await sleep(2500);
    const ratingDropped = g.ratingTarget < targetBefore - 2;

    // The bankruptcy end state is reachable.
    M.devArrivals(false);
    M.devGrant(-3000);
    let bankrupt = false;
    for (let i = 0; i < 500; i++) {
      if (g.state === "gameover") {
        bankrupt = true;
        break;
      }
      await sleep(30);
    }

    return { rideTakings, stallTakings, sawRunning, wasBroken, repaired, litterCleared, targetBefore: Math.round(targetBefore), ratingDropped, bankrupt };
  });
  console.log("functional checks:", JSON.stringify(checks));
  await page.close();
  globalThis.__checks = checks;
}

console.log("---");
console.log("console errors across all pages:", errors.length);
for (const e of errors.slice(0, 25)) console.log("  -", e);

await browser.close();
server.close();

const c = globalThis.__checks || {};
const ok =
  errors.length === 0 &&
  c.rideTakings > 0 &&
  c.stallTakings > 0 &&
  c.sawRunning &&
  c.repaired &&
  c.litterCleared &&
  c.ratingDropped &&
  c.bankrupt;
console.log(ok ? "PROOF+VERIFY OK" : "PROBLEMS DETECTED");
process.exit(ok ? 0 : 1);
