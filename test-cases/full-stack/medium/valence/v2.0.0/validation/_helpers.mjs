// Case-specific helpers for Valence's automated-validation items.
//
// Every helper here drives the real, deterministic simulation through
// window.__valence (see specs/instrumentation.md): control ops only ESTABLISH
// preconditions, then time runs the real systems forward and `snapshot` reads the
// outcome back. Nothing fabricates a result. These helpers factor out the common
// "select a map, place a real tower beside a lane, pose a real unit, run the real
// sim, read what happened" patterns and the board geometry the items depend on
// (derived at runtime from the snapshot's `paths`, not hardcoded).
//
// The helpers are split along the runtime's arrange/act seam (see
// `packages/browser-driver/validation.mjs`). An item runs TWICE — once with time
// instant to decide the verdict, once in real time to record the media — and the
// runtime enforces the split by throwing if `arrange` consumes time:
//
//   * `arrangeX(api, ...)` / a plain poser — control ops and instant reads only.
//     Callable from `arrange`, runs in BOTH passes, so the record pass reaches
//     `act` in exactly the state the check saw.
//   * `actX(api, ...)` — consumes time via `api.advance` / `api.until` and returns
//     the outcome the assertions read. Callable from `act`, and the only part
//     filmed.
//
// A THIRD group is specific to this case: `poseX` helpers. Valence's scenarios
// often need a SECOND fresh run part-way through an item (thirteen of the items
// begin two or three runs), and `api.reset()` throws in `act` because it would take
// the clock back and freeze the recording. So each run-starting helper comes in two
// forms with identical set-up — an `arrange`-only one that opens with `api.reset`
// (seeding the randomness), and a `poseX` twin that reaches the same state with
// CONTROL OPS ONLY and is therefore callable from `act` as well. `selectMap` itself
// restarts a run from scratch (clearing energy, integrity, round, matter, and
// towers), so the twin is a genuine fresh run and not a partial one — it just
// cannot re-seed, since only `reset` takes a seed. Use the plain form for the run
// an item arranges, the `poseX` twin for any later run it opens inside `act`.
//
// UNITS ARE TICKS. Valence is a 60 Hz fixed timestep (specs/controls.md) and the
// debug API's `step` takes whole ticks, so every duration below is a tick count
// (the runtime converts to wall-clock for the record pass). The seconds these
// replace are noted inline. Conversion is `ticks = seconds * 60`.
//
// GAME SPEED AND THE RECORD PASS: `setSpeed(n)` scales how many ticks pass per real
// second (specs/controls.md), so in the record pass — where the game drives its own
// clock — a posed speed of 2 or 3 makes `advance(n)` cover MORE than n ticks of game
// time. It has no effect on the validate pass, where `advance` is an exact `step`.
// An item that poses a non-default speed must therefore read its verdict from what
// `act` captured, never assume a wall-clock duration.
//
// The assertion primitives themselves are NOT here — they are the reporter-side
// `ttc` kit (`packages/browser-driver/ttc.mjs`), the single source of truth shared
// by every case. This file holds only what is specific to Valence.

// ---- Stage + timing constants (specs/overview.md, specs/controls.md) ----------
export const STAGE_W = 1280;
export const STAGE_H = 720;

// The simulation rate, and the finest granularity a sweep can poll at. One tick is
// one fixed simulation step (this replaces the old `FIXED = 1/60` seconds constant);
// pass `poll: TICK` to `api.until` when the exact instant of an event matters — a
// shed electron, a bond snapping, a short-lived particle burst.
export const TICK_HZ = 60;
export const TICK = 1;

// Map SELECTORS, keyed by the mandated `topology` enum (specs/instrumentation.md's
// `maps[].topology`; specs/board.md guarantees one map at each difficulty/topology). A
// map's `id` is the model's OWN free choice — specs/instrumentation.md: "the available
// map ids are the `id`s in the snapshot's `maps` list" — so a check must NEVER hardcode
// an id. It names the map it wants by topology and `applyRunPreconditions` resolves that
// to whatever id this build gave the map. (An earlier `multiple: "lattice"` hardcode
// matched no map and silently selected nothing; `lattice` is a matter type, not a map.)
export const MAP = {
  single: "single",
  branching: "branching",
  multiple: "multiple",
};

// Generous preconditions for scenarios that must simply afford towers or never lose.
export const HUGE_ENERGY = 100000;
export const HUGE_INTEGRITY = 1e9;
export const TOTAL_ROUNDS = 40;

// Economy tuning mirrored from specs/gameplay.md, for the exact economy assertions.
export const INTEREST_RATE = 0.05;
export const INTEREST_CAP = 50;
export function roundClearBonus(round) {
  return 100 + round;
}
/** The interest a between-round build phase pays on a bank of `energy`. */
export function interestOn(energy) {
  return Math.min(INTEREST_CAP, Math.floor(energy * INTEREST_RATE));
}

