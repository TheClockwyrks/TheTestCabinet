// Case-specific helpers for Valence's automated-validation debug scripts.
//
// Every script here drives the real, deterministic simulation through
// window.__valence (see specs/instrumentation.md): control ops only ESTABLISH
// preconditions, then `step` runs the real systems forward and `snapshot` reads the
// outcome back. Nothing fabricates a result. These helpers factor out the common
// "select a map, place a real tower beside a lane, pose a real unit, step the real
// sim, read what happened" patterns and the board geometry the scripts depend on
// (derived at runtime from the snapshot's `paths`, not hardcoded).
//
// The assertion primitives themselves are NOT here — they are the reporter-side `ttc`
// kit the driver hands every `drive(api, ttc)` (see packages/browser-driver/ttc.mjs),
// the single source of truth shared by every case. This file holds only what is
// specific to Valence.
//
// The manual clock (specs/instrumentation.md): `reset()`/`step()` put the sim under
// the driver's clock (`autoStep = false`), so `step(dt)` advances EXACTLY `dt` and a
// measurement is exact regardless of machine load. For a motion CLIP, `liveClip` flips
// `autoStep` back on around a real `wait`, so a video output shows on-screen motion.

// ---- Stage + timing constants (specs/overview.md, specs/controls.md) ----------
export const STAGE_W = 1280;
export const STAGE_H = 720;
export const FIXED = 1 / 60; // physics timestep (matches FIXED_STEP)

// The map ids the campaign offers (specs/board.md). Derived at runtime too (a
// snapshot lists `maps`), but named here so a script reads by intent.
export const MAP = { single: "conduit", branching: "junction", multiple: "lattice" };

// Generous preconditions for scenarios that must simply afford towers or never lose.
export const HUGE_ENERGY = 100000;
export const HUGE_INTEGRITY = 1e9;
export const TOTAL_ROUNDS = 40;

// Economy tuning mirrored from specs/campaign.md, for the exact economy assertions.
export const INTEREST_RATE = 0.05;
export const INTEREST_CAP = 50;
export function roundClearBonus(round) {
  return 100 + round;
}
/** The interest a between-round build phase pays on a bank of `energy`. */
export function interestOn(energy) {
  return Math.min(INTEREST_CAP, Math.floor(energy * INTEREST_RATE));
}

// ---- Stepping -----------------------------------------------------------------
/**
 * Advance the real simulation in fixed-step chunks until `predicate(snapshot)` holds
 * or `maxSeconds` of game time elapse. Returns `{ snap, hit, steps }`. `chunk`
 * controls granularity: pass FIXED (one step) to read state the instant something
 * happens (a bounce, a short-lived particle burst), or a coarser value when the
 * quantity is stable between events so the sweep is cheap.
 */
export async function stepUntil(api, predicate, maxSeconds, chunk = FIXED) {
  let snap = await api.snapshot();
  if (predicate(snap)) return { snap, hit: true, steps: 0 };
  const iters = Math.ceil(maxSeconds / chunk);
  for (let i = 0; i < iters; i += 1) {
    await api.step(chunk);
    snap = await api.snapshot();
    if (predicate(snap)) return { snap, hit: true, steps: i + 1 };
  }
  return { snap, hit: false, steps: iters };
}

/**
 * Flip the game back to real-time (autoStep true) around a real wall-clock wait so a
 * video output captures on-screen motion, then return to manual stepping. The sim
 * advances only while playing and unpaused, so a posed build-phase scenario (matter
 * flowing, towers firing) animates during the clip.
 */
export async function liveClip(api, ms = 1300) {
  await api.call("setAutoStep", true);
  await api.wait(ms);
  await api.call("setAutoStep", false);
}

// ---- Snapshot reads -----------------------------------------------------------
export function unitById(snap, id) {
  return snap.matter.find((u) => u.id === id) ?? null;
}
export function towerById(snap, id) {
  return snap.towers.find((t) => t.id === id) ?? null;
}

// ---- Path geometry (derived from a path snapshot) -----------------------------
/**
 * Build a geometry reader over one path's dense polyline (`{ points, length }` from
 * the snapshot). `pointAt(s)` returns `{ x, y, ang }` at arc length `s` toward the
 * collector (with the local tangent angle); `length` is the total arc length. This is
 * how a script converts a progress along a path into a world point (to place a tower
 * beside it, or read where a unit will be) without hardcoding any map's coordinates.
 */
export function pathGeom(pathSnap) {
  const pts = pathSnap.points;
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const length = cum[cum.length - 1];
  function pointAt(s) {
    const t = Math.max(0, Math.min(length, s));
    let seg = 1;
    while (seg < cum.length - 1 && cum[seg] < t) seg += 1;
    const a = pts[seg - 1];
    const b = pts[seg];
    const segLen = cum[seg] - cum[seg - 1];
    const f = segLen > 0 ? (t - cum[seg - 1]) / segLen : 0;
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      ang: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }
  return { length, pointAt, points: pts };
}

