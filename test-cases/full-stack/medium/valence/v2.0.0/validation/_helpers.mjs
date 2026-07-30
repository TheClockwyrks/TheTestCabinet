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

// Map SELECTORS by the mandated `style` enum (specs/instrumentation.md's `maps[].style`).
// specs/board.md requires both styles to appear SOMEWHERE in the set and explicitly leaves
// which map takes which to the model: "The single-path, branching, and multiple-path maps
// above may each pick either style, so long as both styles appear somewhere in the set." So
// a check that needs a curved or a straight board must ask for it BY STYLE and let the
// build answer — pairing a style with a topology (the curved map is the single one, the
// straight map is the branching one) only describes one conformant arrangement of several.
export const STYLE = {
  curved: "curved",
  straight: "straight",
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

/**
 * Build the error an item throws when its scenario cannot be POSED against this build — the
 * debug API answered every call correctly, there simply was no such spot / shape in the
 * model's own world. The driver reads it as INCONCLUSIVE rather than as a conformance
 * failure (see `PRECONDITION_UNMET` in `packages/browser-driver/validation.mjs`). It sets
 * the documented flag directly rather than importing the runtime's factory, because a case's
 * `validation/` folder is loaded by path and has no resolvable specifier for that module.
 */
export function preconditionUnmet(reason) {
  const err = new Error(String(reason));
  err.ttcPreconditionUnmet = true;
  return err;
}

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

/**
 * The arc length on `pathGeomObj` whose world point is FARTHEST from `tower`, with that
 * distance. The mirror of `firstInRange`, for a check that needs a unit the tower plainly
 * cannot reach: a map's geometry is the model's own, and a serpentine legitimately folds a
 * far-along arc length back alongside the tower, so "half way down the path" is not a
 * synonym for "out of range". This finds the point that really is furthest away and hands
 * back the distance so the item can state the clearance it got rather than assume one.
 *
 * `from`/`to` bound the search, which a caller almost always wants: the point furthest from
 * a tower near the inlet is usually the collector itself, and a unit posed there leaks
 * before the window is out. Leave a margin of at least the fastest atom's travel (speed up
 * to 112 px/s, specs/matter.md) over the window being measured.
 *
 * Pure computation — callable from any phase.
 */
export function farthestFrom(
  pathGeomObj,
  tower,
  { stepPx = 4, from = 0, to = pathGeomObj.length } = {},
) {
  let best = { s: from, dist: -1 };
  for (
    let s = Math.max(0, from);
    s <= Math.min(pathGeomObj.length, to);
    s += stepPx
  ) {
    const p = pathGeomObj.pointAt(s);
    const d = Math.hypot(p.x - tower.x, p.y - tower.y);
    if (d > best.dist) best = { s, dist: d };
  }
  return best;
}

// ---- Two paths: where they coincide, and where they diverge --------------------
//
// A branching map's fork is two paths that COINCIDE on a shared trunk (the inlet approach)
// AND/OR a shared final run, then diverge into distinct lanes between them (specs/board.md).
// Which of those a conformant map shares is the model's own choice — board.md also allows
// the lanes to "diverge to their own collectors", and allows per-path inlets and collectors
// — so a check must READ the shared and divergent stretches off the geometry rather than
// assume the fork shares both endpoints. These helpers do that, and are what
// `maps.branching-fork` and `placement.covers-both-lanes` build their scenarios from.

/**
 * For each of `samples` arc lengths along `ga`, the closest approach to `gb`: `{ s, sOther,
 * gap }`, where `sOther` is the arc length on `gb` that comes closest and `gap` the distance
 * between the two points. Pure computation over two `pathGeom` readers — any phase.
 */
export function laneGaps(ga, gb, { samples = 200 } = {}) {
  const rows = [];
  for (let i = 0; i <= samples; i += 1) {
    const s = (ga.length * i) / samples;
    const p = ga.pointAt(s);
    let best = { sOther: 0, gap: Infinity };
    for (let j = 0; j <= samples; j += 1) {
      const so = (gb.length * j) / samples;
      const q = gb.pointAt(so);
      const gap = Math.hypot(p.x - q.x, p.y - q.y);
      if (gap < best.gap) best = { sOther: so, gap };
    }
    rows.push({ s, ...best });
  }
  return rows;
}

/**
 * The longest run of `laneGaps` rows whose `gap` stays within `tol` — a stretch the two
 * paths genuinely SHARE — reported as its middle sample plus how much of `ga` it spans.
 * Returns `null` when the paths never coincide. `tol` is deliberately tight (a few pixels):
 * a shared segment is the same world points, not merely two lanes running near each other.
 */
export function sharedStretch(rows, { tol = 6 } = {}) {
  let best = null;
  let from = -1;
  const close = (to) => {
    if (from < 0) return;
    const span = rows[to].s - rows[from].s;
    if (!best || span > best.span) {
      best = { ...rows[Math.floor((from + to) / 2)], span, from, to };
    }
    from = -1;
  };
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].gap <= tol) {
      if (from < 0) from = i;
    } else close(i - 1);
  }
  close(rows.length - 1);
  return best;
}

