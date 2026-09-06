#!/usr/bin/env node
// Gantry — the showcase capture driver.
//
// It records `showcase/base/`: the leading `gameplay.webm`, and the stills
// beside it. Everything it records comes out of ONE take of the reference
// implementation at `references/none`, played in a real browser: the built
// static site is served on a loopback port, opened in Chromium, and driven the
// way a player drives it.
//
// GANTRY IS A 3D WEBGL GAME, so the leading entry has to be video. A
// draw-command recording carries the flat readout layer and nothing of the yard
// — no crane, no load, no member coloring — which is the entire point of this
// case. Playwright records the page natively, and that recording is what
// `gameplay.webm` is cut from.
//
// ─── WHAT IS A REAL PLAYER GESTURE HERE, AND WHAT IS NOT ────────────────────
//
// Real, delivered as browser input events through Playwright:
//
//   • The menus. `Enter` on the title screen takes SITES, `ArrowDown` walks the
//     site list, `Enter` opens the site — the same key path a player walks.
//   • The whole crane. Every strut, cable and rail is TWO REAL MOUSE CLICKS on
//     the stage, and the ring and the counterweights one each, with the tool
//     chosen by its real digit key first. `__gantry.project(x, y, z)` is a
//     reading — it answers where a lattice node is drawn — and the driver
//     clicks at that point, then reads `snapshot().pick` back to confirm the
//     game picked the node it meant before it presses. Every edit therefore
//     passes the same rules a player's click passes; a refusal would show up
//     here as a member that never appeared.
//   • Starting the run: the real `G` key.
//   • Orbiting the camera while the run plays: a real press-and-drag on the
//     stage, moved a few pixels at a time so the yard turns slowly.
//   • `REPLAY` on the results screen, taken with `ArrowDown` and `Enter`.
//
// Posed through the debug surface, and there are only three of them:
//
//   1. THE TAPE (`clearProgram`, `addMoveStep`, `addCommand`, `addActionStep`).
//      The tape editor's widgets are the build's own design — `specs/controls.md`
//      fixes only what a player can do with the tape, not what the rows look
//      like — so clicking them would be a script written against one build's
//      layout rather than against the game. The showcase is not about the
//      editor, so the tape is appended through the surface's tape operations
//      instead. It is the one thing in the take that is not a player's own
//      gesture, and it poses an INPUT (the program), never an outcome: what the
//      tape then does to the crane is entirely the simulation's.
//   2. `setCleared` on the sites before the captured one. Sites unlock in order,
//      so this stands for a player who has already cleared them. It touches no
//      part of the take that is on screen.
//   3. `setCamera`, twice, before the run starts — once to frame the build and
//      once to frame the lift. The camera is a viewpoint, not an outcome, and
//      the default pose is framed for the whole build envelope, which leaves a
//      crane small in frame. Nothing poses the camera once the run is running:
//      from `G` onward it moves only under the real drag.
//
// Nothing is posed mid-play. The driver never calls `setAxis`, `setBob`,
// `setLoadPose`, `setLoadPhase` or `setSpeedIndex`; the run plays at watch speed
// 1, and every swing, every member color and the clear at the end are the
// simulation's own.
//
// ─── THE TWO PASSES ─────────────────────────────────────────────────────────
//
// The take is the crane and the tape, and the run advances on its fixed tick at
// any frame rate, so the take is played twice, once on the wall clock and once
// off it:
//
//   Pass 1 (video)  Wall-clock play with Playwright's recorder on. The camera
//                   pose is sampled as it goes, so a still can be framed exactly
//                   as the video framed that moment.
//   Pass 2 (stills) The same crane and the same tape, replayed from the results
//                   screen off the wall clock with the surface's own clock
//                   (`setAutoStep(false)` / `advance`, which exist only under the
//                   engineless engine because nothing outside such a build owns
//                   its loop). Stepping the run tick by tick is what lets a still
//                   land on an exact tick instead of near it. The ticks are
//                   chosen by a scout playing of the same run.
//
// Run it with `node capture.mjs` from the reference workspace; see README.md.

import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { serveDist } from "./serve.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION_DIR = path.resolve(HERE, "../..");
const REFERENCE = path.join(VERSION_DIR, "references/none");

const require = createRequire(path.join(REFERENCE, "package.json"));
const { chromium } = require("playwright");

/* ── knobs ────────────────────────────────────────────────────────────────── */

const env = process.env;
const num = (name, fallback) => Number(env[name] ?? fallback);