// ---- Snapshot reads -----------------------------------------------------------
//
// Pure reads of a snapshot already in hand: no api call, no time, so they are
// callable from any phase.

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
 * how an item converts a progress along a path into a world point (to place a tower
 * beside it, or read where a unit will be) without hardcoding any map's coordinates.
 *
 * Pure computation over a snapshot in hand — callable from any phase.
 */
export function pathGeom(pathSnap) {
  const pts = pathSnap.points;
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) {
    cum.push(
      cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y),
    );
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

/**
 * The smallest arc length on `pathGeomObj` at which a placed `tower` (its snapshot, with
 * world `x`/`y` and effective `range`) first has the path within `margin` of its range.
 * A unit spawned here enters the tower's range at its UPSTREAM edge and then travels the
 * WHOLE in-range window forward, so a tower gets its full dwell on the unit — the fair way
 * to time a full neutralize. A unit posed AT the tower's centre only ever gets the forward
 * half of the window before it walks out, which is not enough dwell for a tough unit.
 *
 * Pure computation — callable from any phase.
 */
export function firstInRange(
  pathGeomObj,
  tower,
  { margin = 0.92, stepPx = 3 } = {},
) {
  const R = tower.range * margin;
  for (let s = 0; s <= pathGeomObj.length; s += stepPx) {
    const p = pathGeomObj.pointAt(s);
    if (Math.hypot(p.x - tower.x, p.y - tower.y) <= R) return s;
  }
  return 0;
}

// ---- Run set-up ---------------------------------------------------------------
//
// `startRun` (arrange) and `poseRun` (either phase) reach the same state; see the
// `poseX` note in the file header for why both exist.

/**
 * Resolve a map SELECTOR (a `MAP.*` topology value) to the `id` THIS build gave the map
 * with that topology, read back from the snapshot's `maps` list. Ids are the model's own
 * (specs/instrumentation.md), so a check keys the map by the fixed `topology` enum and
 * never by a literal id. Falls back to matching `difficulty` for robustness.
 */
async function resolveMapId(api, selector) {
  const { maps } = await api.snapshot();
  const m =
    maps.find((x) => x.topology === selector) ??
    maps.find((x) => x.difficulty === selector);
  if (!m) {
    throw new Error(
      `no map exposes topology/difficulty "${selector}" (saw ${maps
        .map((x) => `${x.id}=${x.topology}`)
        .join(", ")})`,
    );
  }
  return m.id;
}

/** The economy/round preconditions both run-starters apply, in the order that matters. */
async function applyRunPreconditions(api, selector, { energy, integrity, round }) {
  // The caller names the map by topology (MAP.*); resolve it to this build's own id
  // first, since ids are model-chosen. Order matters: `selectMap` starts the run
  // (setting the mode's own energy and integrity), so the overrides come after it.
  const mapId = await resolveMapId(api, selector);
  await api.call("selectMap", mapId);
  if (round != null) await api.call("setRound", round);
  if (energy != null) await api.call("setEnergy", energy);
  if (integrity != null) await api.call("setIntegrity", integrity);
  return api.snapshot();
}

/**
 * ARRANGE-only. Begin a driven run on `mapId` from a seeded reset and set the economy
 * preconditions. Returns the snapshot after set-up. `round` (optional) primes the round
 * the next `startRound` would build; energy/integrity default generous so scenarios can
 * afford towers and never lose by accident.
 *
 * Opens with `api.reset({ seed })`, which is what makes the run reproducible — and what
 * makes this arrange-only. To open a further run from inside `act`, use `poseRun`.
 */
export async function startRun(
  api,
  mapId = MAP.single,
  { seed = 1, energy = HUGE_ENERGY, integrity = HUGE_INTEGRITY, round } = {},
) {
  await api.reset({ seed });
  return applyRunPreconditions(api, mapId, { energy, integrity, round });
}

/**
 * Twin of `startRun` callable from EITHER phase: the same fresh run and the same
 * preconditions, reached with control ops alone. `selectMap` restarts the run from
 * scratch — clearing energy, integrity, the round, all matter and every tower — so what
 * this leaves behind is a genuine new run, not a partly-cleaned old one.
 *
 * The one thing it cannot do is re-seed the randomness (only `reset` takes a seed), so a
 * second run posed this way continues from wherever the generator had reached rather than
 * replaying the first run's stream. Every scenario driven here is posed unit-by-unit and
 * tower-by-tower, so that does not affect a verdict; an item that genuinely depends on a
 * fresh seed has to arrange it rather than pose it.
 */
export async function poseRun(
  api,
  mapId = MAP.single,
  { energy = HUGE_ENERGY, integrity = HUGE_INTEGRITY, round } = {},
) {
  return applyRunPreconditions(api, mapId, { energy, integrity, round });
}