/** The `laneGaps` row where the two paths are furthest apart — the heart of a divergent lane. */
export function widestGap(rows) {
  return rows.reduce((a, b) => (b.gap > a.gap ? b : a), rows[0]);
}

// ---- Run set-up ---------------------------------------------------------------
//
// `startRun` (arrange) and `poseRun` (either phase) reach the same state; see the
// `poseX` note in the file header for why both exist.

/**
 * Resolve a map SELECTOR to the `id` THIS build gave the matching map, read back from the
 * snapshot's `maps` list. Ids are the model's own (specs/instrumentation.md), so a check
 * keys the map by one of the fixed enums and never by a literal id: a `MAP.*` topology, a
 * `STYLE.*` path style, or a difficulty. Tried in that order, so `MAP.single` still means
 * "the single-path map" whichever style it happens to be drawn in.
 */
async function resolveMapId(api, selector) {
  const { maps } = await api.snapshot();
  const m =
    maps.find((x) => x.topology === selector) ??
    maps.find((x) => x.style === selector) ??
    maps.find((x) => x.difficulty === selector);
  if (!m) {
    throw new Error(
      `no map exposes topology/style/difficulty "${selector}" (saw ${maps
        .map((x) => `${x.id}=${x.topology}/${x.style}`)
        .join(", ")})`,
    );
  }
  return m.id;
}