/** Which site is captured. Site 3, "Over the Wall" — see README.md. */
const SITE = num("GANTRY_SHOWCASE_SITE", 3);
/** Where the media lands. The showcase directory itself, by default. */
const OUT = path.resolve(env.GANTRY_SHOWCASE_OUT ?? path.join(HERE, "../base"));
/**
 * Scratch for the raw recording the clip is cut out of. Outside the repository
 * by default: nothing but the shipped media and this driver belongs in the
 * version directory.
 */
const WORK = path.resolve(
  env.GANTRY_SHOWCASE_WORK ?? path.join(os.tmpdir(), "gantry-showcase"),
);
/** `1` writes a contact sheet of the run every second, for eyeballing a take. */
const QA = env.GANTRY_SHOWCASE_QA === "1";

/** The logical stage. With a 1280x720 viewport at dpr 1 it is 1:1 with the page. */
const STAGE_W = 1280;
const STAGE_H = 720;
const TICK_HZ = 60;
const LATTICE_PITCH = 2;
/**
 * How far the nearest OTHER lattice node must be from the one being clicked.
 *
 * A click picks the NEAREST lattice node within `NODE_PICK_PX` (20) of it, and
 * the driver clicks exactly where the node it wants is drawn — distance zero —
 * so it wins against anything that is not drawn on top of it. What this margin
 * rules out is that: two nodes on one ray, which happens on an axis-aligned
 * lattice at the obvious yaws (at yaw 45 every node two along in `x` and two
 * along in `z` sits on one ray), where the winner is decided by a tie rule
 * rather than by the aim. A couple of pixels is all it takes to be sure, and
 * `clickNode` confirms the pick afterwards anyway.
 */
const MIN_NODE_CLEARANCE_PX = 2.5;

/**
 * How far short of its pad the load still is in the `setting-down` still, in
 * world units along the ground.
 *
 * The run camera looks down at the yard from along the jib, which is the line
 * the trolley carries the load in on, so the load is drawn between the camera
 * and the pad for the whole of the last leg and covers it from well before it
 * arrives — a crate is two units across and a pad is the crate's own footprint.
 * Four and a half units short is where the pad is still drawn whole, arrow and
 * all, beside a crate that is plainly closing on it, and it is far enough out
 * that the crate is clear of the crane's own legs rather than tangled in them.
 */
const SET_DOWN_PAD_GAP = num("GANTRY_SHOWCASE_SET_DOWN_GAP", 4.5);

/** The camera the crane is built at, and the one the lift is watched from. */
const BUILD_CAM = {
  // From over the far corner of the yard, so the wall stands between the crate
  // and the pad rather than between the yard and the viewer, and all three read
  // at once. Wide enough to hold the whole crane and both ends of the lift.
  yaw: num("GANTRY_SHOWCASE_BUILD_YAW", 300),
  pitch: num("GANTRY_SHOWCASE_BUILD_PITCH", 21),
  dist: num("GANTRY_SHOWCASE_BUILD_DIST", 29),
};
const RUN_CAM = {
  // Closer than the build framing, and along the jib, so the crane fills the
  // frame and the load is big enough for its swing and the members' color to
  // read — but far enough back that the WHOLE crane is inside the frame for the
  // whole run. The mast head and the jib's tie cables are the top of the
  // structure and they are half of what makes it read as a tower crane; a
  // framing that cuts them off, however large it makes the load, is showing a
  // reader a crane with its head off.
  yaw: num("GANTRY_SHOWCASE_RUN_YAW", 62),
  pitch: num("GANTRY_SHOWCASE_RUN_PITCH", 22),
  dist: num("GANTRY_SHOWCASE_RUN_DIST", 31),
};

/**
 * The orbit the player drags out while the run plays, as
 * `[from, to, degrees]` over the run clock. Yaw only: the pitch is where the
 * lift reads best and rolling it about would only cost that.
 */
const ORBIT = [
  { from: 3, to: 15, degrees: 46 },
  { from: 20, to: 34, degrees: -52 },
];

/** Chromium's software GL. `--use-gl=swiftshader` presents about three times
 *  as many frames a second here as ANGLE's swiftshader backend does. */
const LAUNCH_ARGS = [
  "--use-gl=swiftshader",
  "--enable-unsafe-swiftshader",
  "--hide-scrollbars",
  "--mute-audio",
];

/* ── small helpers ────────────────────────────────────────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (...parts) => console.log(...parts);
const round = (n, p = 1) => Number(n.toFixed(p));

function ffmpeg(args, what) {
  const done = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (done.status !== 0) {
    throw new Error(`ffmpeg failed (${what}): exit ${done.status}`);
  }
}

/** A single snapshot field set, small enough to poll for. */
const READ = () => {
  const s = window.__gantry.snapshot();
  return {
    screen: s.screen,
    site: s.site.name,
    menuIndex: s.menuIndex,
    tool: s.tool,
    members: s.structure.members.length,
    cost: s.structure.cost,
    issues: s.structure.issues,
    ring: s.structure.ring,
    counterweights: s.structure.counterweights.length,
    pending: s.pendingNode,
    pick: s.pick,
    steps: s.program.length,
    camera: s.camera,
    phase: s.run.phase,
    cause: s.run.cause,
    tick: s.run.tick,
    time: s.run.time,
    loads: s.run.loads.map((l) => l.phase),
    broken: s.run.broken.length,
  };
};