/**
 * Place a real tower of `kind` so it covers arc length `s` on `pathGeomObj` — offset
 * off the path centerline along its local normal (so it sits beside the lane, not on
 * it), trying a few offsets and both sides until the real placement path accepts it.
 * Routes through the real `placeTower`, so the returned tower is a real tower the
 * damage model uses. Returns `{ id, x, y, p, s }`. Ensure energy is set high first.
 *
 * Control ops only — callable from either phase.
 */
export async function placeCovering(
  api,
  kind,
  pathGeomObj,
  s,
  { offsets = [40, 48, 58, 34, 70, 84], sides = [-1, 1] } = {},
) {
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
  // The map is the model's own: a conformant build can legitimately have no legal
  // spot for this tower near this arc length, which decides nothing about its debug
  // API. Mark it inconclusive rather than failing the run — see `PRECONDITION_UNMET`
  // in `packages/browser-driver/validation.mjs`.
  const err = new Error(
    `placeCovering(${kind}) found no legal spot near s=${s}`,
  );
  err.ttcPreconditionUnmet = true;
  throw err;
}

/**
 * Place `n` real towers of `kind` spread evenly over the stretch of `pathGeomObj` between
 * arc lengths `from` and `to`, so a unit travelling that stretch is under sustained fire.
 * The heaviest matter (a Lattice, the Macromass) carries far more total shells than one
 * tower's dwell can strip, so a check that must see a unit all the way down needs a
 * BATTERY, not a single tower. Returns the placed towers. Ensure energy is set high first.
 *
 * Control ops only — callable from either phase.
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
 *
 * Control ops only — callable from either phase.
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
 *
 * Control ops only — callable from either phase, which matters: several items pose a
 * SECOND unit part-way through `act` to compare it against the first.
 */
export async function spawnAt(
  api,
  { type = "atom", electrons, inert, pathId = 0, s = 0 } = {},
) {
  const spec = { type, pathId, progress: s };
  if (electrons != null) spec.electrons = electrons;
  if (inert != null) spec.inert = inert;
  return api.call("spawnUnit", spec);
}

// ---- Composite set-ups --------------------------------------------------------
//
// Each comes in the `arrange` / `poseX` pair described in the file header: identical
// set-up, differing only in whether it opens with a seeded `reset` (arrange-only) or
// with control ops alone (either phase).

/** The shared body of `coverAndSpawn` / `poseCoverAndSpawn`; `begin` opens the run. */
async function buildCoverAndSpawn(
  api,
  begin,
  { kind, type = "atom", electrons, mapId = MAP.single, frac = 0.18, round },
) {
  const snap = await begin(api, mapId, { round });
  const g = pathGeom(snap.paths[0]);
  const s = frac * g.length;
  const tower = await placeCovering(api, kind, g, s);
  const unitId = await spawnAt(api, { type, electrons, pathId: 0, s });
  const snap0 = await api.snapshot();
  return { g, s, towerId: tower.id, tower, unitId, snap0 };
}

/**
 * ARRANGE-only. The common damage set-up: begin a run, place a tower of `kind` beside
 * path 0 at `frac` of its length, and pose a unit of `type` at that same point (so the
 * tower covers it). Returns `{ g, s, towerId, tower, unitId, snap0 }`. The item's `act`
 * then runs the real sim and reads the outcome — nothing about the result is set up here.
 */
export async function coverAndSpawn(api, opts = {}) {
  return buildCoverAndSpawn(api, startRun, opts);
}

/** Twin of `coverAndSpawn` callable from EITHER phase (no `reset`). Same return shape. */
export async function poseCoverAndSpawn(api, opts = {}) {
  return buildCoverAndSpawn(api, poseRun, opts);
}

/** The shared body of `coverAndPassThrough` / `poseCoverAndPassThrough`. */
async function buildCoverAndPassThrough(
  api,
  begin,
  {
    kind,
    type = "atom",
    electrons,
    mapId = MAP.single,
    towerFrac = 0.5,
    seed = 1,
  },
) {
  const snap = await begin(api, mapId, { seed });
  const g = pathGeom(snap.paths[0]);
  const tower = await placeCovering(api, kind, g, towerFrac * g.length);
  const towerSnap = towerById(await api.snapshot(), tower.id);
  const s = firstInRange(g, towerSnap);
  const unitId = await spawnAt(api, { type, electrons, pathId: 0, s });
  return { g, tower, towerId: tower.id, unitId, snap0: await api.snapshot() };
}

/**
 * ARRANGE-only. Begin a run, place a real tower of `kind` beside the middle of path 0, and
 * pose a unit of `type` at the UPSTREAM edge of that tower's range (via `firstInRange`), so
 * the unit travels the full in-range window under the tower — the dwell a tough unit needs
 * to be fully neutralized by a single tower. Everything routes through the real systems;
 * the item's `act` then runs the sim and reads the outcome. Returns
 * `{ g, tower, towerId, unitId, snap0 }`.
 */