/** The economy/round preconditions both run-starters apply, in the order that matters. */
async function applyRunPreconditions(
  api,
  selector,
  { energy, integrity, round },
) {
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
  // API. Mark it inconclusive rather than failing the run.
  throw preconditionUnmet(
    `placeCovering(${kind}) found no legal spot near s=${s}`,
  );
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

// How long to let the build PAINT its menu before injecting keys into it.
//
// A menu key only means something once the build has laid the menu out, and a build is
// entitled to do that as it draws: hit-testing keyboard selection against the entries the
// last drawn frame produced is a perfectly ordinary way to write one, and the reference and
// the builds seen so far both do something along those lines. Nothing in specs/controls.md
// requires the menu to answer a key pressed before the first frame — a player cannot press
// one that early — so a check that injects keys immediately is testing the harness's timing,
// not the build. It was doing exactly that: `states.howto` settled 60 ms after `reset()` and
// then pressed, which on a cold page can land before any frame has run, and the item reported
// a build whose HOW TO PLAY entry works perfectly a moment later as unreachable. A settle is
// REAL time in both passes, which is what makes it the right instrument here.
const MENU_PAINT_MS = 400;

/**
 * From a freshly reset title, drive the menu down `steps` entries and confirm — the
 * same keyboard path a player uses (specs/controls.md). A fresh page opens with the
 * first entry highlighted, so `steps` counts entries below it.
 *
 * Opens with a real paint settle (see `MENU_PAINT_MS`); the presses themselves consume no
 * simulation time, so this is callable from either phase.
 */
export async function navigateMenu(api, steps) {
  await api.settle(MENU_PAINT_MS);
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

// ---- Audio (reads the Web Audio cues the build actually schedules) ----------
//
// Valence's sound is the PRODUCED .wav files (`sfx-synth`/`sfx-sample`/`music`,
// specs/assets.md), decoded and played through the Web Audio API, so the driver
// reports every source the build starts (see `api.audio`). The game must not
// autoplay: it creates its AudioContext only on the first real user interaction
// (main.ts's `gesture()`, fired from a buffered click OR key), so before driving an
// event whose cue is checked, arm audio with a GENUINE browser gesture. A build may
// feed the debug API through a purely logical input path and unlock audio only from a
// real DOM event, so arming uses both `api.userKey` and a corner `api.userClick`
// rather than a debug `press` — a debug press would leave a conformant build's
// AudioContext uncreated, so no cue would ever be scheduled though it plays fine for
// a real player. `KeyZ` has no game binding (main.ts's `routeKey`/menu handling never
// matches it) and (4, 4) sits in the empty top-left of the 56px status bar — left of
// its controls (the speed/pause/mute buttons start at x=1112) and above the board
// hit-test (`y > STATUS_H`, specs/board.md), so arming never places a tower, selects a
// unit, or activates a menu, in any screen.
//
// UNLOCK TIMING: unlike a synthesized cue, resuming here kicks off an ASYNC fetch +
// `decodeAudioData` of every produced clip (`audio.ts`'s `resume`), and `gesture()`
// does not await it. A cue driven before its clip finishes decoding is silently
// dropped (`Audio.play` no-ops when `this.buffers` has no entry yet for that cue) —
// permanently, since the queue that carried it is cleared every frame regardless. A
// short REAL settle after arming gives the decode time to land before an item drives
// its cue; `advance` would not do this, since it is an exact instant `step` on the
// validate pass's manual clock and lets no real (wall-clock) time pass for the fetch
// to progress.
//
// ARMING MUST ALSO GO QUIET. The gesture does not only unlock audio — it is what starts the
// looping music bed (specs/assets.md: "loop the music bed"), and a build may start that bed a
// beat later, once its clip has decoded or off a short timer. Anything the gesture kicks off
// this way lands in the audio log at some unpredictable moment shortly afterwards, and an
// event-cue check measures a DELTA: if the bed arrives inside its window, the check counts the
// bed as the event's cue. It did — with a fixed 300 ms arm, a build that starts its bed on a
// 500 ms timer satisfied `audio.build` and `audio.shot-strip` with their own cues deleted. So
// arming waits until the log stops growing, and every cue check then takes its baseline with
// the bed already counted. A build that loops by starting a fresh source per repeat would
// never go quiet; the bound below gives up rather than hang, which is the one shape this
// count-only probe cannot fully isolate.
const ARM_SETTLE_MS = 300;
const ARM_QUIET_STEP_MS = 120;
const ARM_QUIET_MAX_MS = 2400;

export async function armAudio(api) {
  await api.userKey("KeyZ");
  await api.userClick(4, 4);
  await api.settle(ARM_SETTLE_MS);
  // Wait until the log has something in it AND has stopped growing. Both halves matter: a
  // count that is still zero says nothing has started YET, which is indistinguishable from a
  // build with no bed — and stopping there is what let the bed arrive later, inside a cue
  // check's window. A build that really plays nothing simply spends the bound.
  let previous = -1;
  let count = await audioCount(api);
  for (
    let waited = 0;
    waited < ARM_QUIET_MAX_MS && (count === 0 || count !== previous);
    waited += ARM_QUIET_STEP_MS
  ) {
    previous = count;
    await api.settle(ARM_QUIET_STEP_MS);
    count = await audioCount(api);
  }
}

/** The number of Web Audio sources the build has started so far. */
export async function audioCount(api) {
  return (await api.audio()).length;
}

/**
 * Read `audioCount` after a real repaint pause.
 *
 * A build may QUEUE its cues from the simulation and play them when it next paints (the
 * reference does exactly that: `main.ts`'s frame drains `sndQueue` through `audio.play`),
 * so a cue scheduled during an instant `step` has not reached Web Audio yet — and
 * `api.advance` cannot help, because on the validate pass it consumes no wall clock at all.
 * Settling on BOTH sides of a measurement is what makes the delta mean "the cues this span
 * played", rather than racing whichever frames happened to land between driver round trips.
 */
async function settledAudioCount(api) {
  await api.settle(80);
  return audioCount(api);
}

/**
 * Wait — in REAL time, bounded — until the build has started more Web Audio sources than
 * `baseline`, and return the count it reached.
 *
 * For a cue whose window contains nothing else that could make a sound, "did it play?" is a
 * question about eventually, not about a particular millisecond. A build is entitled to put
 * the cue a beat after the trigger: to defer the music bed until its clip has decoded, to
 * start it off a short timer after the unlocking gesture, to drain a queue on its next
 * animation frame. None of that is visible to a player, and none of it is forbidden — so a
 * check that settles a fixed 100 or 300 ms and then reads once is measuring the harness's
 * patience. It was: `audio.music` read the log 300 ms after arming and reported "no source
 * starts for the reactor music bed" against a build that starts its bed on a 500 ms timer.
 *
 * Use this only where the event under test is the ONLY thing in the window that can play —
 * a placement, a leak, the music bed. Where a firing tower is also making noise, the window
 * has to stay tight instead; see `cueOnImpact`.
 */
export async function audioCountAbove(
  api,
  baseline,
  { max = 3000, step = 100 } = {},
) {
  let count = await audioCount(api);
  for (let waited = 0; waited < max && count <= baseline; waited += step) {
    await api.settle(step);
    count = await audioCount(api);
  }
  return count;
}

/**
 * Measure the Web Audio sources a build starts across ONE IMPACT on `unitId` — the impact
 * that fires `event` — and report the count it gained.
 *
 * Why not simply compare the log before and after a window that contains the event: a
 * damage tower plays a cue every time it FIRES (specs/assets.md, "the shot cue when a
 * damage tower fires"), so any window long enough to contain a bond snap, a decay, or a kill
 * also contains several shot cues, and the log grows whether or not the event has its own
 * cue at all. That is not a check of the event's cue — it passes on the shots alone, and
 * did: `audio.bond-snap` recorded "a bond-snap cue plays on the snap" as satisfied on a run
 * where the bond never snapped.
 *
 * So this walks the fire on the unit impact by impact. For each, it skips (instantly, in
 * both passes) to the brink — a NEW shot already in the air at the unit, so that shot's own
 * launch cue is behind the baseline — takes the baseline, and then watches only until the
 * event fires or that shot is spent. The gain across that span is what the event itself
 * played. `window` stays well inside a damage tower's reload (the slowest is the Reactor's
 * 0.6/s, 100 ticks), so no further shot can be launched inside a measured span.
 *
 * `event(snapshot)` is evaluated exactly ONCE per sample and its verdict is remembered, so a
 * caller may keep state in it (the id set an "a fragment was emitted" predicate needs, say)
 * without the bookkeeping being run twice on the sample that matters most — the same
 * guarantee `api.until` gives.
 *
 * Consumes time, so `act` only. Returns `{ hit, gained, shots, snap }`.
 */
export async function cueOnImpact(
  api,
  unitId,
  event,
  { shots = 8, approach = 900, window = 45 } = {},
) {
  const inFlight = new Set();
  for (let i = 1; i <= shots; i += 1) {
    const armed = await api.skipUntil(
      (s) =>
        s.projectiles.some((p) => p.targetId === unitId && !inFlight.has(p.id)),
      { max: approach, poll: TICK },
    );
    if (!armed.hit) break;
    for (const p of armed.snap.projectiles) {
      if (p.targetId === unitId) inFlight.add(p.id);
    }
    const before = await settledAudioCount(api);
    let fired = false;
    const r = await api.until(
      (s) => {
        if (event(s)) fired = true;
        return fired || !s.projectiles.some((p) => inFlight.has(p.id));
      },
      { max: window, poll: TICK },
    );
    const gained = (await settledAudioCount(api)) - before;
    if (fired) return { hit: true, gained, shots: i, snap: r.snap };
  }
  return { hit: false, gained: 0, shots: 0, snap: await api.snapshot() };
}