const read = (page) => page.evaluate(READ);

/* ── real input ───────────────────────────────────────────────────────────── */

/** Press a key for real, then wait for the frame that consumes it. */
async function press(page, code) {
  await page.keyboard.press(code);
  await frame(page);
}

/** Wait for the game's own next frame, so queued input has been consumed. */
function frame(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
      ),
  );
}

/**
 * A real click at a stage point: move the pointer there, confirm the game
 * picked the node it was aimed at, then press and release.
 *
 * The confirmation is a READING — `snapshot().pick` is what the build screen is
 * already highlighting under the pointer — so it changes nothing. It is here
 * because a click that lands on the wrong node builds a different crane in
 * silence, and the take would be of that crane.
 */
async function clickNode(page, point, node) {
  await page.mouse.move(point.x, point.y);
  const at = await page.waitForFunction(
    (want) => {
      const p = window.__gantry.snapshot().pick.node;
      return p && p.x === want[0] && p.y === want[1] && p.z === want[2]
        ? p
        : null;
    },
    node,
    { timeout: 5_000, polling: "raf" },
  );
  await at.dispose();
  await page.mouse.down();
  await page.mouse.up();
}

/* ── the site's design ────────────────────────────────────────────────────── */

/**
 * The reference crane and tape for a site, out of the reference build's own
 * `src/sim/designs.json` — the same authored answer the case's validators drive.
 */
async function design(site) {
  const all = JSON.parse(
    await readFile(path.join(REFERENCE, "src/sim/designs.json"), "utf8"),
  );
  const found = all.sites.find((s) => s.site === site);
  if (!found) throw new Error(`no design for site ${site}`);
  return found;
}

/** Every lattice node the crane needs a click on. */
function neededNodes(d) {
  const seen = new Map();
  const add = (n) => seen.set(n.join(","), n);
  add(d.ring);
  for (const n of d.counterweights) add(n);
  for (const [a, b] of d.members) {
    add(a);
    add(b);
  }
  return [...seen.values()];
}

/* ── the build ────────────────────────────────────────────────────────────── */

const TOOL_KEY = { strut: "Digit1", cable: "Digit2", rail: "Digit3" };

/**
 * Check that every node the crane needs can be clicked unambiguously from the
 * given camera.
 *
 * A click picks the nearest lattice node within `NODE_PICK_PX` of it, so two
 * nodes that project to the same point are a coin toss. That happens on an
 * axis-aligned lattice at the obvious yaws — at yaw 45 every node two along in
 * `x` and two along in `z` sits on one ray — which is why the build camera is
 * not one of them. This proves it rather than trusting it.
 */
async function assertPickable(page, nodes) {
  const trouble = await page.evaluate(
    ({ nodes, pitch, floor }) => {
      const g = window.__gantry;
      const { min, max } = g.snapshot().site.envelope;
      const lattice = [];
      for (let x = min.x; x <= max.x; x += pitch)
        for (let y = min.y; y <= max.y; y += pitch)
          for (let z = min.z; z <= max.z; z += pitch) {
            const p = g.project(x, y, z);
            if (p.visible) lattice.push([x, y, z, p.x, p.y]);
          }
      const bad = [];
      for (const [nx, ny, nz] of nodes) {
        const at = g.project(nx, ny, nz);
        if (!at.visible) {
          bad.push({ node: [nx, ny, nz], why: "off stage" });
          continue;
        }
        let nearest = Infinity;
        for (const [x, y, z, px, py] of lattice) {
          if (x === nx && y === ny && z === nz) continue;
          nearest = Math.min(nearest, Math.hypot(px - at.x, py - at.y));
        }
        if (nearest < floor) {
          bad.push({ node: [nx, ny, nz], why: `neighbor ${nearest.toFixed(1)}px away` });
        }
      }
      return bad;
    },
    { nodes, pitch: LATTICE_PITCH, floor: MIN_NODE_CLEARANCE_PX },
  );
  if (trouble.length > 0) {
    throw new Error(
      `the build camera cannot click ${trouble.length} node(s) unambiguously: ` +
        JSON.stringify(trouble.slice(0, 6)),
    );
  }
}