// ---- Run set-up ---------------------------------------------------------------
/**
 * Begin a driven run on `mapId` and set the economy preconditions. Returns the
 * snapshot after set-up. `round` (optional) primes the round the next `startRound`
 * would build; energy/integrity default generous so scenarios can afford towers and
 * never lose by accident. Order matters: `selectMap` starts the run (setting the
 * mode's own energy/integrity), so the overrides are applied after it.
 */
export async function startRun(api, mapId = MAP.single, { seed = 1, energy = HUGE_ENERGY, integrity = HUGE_INTEGRITY, round } = {}) {
  await api.reset({ seed });
  await api.call("selectMap", mapId);
  if (round != null) await api.call("setRound", round);
  if (energy != null) await api.call("setEnergy", energy);
  if (integrity != null) await api.call("setIntegrity", integrity);
  return api.snapshot();
}

/**
 * Place a real tower of `kind` so it covers arc length `s` on `pathGeomObj` — offset
 * off the path centerline along its local normal (so it sits beside the lane, not on
 * it), trying a few offsets and both sides until the real placement path accepts it.
 * Routes through the real `placeTower`, so the returned tower is a real tower the
 * damage model uses. Returns `{ id, x, y, p, s }`. Ensure energy is set high first.
 */
export async function placeCovering(api, kind, pathGeomObj, s, { offsets = [40, 48, 58, 34, 70, 84], sides = [-1, 1] } = {}) {
  const p = pathGeomObj.pointAt(s);
  const nx = -Math.sin(p.ang);
  const ny = Math.cos(p.ang);
  for (const off of offsets) {
    for (const side of sides) {
      const x = p.x + nx * off * side;
      const y = p.y + ny * off * side;
      const r = await api.call("placeTower", kind, x, y);
      if (r && r.ok) return { id: r.id, x, y, p, s };
    }
  }
  throw new Error(`placeCovering(${kind}) found no legal spot near s=${s}`);
}

/**
 * The smallest arc length on `pathGeomObj` at which a placed `tower` (its snapshot, with
 * world `x`/`y` and effective `range`) first has the path within `margin` of its range.
 * A unit spawned here enters the tower's range at its UPSTREAM edge and then travels the
 * WHOLE in-range window forward, so a tower gets its full dwell on the unit — the fair way
 * to time a full neutralize. A unit posed AT the tower's centre only ever gets the forward
 * half of the window before it walks out, which is not enough dwell for a tough unit.
 */
export function firstInRange(pathGeomObj, tower, { margin = 0.92, stepPx = 3 } = {}) {
  const R = tower.range * margin;
  for (let s = 0; s <= pathGeomObj.length; s += stepPx) {
    const p = pathGeomObj.pointAt(s);
    if (Math.hypot(p.x - tower.x, p.y - tower.y) <= R) return s;
  }
  return 0;
}

/**
 * Begin a run, place a real tower of `kind` beside the middle of path 0, and pose a unit
 * of `type` at the UPSTREAM edge of that tower's range (via `firstInRange`), so the unit
 * travels the full in-range window under the tower — the dwell a tough unit needs to be
 * fully neutralized by a single tower. Everything routes through the real systems; the
 * caller then `step`s the sim and reads the outcome. Returns
 * `{ g, tower, towerId, unitId, snap0 }`.
 */
export async function coverAndPassThrough(api, { kind, type = "atom", electrons, mapId = MAP.single, towerFrac = 0.5, seed = 1 } = {}) {
  const snap = await startRun(api, mapId, { seed });
  const g = pathGeom(snap.paths[0]);
  const tower = await placeCovering(api, kind, g, towerFrac * g.length);
  const towerSnap = towerById(await api.snapshot(), tower.id);
  const s = firstInRange(g, towerSnap);
  const unitId = await spawnAt(api, { type, electrons, pathId: 0, s });
  return { g, tower, towerId: tower.id, unitId, snap0: await api.snapshot() };
}

/**
 * Place `n` real towers of `kind` spread evenly over the stretch of `pathGeomObj` between
 * arc lengths `from` and `to`, so a unit travelling that stretch is under sustained fire.
 * The heaviest matter (a Lattice, the Macromass) carries far more total shells than one
 * tower's dwell can strip, so a check that must see a unit all the way down needs a
 * BATTERY, not a single tower. Returns the placed towers. Ensure energy is set high first.
 */
export async function battery(api, kind, pathGeomObj, from, to, n) {
  const placed = [];
  for (let i = 0; i < n; i += 1) {
    const s = from + ((to - from) * i) / Math.max(1, n - 1);
    placed.push(await placeCovering(api, kind, pathGeomObj, s));
  }
  return placed;
}