export async function coverAndPassThrough(api, opts = {}) {
  return buildCoverAndPassThrough(api, startRun, opts);
}

/** Twin of `coverAndPassThrough` callable from EITHER phase (no `reset`). Same return shape. */
export async function poseCoverAndPassThrough(api, opts = {}) {
  return buildCoverAndPassThrough(api, poseRun, opts);
}

// ---- Round driving ------------------------------------------------------------
//
// A whole real round with NO towers, so every unit reaches the collector and leaks (no
// bounties are paid, keeping the economy clean). Used by the round/economy checks that
// need a genuinely cleared round — round-clear bonus, interest, early-send, victory.
// This is the one set-up that consumed time in the old single-pass helper, so it is the
// one that splits into an arrange half and an act half.

/** The shared body of `arrangeNoTowerRound` / `poseNoTowerRound`; `begin` opens the run. */
async function beginNoTowerRound(
  api,
  begin,
  { mapId, round, energy, integrity },
) {
  await begin(api, mapId, { round, energy, integrity });
  await api.call("startRound");
}

/**
 * ARRANGE half of a no-tower round: open a seeded run on `mapId`, set the round and the
 * economy preconditions, and start the round, so the wave is live and running time forward
 * plays it out. Integrity defaults huge so a no-tower round does not lose by accident, and
 * energy defaults to 0 so the bank at the clear is exactly what the round itself paid.
 *
 * Pair with `actNoTowerRound`.
 */
export async function arrangeNoTowerRound(
  api,
  {
    mapId = MAP.single,
    round = 1,
    energy = 0,
    integrity = HUGE_INTEGRITY,
  } = {},
) {
  return beginNoTowerRound(api, startRun, { mapId, round, energy, integrity });
}

/**
 * Twin of `arrangeNoTowerRound` callable from EITHER phase (no `reset`). The economy items
 * that clear TWO rounds to compare their payouts pose the second one with this, from inside
 * `act`, then run it out with a second `actNoTowerRound`.
 */
export async function poseNoTowerRound(
  api,
  {
    mapId = MAP.single,
    round = 1,
    energy = 0,
    integrity = HUGE_INTEGRITY,
  } = {},
) {
  return beginNoTowerRound(api, poseRun, { mapId, round, energy, integrity });
}

/**
 * ACT half of a no-tower round: run the real sim until the round resolves — back to the
 * between-round build phase, or to victory/defeat — and return the snapshot at that
 * resolution. Polls coarsely (120 ticks = the old 2s chunk): nothing read at the
 * resolution changes between the units flowing and the round ending.
 *
 * Pair with `arrangeNoTowerRound` (or `poseNoTowerRound`). Returns the snapshot, which is
 * what the old `runNoTowerRound` returned.
 */
export async function actNoTowerRound(api, { max = 19200, poll = 120 } = {}) {
  // 19200 ticks = the old 320s cap; poll 120 = the old 2s chunk.
  const r = await api.until(
    (s) => s.phase === "build" || s.screen !== "playing",
    { max, poll },
  );
  return r.snap;
}

// ---- Menu input ---------------------------------------------------------------
/**
 * From a freshly reset title, drive the menu down `steps` entries and confirm — the
 * same keyboard path a player uses (specs/controls.md). A fresh page opens with the
 * first entry highlighted, so `steps` counts entries below it.
 *
 * Single key presses, so it consumes no simulation time — callable from either phase.
 */
export async function navigateMenu(api, steps) {
  for (let i = 0; i < steps; i += 1) await api.call("press", "ArrowDown");
  await api.call("press", "Enter");
}

// ---- Pixel / color sampling (reads the rendered canvas) -----------------------
//
// Utilities for reading the pixels the build actually PAINTS, through the driver's
// api.pixel(u, v) — `u`, `v` are fractions across the game canvas (0..1), so a
// logical stage coordinate maps to a fraction by dividing by the stage size and an
// item never needs the canvas's pixel dimensions. Reading a rendered pixel (rather
// than a value the game reports) means a build cannot pass by returning a color it
// does not draw.
//
// A pixel read consumes no simulation time, but it must run in `act` after an
// `api.settle(ms)`: it needs the posed scene to have PAINTED, and in the validate pass
// `advance` is instant and produces no frame at all. See `api.settle` in
// packages/browser-driver/validation.mjs.

/** Sample the rendered color at a logical stage point (x in 0..1280, y in 0..720). */
export async function samplePixel(api, x, y) {
  return api.pixel(x / STAGE_W, y / STAGE_H);
}

/** Euclidean distance between two RGB colors (0 to ~441). Pure — any phase. */
export function colorDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}