/**
 * Find a build camera every needed node can be clicked from.
 *
 * The pitch and distance are the framing's; the yaw is searched, because the
 * yaw is what decides whether two lattice nodes fall on one ray. The search
 * takes the yaw nearest the one asked for whose worst node still stands
 * `MIN_NODE_CLEARANCE_PX` clear of every other node, and reports the margin it
 * found so a re-run says out loud how much room the aim had.
 */
async function chooseBuildCamera(page, nodes, wanted) {
  const chosen = await page.evaluate(
    ({ nodes, wanted, pitch, floor }) => {
      const g = window.__gantry;
      const before = g.snapshot().camera;
      const { min, max } = g.snapshot().site.envelope;
      const clearance = () => {
        const lattice = [];
        for (let x = min.x; x <= max.x; x += pitch)
          for (let y = min.y; y <= max.y; y += pitch)
            for (let z = min.z; z <= max.z; z += pitch) {
              const p = g.project(x, y, z);
              if (p.visible) lattice.push([x, y, z, p.x, p.y]);
            }
        let worst = Infinity;
        for (const [nx, ny, nz] of nodes) {
          const at = g.project(nx, ny, nz);
          if (!at.visible) return -1;
          for (const [x, y, z, px, py] of lattice) {
            if (x === nx && y === ny && z === nz) continue;
            worst = Math.min(worst, Math.hypot(px - at.x, py - at.y));
          }
        }
        return worst;
      };
      let best = null;
      for (let step = 0; step <= 40; step += 1) {
        for (const sign of step === 0 ? [1] : [1, -1]) {
          const yaw = wanted.yaw + sign * step;
          g.setCamera(yaw, wanted.pitch, wanted.dist);
          const clear = clearance();
          if (clear >= floor && (best === null || clear > best.clear)) {
            best = { yaw, pitch: wanted.pitch, dist: wanted.dist, clear };
          }
        }
        if (best !== null) break;
      }
      g.setCamera(before.yaw, before.pitch, before.dist);
      return best;
    },
    { nodes, wanted, pitch: LATTICE_PITCH, floor: MIN_NODE_CLEARANCE_PX },
  );
  if (chosen === null) {
    throw new Error(
      `no yaw within 40 degrees of ${wanted.yaw} lets every node be clicked ` +
        `unambiguously at pitch ${wanted.pitch}, distance ${wanted.dist}`,
    );
  }
  say(
    `   build camera: yaw ${chosen.yaw}, pitch ${chosen.pitch}, ` +
      `distance ${chosen.dist} (nearest other node ${round(chosen.clear)}px)`,
  );
  return chosen;
}

/** Where each needed node is drawn, read once: the camera does not move. */
async function projections(page, nodes) {
  const points = await page.evaluate(
    (nodes) => nodes.map(([x, y, z]) => window.__gantry.project(x, y, z)),
    nodes,
  );
  const at = new Map();
  nodes.forEach((n, i) => at.set(n.join(","), points[i]));
  return at;
}

/**
 * Build the crane, click by click, and confirm the yard took each edit.
 *
 * The ring goes on first — the arm may only reach the tower through it — then
 * the members in the design's own order, so each carries the member id its
 * index there gives it, then the counterweights.
 */
async function buildCrane(page, d) {
  const nodes = neededNodes(d);
  const cam = await chooseBuildCamera(page, nodes, BUILD_CAM);
  await setCamera(page, cam);
  await assertPickable(page, nodes);
  const at = await projections(page, nodes);
  const point = (n) => {
    const p = at.get(n.join(","));
    if (!p) throw new Error(`no projection for ${n}`);
    return p;
  };

  await press(page, "Digit4");
  await clickNode(page, point(d.ring), d.ring);
  await page.waitForFunction(
    () => window.__gantry.snapshot().structure.ring !== null,
    null,
    { polling: "raf", timeout: 5_000 },
  );

  let tool = "ring";
  let placed = 0;
  const t0 = Date.now();
  for (const [a, b, material] of d.members) {
    if (tool !== material) {
      await press(page, TOOL_KEY[material]);
      await page.waitForFunction(
        (want) => window.__gantry.snapshot().tool === want,
        material,
        { polling: "raf", timeout: 5_000 },
      );
      tool = material;
    }
    await clickNode(page, point(a), a);
    await page.waitForFunction(
      (want) => {
        const p = window.__gantry.snapshot().pendingNode;
        return !!p && p.x === want[0] && p.y === want[1] && p.z === want[2];
      },
      a,
      { polling: "raf", timeout: 5_000 },
    );
    await clickNode(page, point(b), b);
    placed += 1;
    await page.waitForFunction(
      (want) => window.__gantry.snapshot().structure.members.length === want,
      placed,
      { polling: "raf", timeout: 5_000 },
    );
  }

  await press(page, "Digit5");
  for (const n of d.counterweights) {
    await clickNode(page, point(n), n);
  }
  await page.waitForFunction(
    (want) => window.__gantry.snapshot().structure.counterweights.length === want,
    d.counterweights.length,
    { polling: "raf", timeout: 5_000 },
  );

  const s = await read(page);
  say(
    `   built ${s.members} members, ${s.counterweights} counterweight(s), ` +
      `cost ${Math.round(s.cost)}, issues ${JSON.stringify(s.issues)} ` +
      `(${((Date.now() - t0) / 1000).toFixed(1)}s of clicking)`,
  );
  if (s.members !== d.members.length) {
    throw new Error(`clicked ${d.members.length} members, the yard took ${s.members}`);
  }
  if (s.issues.length > 0) {
    throw new Error(`the crane is not ready to run: ${s.issues.join(", ")}`);
  }
}