/**
 * Point every damage tower at the LEAST-advanced valid unit in its range. A cluster sheds
 * its freed atoms just AHEAD of itself, so a tower left on the default FIRST priority
 * abandons the cluster for its own fragments the moment one is shed — which both stalls
 * the cluster and mixes the fragments' payouts into a measurement meant to be about the
 * cluster. LAST keeps every shot on the parent, since its fragments are always ahead of
 * it. Routes through the real `setTargeting` control (specs/instrumentation.md).
 */
export async function focusOnParent(api) {
  for (const t of (await api.snapshot()).towers) {
    if (t.targeting != null) await api.call("setTargeting", t.id, "last");
  }
}

/**
 * Put one real unit onto a path through the real spawn system. `type` is a matter
 * type (specs/matter.md — "isotope" for a heavy, "noble" inert, "dimer"/"polymer"
 * bonded, "lattice" the big cluster, "chelate"/"shroud" the late combos, "macromass" the
 * boss), `electrons` sizes a plain atom, `inert` releases it shielded whichever traits its
 * type already carries (the round table's inert modifier, specs/matter.md), `pathId`/`s`
 * place it. Returns its id.
 */
export async function spawnAt(api, { type = "atom", electrons, inert, pathId = 0, s = 0 } = {}) {
  const spec = { type, pathId, progress: s };
  if (electrons != null) spec.electrons = electrons;
  if (inert != null) spec.inert = inert;
  return api.call("spawnUnit", spec);
}

/**
 * The common damage set-up: begin a run, place a tower of `kind` beside path 0 at
 * `frac` of its length, and pose a unit of `type` at that same point (so the tower
 * covers it). Returns `{ g, s, towerId, unitId }` plus the initial snapshot. The
 * caller then `step`s the real sim and reads the outcome — nothing about the result
 * is set up here.
 */
export async function coverAndSpawn(api, { kind, type = "atom", electrons, mapId = MAP.single, frac = 0.18, round } = {}) {
  const snap = await startRun(api, mapId, { round });
  const g = pathGeom(snap.paths[0]);
  const s = frac * g.length;
  const tower = await placeCovering(api, kind, g, s);
  const unitId = await spawnAt(api, { type, electrons, pathId: 0, s });
  const snap0 = await api.snapshot();
  return { g, s, towerId: tower.id, tower, unitId, snap0 };
}

// ---- Round driving ------------------------------------------------------------
/**
 * Run a whole real round on `mapId` with NO towers, so every unit reaches the
 * collector and leaks (no bounties are paid, keeping the economy clean), and step
 * until the round resolves — back to the between-round build phase, or to victory/
 * defeat. Integrity defaults huge so a no-tower round does not lose by accident.
 * Returns the snapshot at the resolution. Used by the round/economy checks that need
 * a genuinely cleared round (round-clear bonus, interest, early-send, victory).
 */
export async function runNoTowerRound(api, { mapId = MAP.single, round = 1, energy = 0, integrity = HUGE_INTEGRITY, maxSeconds = 320 } = {}) {
  await api.reset({ seed: 1 });
  await api.call("selectMap", mapId);
  await api.call("setRound", round);
  await api.call("setEnergy", energy);
  await api.call("setIntegrity", integrity);
  await api.call("startRound");
  const r = await stepUntil(api, (s) => s.phase === "build" || s.screen !== "playing", maxSeconds, 2);
  return r.snap;
}

// ---- Menu input ---------------------------------------------------------------
/**
 * From a freshly reset title, drive the menu down `steps` entries and confirm — the
 * same keyboard path a player uses (specs/controls.md). A fresh page opens with the
 * first entry highlighted, so `steps` counts entries below it.
 */
export async function navigateMenu(api, steps) {
  for (let i = 0; i < steps; i += 1) await api.call("press", "ArrowDown");
  await api.call("press", "Enter");
}

// ---- Pixel / color sampling (reads the rendered canvas) -----------------------
//
// Utilities for reading the pixels the build actually PAINTS, through the driver's
// api.pixel(u, v) — `u`, `v` are fractions across the game canvas (0..1), so a
// logical stage coordinate maps to a fraction by dividing by the stage size and a
// script never needs the canvas's pixel dimensions. Reading a rendered pixel (rather
// than a value the game reports) means a build cannot pass by returning a color it
// does not draw.

/** Sample the rendered color at a logical stage point (x in 0..1280, y in 0..720). */
export async function samplePixel(api, x, y) {
  return api.pixel(x / STAGE_W, y / STAGE_H);
}

/** Euclidean distance between two RGB colors (0 to ~441). */
export function colorDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}