/**
 * Append the tape through the surface's tape operations.
 *
 * THIS IS THE POSED PART OF THE TAKE, and the only one that stands in for a
 * player's own gesture — see the header. It appends the reference tape for the
 * site: an input to the run, not an outcome of it.
 */
async function poseTape(page, d) {
  await press(page, "KeyP");
  await page.waitForFunction(
    () => window.__gantry.snapshot().screen === "program",
    null,
    { polling: "raf", timeout: 5_000 },
  );
  await page.evaluate((tape) => {
    const g = window.__gantry;
    g.clearProgram();
    for (const step of tape) {
      if (step.kind === "action") {
        g.addActionStep(step.action);
        continue;
      }
      const [first, ...rest] = step.commands;
      g.addMoveStep(first.axis, first.target, first.rate);
      const index = g.snapshot().program.length - 1;
      for (const c of rest) g.addCommand(index, c.axis, c.target, c.rate);
    }
  }, d.tape);
  const s = await read(page);
  if (s.steps !== d.tape.length) {
    throw new Error(`tape is ${s.steps} steps, wanted ${d.tape.length}`);
  }
  say(`   tape posed: ${s.steps} steps`);
  await press(page, "KeyB");
  await page.waitForFunction(
    () => window.__gantry.snapshot().screen === "build",
    null,
    { polling: "raf", timeout: 5_000 },
  );
}

/* ── opening the site, as a player does ───────────────────────────────────── */

async function openSiteForReal(page, site) {
  // Sites unlock in order. This poses the progress a player would arrive with
  // and nothing that is on screen in the take.
  if (site > 1) {
    await page.evaluate((n) => {
      for (let i = 0; i < n; i += 1) window.__gantry.setCleared(i, true);
    }, site - 1);
  }
  await press(page, "Enter"); // TITLE → SITES
  await page.waitForFunction(
    () => window.__gantry.snapshot().screen === "select",
    null,
    { polling: "raf", timeout: 5_000 },
  );
  for (let i = 1; i < site; i += 1) await press(page, "ArrowDown");
  await page.waitForFunction(
    (want) => window.__gantry.snapshot().menuIndex === want,
    site - 1,
    { polling: "raf", timeout: 5_000 },
  );
  await press(page, "Enter");
  await page.waitForFunction(
    () => window.__gantry.snapshot().screen === "build",
    null,
    { polling: "raf", timeout: 10_000 },
  );
  const s = await read(page);
  say(`   opened site ${site}: ${s.site}`);
  return s;
}

async function setCamera(page, cam) {
  await page.evaluate(
    (c) => window.__gantry.setCamera(c.yaw, c.pitch, c.dist),
    cam,
  );
  await frame(page);
}

/* ── the orbit drag ───────────────────────────────────────────────────────── */

/**
 * The player's hand on the yard while the run plays: one press, held, moved a
 * few pixels at a time, released at the end. A drag turns the camera by
 * `ORBIT_PER_PX` (0.25) degrees per logical pixel, so the schedule above is
 * converted straight into pixels of travel.
 */
function orbitPlan() {
  return ORBIT.map((leg) => ({ ...leg, pixels: leg.degrees / 0.25 }));
}

function orbitOffsetAt(time, plan) {
  let px = 0;
  for (const leg of plan) {
    if (time <= leg.from) break;
    const t = Math.min(time, leg.to);
    px += (leg.pixels * (t - leg.from)) / (leg.to - leg.from);
  }
  return px;
}

/* ── pass 1: the video ────────────────────────────────────────────────────── */

async function videoPass(browser, url, d) {
  const videoDir = path.join(WORK, "video");
  await rm(videoDir, { recursive: true, force: true });
  await mkdir(videoDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: STAGE_W, height: STAGE_H },
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: { width: STAGE_W, height: STAGE_H } },
  });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  const opened = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => !!window.__gantry, null, { timeout: 60_000 });
  await assertStageIsOneToOne(page);

  say(" pass 1 — the video");
  await openSiteForReal(page, SITE);
  await buildCrane(page, d);
  await poseTape(page, d);
  await setCamera(page, RUN_CAM);
  // The clip opens on a beat of the build screen, so park the pointer off the
  // yard first: the build screen highlights whatever is under it and names what
  // a click would do, and neither belongs in the opening frames.
  await parkPointer(page);
  await sleep(700);

  // The real `G`, and from here nothing but the drag touches the game.
  const gAt = Date.now();
  await page.keyboard.press("KeyG");
  await page.waitForFunction(
    () => window.__gantry.snapshot().run.phase === "running",
    null,
    { polling: "raf", timeout: 10_000 },
  );

  const plan = orbitPlan();
  const anchor = { x: 240, y: 560 };
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.down();
  let last = 0;

  const track = [];
  let final = null;
  const deadline = Date.now() + 240_000;
  for (;;) {
    const s = await read(page);
    track.push({ tick: s.tick, camera: s.camera });
    if (s.phase !== "running") {
      final = s;
      break;
    }
    if (Date.now() > deadline) throw new Error("the run did not finish");
    const want = orbitOffsetAt(s.time, plan);
    if (Math.abs(want - last) > 0.5) {
      await page.mouse.move(anchor.x + want, anchor.y);
      last = want;
    }
    await sleep(90);
  }
  await page.mouse.up();
  const ran = (Date.now() - gAt) / 1000;
  say(
    `   run ${final.phase}${final.cause ? ` (${final.cause})` : ""} at ` +
      `${round(final.time, 2)}s of run clock, ${round(ran, 1)}s of wall clock, ` +
      `${final.broken} member(s) broken`,
  );
  if (final.phase !== "cleared") {
    throw new Error(`the run did not clear: ${final.phase} ${final.cause ?? ""}`);
  }

  // Hold on the results card for a beat, so the clip ends settled.
  await sleep(1_600);
  const video = page.video();
  await context.close();
  const raw = await video.path();
  if (problems.length > 0) say(`   page errors: ${problems.join(" | ")}`);

  return {
    raw,
    // Where the run starts inside the recording, which begins when the page did.
    runStart: (gAt - opened) / 1000,
    runSeconds: ran,
    track,
  };
}

async function assertStageIsOneToOne(page) {
  const fit = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const r = c.getBoundingClientRect();
    return { w: r.width, h: r.height, x: r.left, y: r.top };
  });
  if (fit.w !== STAGE_W || fit.h !== STAGE_H || fit.x !== 0 || fit.y !== 0) {
    throw new Error(
      `the stage is not 1:1 with the page (${JSON.stringify(fit)}), so a click ` +
        `at a projected point would land somewhere else`,
    );
  }
}

/* ── pass 2: the stills ───────────────────────────────────────────────────── */

/**
 * Play the run through once with nothing but the surface's clock, recording
 * what each tick looked like, so the stills can be aimed at a tick rather than
 * at a moment. The whole scout happens inside one page call: it never leaves the
 * browser, so it costs one round trip rather than two thousand.
 */
async function scout(page) {
  return page.evaluate(() => {
    const g = window.__gantry;
    const pads = g.snapshot().site.loads.map((load) => load.to);
    const rows = [];
    for (let i = 0; i < 20_000; i += 1) {
      g.advance(1);
      const s = g.snapshot();
      const util = s.run.forces.reduce((top, f) => Math.max(top, f.utilization), 0);
      const pad = s.run.attached === null ? null : pads[s.run.attached];
      rows.push({
        tick: s.run.tick,
        phase: s.run.phase,
        step: s.run.stepIndex,
        util,
        attached: s.run.attached,
        bob: s.run.bob.pos,
        // How far the load on the hook still is from its pad, along the ground.
        // A still of the set-down is chosen off this: see `chooseStills`.
        padGap:
          pad === null
            ? null
            : Math.hypot(s.run.bob.pos.x - pad.x, s.run.bob.pos.z - pad.z),
      });
      if (s.run.phase !== "running") break;
    }
    return rows;
  });
}

async function stillsPass(browser, url, d, track) {
  const context = await browser.newContext({
    viewport: { width: STAGE_W, height: STAGE_H },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => !!window.__gantry, null, { timeout: 60_000 });
  await assertStageIsOneToOne(page);

  say(" pass 2 — the stills");
  await openSiteForReal(page, SITE);
  await buildCrane(page, d);
  await poseTape(page, d);

  // The build screen, the finished crane, the site around it. The static check
  // is a real key press and it is what colors the standing structure.
  await press(page, "KeyC");
  await parkPointer(page);
  await shot(page, path.join(OUT, "the-crane.png"));
  say("   still: the-crane.png");

  // Off the wall clock for the rest: `advance` steps whole ticks of the build's
  // own length, which is exactly what watch speed 1 gives, so this replay is the
  // video's run tick for tick.
  await page.evaluate(() => window.__gantry.setAutoStep(false));
  await setCamera(page, RUN_CAM);
  await startRunOffClock(page);

  const rows = await scout(page);
  const last = rows[rows.length - 1];
  say(
    `   scout: ${rows.length} ticks, ended ${last.phase}, ` +
      `peak utilization ${round(Math.max(...rows.map((r) => r.util)), 2)}`,
  );

  const wanted = chooseStills(rows);
  for (const [name, tick] of wanted) {
    say(`   still: ${name}.png at tick ${tick} (${round(tick / TICK_HZ, 2)}s)`);
  }

  if (QA) await contactSheet(page, rows.length);

  // One playing off the wall clock, walked forward through the wanted ticks in
  // order, each still taken at the tick the video's camera track marks.
  await restartRun(page);
  for (const [name, tick] of wanted) {
    await advanceTo(page, tick);
    const cam = cameraAt(tick, track);
    if (cam) await setCamera(page, cam);
    await frame(page);
    await shot(page, path.join(OUT, `${name}.png`));
  }

  await context.close();
  return wanted;
}

/**
 * The ticks the stills are taken at, both read off the scout rather than
 * written down, so they follow the run rather than a guess about it.
 *
 * `over-the-wall` is the tick the hardest-worked member is working hardest with
 * the load on the hook — on this site that is the crate up at the jib crossing
 * the obstacle, which is both the moment the site is named for and the frame
 * where the utilization ramp reads.
 *
 * `setting-down` is the load ARRIVING at its pad rather than resting on it, and
 * the reason is that the two moments photograph differently. The camera looks
 * down at the yard, so a load directly over its pad HIDES the pad, and a still
 * of the last tick of the carry — which is the moment the run is about — is a
 * crate on a cable over bare dirt, saying nothing about where it is going. So
 * the tick taken is the last one at which the load is still `SET_DOWN_PAD_GAP`
 * short of the pad along the ground: the crate low, the cable paid out and
 * running back up to the jib, and the pad lit in the clear beside it. That is
 * the same beat, framed so a reader can see the target it is closing on.
 */
function chooseStills(rows) {
  const carrying = rows.filter((r) => r.attached !== null);
  if (carrying.length === 0) throw new Error("the run never carried a load");
  const hardest = carrying.reduce((a, b) => (b.util > a.util ? b : a));
  const closing = carrying.filter(
    (r) => r.tick > hardest.tick && r.padGap >= SET_DOWN_PAD_GAP,
  );
  if (closing.length === 0) {
    throw new Error(
      `the load was never carried within ${SET_DOWN_PAD_GAP} units of its pad`,
    );
  }
  const arriving = closing[closing.length - 1];
  return [
    ["over-the-wall", hardest.tick],
    ["setting-down", arriving.tick],
  ].sort((a, b) => a[1] - b[1]);
}

/** The pose the video's own camera held at that tick. */
function cameraAt(tick, track) {
  if (!track || track.length === 0) return null;
  let best = track[0];
  for (const row of track) {
    if (Math.abs(row.tick - tick) < Math.abs(best.tick - tick)) best = row;
  }
  return best.camera;
}

/** Step the run forward to exactly `tick`. Never backwards. */
async function advanceTo(page, tick) {
  const at = (await read(page)).tick;
  if (at > tick) throw new Error(`the run is already past tick ${tick}`);
  if (at < tick) await page.evaluate((n) => window.__gantry.advance(n), tick - at);
}

/**
 * Start a run off the wall clock. `advance(1)` is what consumes the queued key
 * press, and the update that consumes it also takes the run's first tick.
 */
async function startRunOffClock(page) {
  await page.keyboard.press("KeyG");
  await page.evaluate(() => window.__gantry.advance(1));
  const s = await read(page);
  if (s.phase !== "running") throw new Error(`the run did not start (${s.phase})`);
}

/**
 * REPLAY on the results screen, taken with real keys: `ArrowDown` moves the
 * highlight from NEXT SITE to REPLAY and `Enter` takes it, which reopens the
 * site with the crane and the tape standing. Then the real `G` again.
 */
async function restartRun(page) {
  const s = await read(page);
  if (s.screen !== "results") {
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.__gantry.advance(1));
  }
  await page.keyboard.press("ArrowDown");
  await page.evaluate(() => window.__gantry.advance(1));
  await page.keyboard.press("Enter");
  await page.evaluate(() => window.__gantry.advance(1));
  const back = await read(page);
  if (back.screen !== "build") {
    throw new Error(`REPLAY did not reopen the site (screen ${back.screen})`);
  }
  await startRunOffClock(page);
}

/**
 * Move the pointer somewhere it picks nothing, for real, before a build-screen
 * still. The build screen names what a click would do along the bottom of the
 * screen and highlights whatever is under the pointer, and a still is of the
 * yard rather than of where the driver's hand happened to be.
 */
async function parkPointer(page) {
  for (const [x, y] of [[1180, 120], [1240, 60], [60, 660], [1180, 60]]) {
    await page.mouse.move(x, y);
    await frame(page);
    const { pick } = await read(page);
    if (pick.node === null && pick.member === null) return;
  }
  throw new Error("nowhere on the stage picks nothing");
}

async function shot(page, file) {
  await mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, type: "png" });
}

/** QA only: a frame a second through the run, to eyeball what was captured. */
async function contactSheet(page, ticks) {
  const dir = path.join(WORK, "qa");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await restartRun(page);
  for (let t = TICK_HZ; t <= ticks; t += TICK_HZ) {
    await advanceTo(page, t);
    await shot(page, path.join(dir, `t${String(t).padStart(5, "0")}.png`));
  }
  say(`   QA frames in ${dir}`);
}

/* ── cutting the clip ─────────────────────────────────────────────────────── */

/**
 * Playwright records the page from the moment it opened, so the raw file also
 * holds the menus, the building and the tape. The clip is the run: cut from a
 * beat before `G` to a beat after the results card appears, and re-encoded to
 * VP9, which carries this footage at a fraction of the recorder's VP8 weight.
 */
async function cutClip(recording, file) {
  const lead = 0.6;
  const tail = 1.2;
  const start = Math.max(0, recording.runStart - lead);
  const length = recording.runSeconds + lead + tail;
  await mkdir(path.dirname(file), { recursive: true });
  await rm(file, { force: true });
  ffmpeg(
    [
      "-ss", start.toFixed(3),
      "-t", length.toFixed(3),
      "-i", recording.raw,
      "-an",
      "-c:v", "libvpx-vp9",
      // The guide asks for a leading entry of a megabyte or two: it is a page
      // cost, paid the moment a visitor selects the case, not an archive cost.
      // This footage is flat-shaded and mostly still background, so it carries
      // a high CRF well, and a slower cpu-used spends encoder time rather than
      // bytes on the readouts, which have to stay legible on the stage.
      "-crf", "38",
      "-b:v", "0",
      "-row-mt", "1",
      "-deadline", "good",
      "-cpu-used", "1",
      "-pix_fmt", "yuv420p",
      file,
    ],
    "cutting the clip",
  );
  const { size } = await stat(file);
  const probe = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1",
    file,
  ]);
  const seconds = Number(String(probe.stdout).trim());
  say(
    `   ${path.basename(file)}: ${round(seconds, 1)}s, ` +
      `${(size / 1e6).toFixed(2)} MB`,
  );
  return { seconds, size };
}

/* ── the whole thing ──────────────────────────────────────────────────────── */

async function main() {
  const dist = path.join(REFERENCE, "dist");
  try {
    await stat(path.join(dist, "index.html"));
  } catch {
    throw new Error(
      `${dist}/index.html is missing — run \`npm ci && npm run build\` in ` +
        `references/none first`,
    );
  }
  await mkdir(WORK, { recursive: true });
  await mkdir(OUT, { recursive: true });

  const d = await design(SITE);
  say(`Gantry showcase capture — site ${SITE}, "${d.name}"`);
  say(
    ` ${d.members.length} members, ${d.counterweights.length} counterweight(s), ` +
      `${d.tape.length} tape steps`,
  );

  const server = await serveDist(dist);
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  try {
    const recording = await videoPass(browser, server.url, d);
    const clip = await cutClip(recording, path.join(OUT, "gameplay.webm"));
    if (clip.size > 25e6) {
      throw new Error(`gameplay.webm is ${(clip.size / 1e6).toFixed(1)} MB, over the 25 MB cap`);
    }
    await stillsPass(browser, server.url, d, recording.track);
  } finally {
    await browser.close();
    await server.close();
  }

  const shipped = (await readdir(OUT)).filter((f) => /\.(webm|png)$/.test(f)).sort();
  say(`\nWrote ${shipped.length} file(s) to ${OUT}:`);
  for (const f of shipped) {
    const { size } = await stat(path.join(OUT, f));
    say(`  ${f.padEnd(24)} ${(size / 1024).toFixed(0)} KB`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
