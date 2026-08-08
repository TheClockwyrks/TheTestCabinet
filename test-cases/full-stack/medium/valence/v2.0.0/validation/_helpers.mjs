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
// WHERE A SCENARIO IS POSED: on a SCENARIO ROUND — the live, wave-less, self-holding
// round `startScenario` opens (specs/instrumentation.md). `startScenario`/`poseScenario`
// below open one; every helper that poses matter and runs time goes through them.
//
// This is deliberate and it is worth knowing why, because the obvious alternatives both
// fail. Posing into the opening build phase that `selectMap` leaves you on asks the build
// to run its entity systems in a phase where a player never has matter on the board —
// nothing anyone can see turns on it, so a build that gates its tick on
// `phase === "round"` (an ordinary way to write a tower defence) freezes every scenario
// while playing perfectly by hand. Posing into a REAL round via `startRound` instead
// pours the round's own wave over the single unit under test: its bounties land in the
// energy delta, its leaks in the integrity delta, its atoms compete for the tower's
// target. The scenario round is the board that is neither — the game's real round
// behavior, over only what the check posed.
//
// The checks that are ABOUT a real round — the round-clear bonus, interest, early send,
// victory, the boss milestones, the pause items, the round table's own composition — use
// `startRun`/`poseRun` and drive `startRound` themselves. Those two openers leave the run
// in the opening build phase and are also what a check that reads static state (a map's
// geometry, placement legality, the full opening-phase refund) wants.
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

// ---- Clip framing -------------------------------------------------------------
//
// The record pass films `act` from its very first frame and stops when the clip budget
// runs out (`DEFAULT_CLIP_MS` in packages/browser-driver/validation.mjs, overridable per
// item with a `clipMs` property). So what a reviewer actually sees is decided entirely by
// how an item spends time in `act` — and an item whose `act` is `await api.until(<the
// event>)` and nothing else hands back a clip that OPENS on the event and CUTS the frame
// it lands. That reads as a single frame of nothing in particular: there is no "before" to
// compare against, and no "after" to show the change stuck. Most of this case's items were
// written that way, and the review of them said so — repeatedly, and about a different item
// each time.
//
// So a timed item FRAMES its evidence, in three parts:
//
//   async act(api) {
//     await api.advance(LEAD_TICKS);        // the posed situation, before anything happens
//     r = await api.until(<the event>);     // the behavior the item is about
//     await api.advance(TAIL_TICKS);        // what it left behind
//   }
//
// The lead-in is real simulation time, not a pause: an event that fires during it is filmed
// like any other, and `until` then returns on its first sample having already seen it. So
// the framing never decides a verdict, it only decides what the clip contains.
//
// Where the approach to the event is long — a unit walking most of a lane, a wave playing
// itself out — `arrange` closes with `api.skipUntil(...)`, which runs the same real
// simulation INSTANTLY and films nothing. Skip the journey, film the arrival: that is what
// keeps a two-second lead-in showing the moment before the event rather than the minute
// before it.
export const LEAD_TICKS = 120; // 2 s of the situation as posed, before the event
export const TAIL_TICKS = 120; // 2 s of the state the event left behind

/** Milliseconds of film one tick of `advance` costs the record pass. */
export const TICK_MS = 1000 / TICK_HZ;

/**
 * The `clipMs` an item needs in order to film `ticks` of `advance`/`until`, plus headroom
 * for the paint settles and driver round trips between them.
 *
 * An item that films more than the runtime's default 8 s budget must say so, or the record
 * pass simply stops mid-scene — which is how an item that poses five scenes came to hand
 * back a clip of the first one and a half. Deriving the budget from the tick counts the
 * item actually spends keeps the two from drifting apart when one of them is tuned.
 */
export function clipBudget(ticks) {
  return Math.ceil(ticks * TICK_MS) + 2500;
}

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

/**
 * Whether a cluster's bond pool is SPENT — the moment a check that chips one open is
 * waiting for.
 *
 * Read the pool, not the trait. specs/instrumentation.md gives `bond` two conformant ways
 * to say "nothing left": it "falls to `0` as it is chipped open", and it is "`null` if
 * unbonded" — so a build that drops the `bonded` trait at the break reports `null` from
 * that instant and one that keeps the unit's pool field around reports `0`. Both are the
 * same event. `traits.bonded === false` is NOT the thing to wait on: it is a separate
 * requirement (specs/matter.md: "Bonded is a state, not a lineage"), and a build that gets
 * it wrong would leave the wait running to the unit's DEATH instead — which is how one
 * missing flag turned into a dozen assertions comparing against a corpse. Wait on this,
 * assert the trait separately, and the failure lands on the one thing that broke.
 *
 * Pure read of a unit already in hand — callable from any phase.
 */
export function poolSpent(unit) {
  return unit != null && !(unit.bond > 0);
}

// The decay particles a heavy emits (specs/matter.md): an alpha is a full 6-electron atom,
// a beta a light 2-electron one.
export const ALPHA_ELECTRONS = 6;
export const BETA_ELECTRONS = 2;

/**
 * Which decay particle a unit was BORN as — `"alpha"`, `"beta"`, or `null` if it is not a
 * free atom of either size.
 *
 * Keyed on `maxHp` (specs/instrumentation.md: `hp`/`maxHp` are "remaining and starting
 * shells", and an atom's shells ARE its electrons, specs/matter.md), never on the live
 * `electrons` count. That distinction is the whole point: `electrons` FALLS as the particle
 * is stripped, so an alpha under fire reads 6, then 4, then 2 on its way down — and a check
 * that classifies by the live value counts that alpha as a beta. `heavies.decays` did, and
 * reported "the heavy sheds a beta" as satisfied against a build that never emits one.
 * `maxHp` does not move, so it identifies the particle however late it is first sighted and
 * whatever the poll rate.
 *
 * SCOPE: this reads a particle's SIZE, which is all a snapshot exposes about where a free
 * atom came from. On a board that also holds a bonded cluster it cannot tell a shed
 * 6-electron cluster atom from an alpha. Every caller poses a lone heavy or the boss, so
 * the only free atoms present are decay emissions; a check that needs both on one board has
 * to attribute by another means (see the position-credit rule in `boss.fission-daughters`).
 *
 * Pure read — callable from any phase.
 */
export function decayKind(unit) {
  if (unit == null || unit.type !== "atom") return null;
  if (unit.maxHp === ALPHA_ELECTRONS) return "alpha";
  if (unit.maxHp === BETA_ELECTRONS) return "beta";
  return null;
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
 * preconditions, leaving the run where `selectMap` does: on the untimed OPENING BUILD
 * PHASE. Returns the snapshot after set-up. `round` (optional) primes the round the next
 * `startRound` would build; energy/integrity default generous so scenarios can afford
 * towers and never lose by accident.
 *
 * This is the opener for a check that drives a REAL round itself, or that reads static
 * state and never runs time. A check that poses matter and steps wants `startScenario`.
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
 * Open the SCENARIO ROUND a run's preconditions have been set for, and return the
 * snapshot on it. Shared by `startScenario` and `poseScenario`.
 *
 * A build that does not open one would leave every check downstream measuring a board
 * that is not live, and that reads as dozens of unrelated conformance failures. So this
 * refuses to go on: it throws, and the runtime reports the item as "the build exposed the
 * debug API this check drives" with the message below as the actual — one sentence, the
 * same on every affected item, naming the operation that was missing. The item that
 * actually GRADES the operation is `instrumentation.scenario-round`, which drives it
 * directly and states each of its properties as its own assertion.
 */
async function enterScenarioRound(api) {
  await api.call("startScenario");
  const snap = await api.snapshot();
  if (snap.phase !== "round") {
    throw new Error(
      `startScenario did not open a live scenario round (phase is "${snap.phase}", ` +
        `screen "${snap.screen}") — see specs/instrumentation.md; every posed scenario ` +
        `needs one, so this check could not be run`,
    );
  }
  return snap;
}

/**
 * ARRANGE-only. `startRun`, and then a scenario round on top of it: the board every check
 * that poses matter and runs time works on. Same options and same return shape as
 * `startRun`.
 */
export async function startScenario(api, mapId = MAP.single, opts = {}) {
  await startRun(api, mapId, opts);
  return enterScenarioRound(api);
}

/** Twin of `startScenario` callable from EITHER phase (no `reset`). Same return shape. */
export async function poseScenario(api, mapId = MAP.single, opts = {}) {
  await poseRun(api, mapId, opts);
  return enterScenarioRound(api);
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
  {
    offsets = [40, 48, 58, 34, 70, 84],
    sides = [-1, 1],
    along = [0, 40, -40, 80, -80],
  } = {},
) {
  // Tried in order: the exact arc length first, at each perpendicular offset and on both
  // sides, and only then a short nudge ALONG the path.
  //
  // The nudge matters because a map is the model's own. A tower has a real footprint and has
  // to sit clear of the path, of the board's edge and of its neighbours (specs/board.md), so
  // a spot that is legal on one build's conduit can have nothing beside it on another's — and
  // when that happens the item does not fail, it becomes INCONCLUSIVE, which produces no
  // media at all. Three of the builds under review lost whole items that way, including the
  // one whose reviewer asked why it "didn't produce anything". Eighty pixels of slack along
  // the lane costs an item nothing (every caller wants a tower covering roughly here, and
  // those that need more resolve their own geometry from the tower afterwards) and turns a
  // silent inconclusive into a real verdict.
  for (const da of along) {
    const at = s + da;
    if (at < 0 || at > pathGeomObj.length) continue;
    const p = pathGeomObj.pointAt(at);
    const nx = -Math.sin(p.ang);
    const ny = Math.cos(p.ang);
    for (const off of offsets) {
      for (const side of sides) {
        const x = p.x + nx * off * side;
        const y = p.y + ny * off * side;
        const r = await api.call("placeTower", kind, x, y);
        if (r && r.ok) return { id: r.id, x, y, p, s: at };
      }
    }
  }
  // The map is the model's own: a conformant build can legitimately have no legal spot for
  // this tower anywhere near this arc length, which decides nothing about its debug API.
  // Mark it inconclusive rather than failing the run.
  throw preconditionUnmet(
    `placeCovering(${kind}) found no legal spot near s=${s}`,
  );
}

/**
 * Place a real tower of `kind` covering somewhere NEAR arc length `s` — trying `s` itself
 * first and then points progressively further either side of it, and returning the first
 * that the real placement path accepts.
 *
 * `placeCovering` asks for one exact spot and throws an unmet precondition if that spot has
 * no legal position beside it. That is the right behaviour when the arc length is chosen by
 * the item; it is the wrong one when the arc length is chosen by the SIMULATION — "wherever
 * the unit has got to by now" — because a unit that happens to have stopped beside a bend, a
 * collector run-in, or another tower makes the whole item inconclusive, and an inconclusive
 * item produces NO MEDIA AT ALL. `detection.inert-modifier` places a detector ahead of a
 * Dimer wherever the Dimer has reached, and that is exactly how it came to hand back an
 * empty output on some builds rather than a verdict.
 *
 * Control ops only — callable from either phase.
 */
export async function placeCoveringNear(
  api,
  kind,
  pathGeomObj,
  s,
  { spread = [0, 60, -60, 120, -120, 180, -180, 240] } = {},
) {
  for (const d of spread) {
    const at = s + d;
    if (at < 0 || at > pathGeomObj.length) continue;
    try {
      return await placeCovering(api, kind, pathGeomObj, at);
    } catch (err) {
      // Only an unmet precondition means "not here, try elsewhere"; anything else is a
      // real failure and must not be swallowed.
      if (!err?.ttcPreconditionUnmet) throw err;
    }
  }
  throw preconditionUnmet(
    `placeCoveringNear(${kind}) found no legal spot within reach of s=${Math.round(s)}`,
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
    // `placeCoveringNear`, not `placeCovering`: the arc lengths here are an even division of
    // a stretch, not spots an item chose, and a map is the model's own. One of them landing
    // beside a bend, a collector run-in, or a neighbour already placed makes the WHOLE item
    // inconclusive — and an inconclusive item produces no media at all. On the builds under
    // review that is what emptied `hitpoints.pays-total-shells` and
    // `placement.covers-both-lanes`: "placeCovering(cleaver) found no legal spot near s=1...".
    placed.push(await placeCoveringNear(api, kind, pathGeomObj, s));
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
  const tower = await placeCoveringNear(api, kind, g, s);
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
  return buildCoverAndSpawn(api, startScenario, opts);
}

/** Twin of `coverAndSpawn` callable from EITHER phase (no `reset`). Same return shape. */
export async function poseCoverAndSpawn(api, opts = {}) {
  return buildCoverAndSpawn(api, poseScenario, opts);
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
    approachPx = 0,
    seed = 1,
  },
) {
  const snap = await begin(api, mapId, { seed });
  const g = pathGeom(snap.paths[0]);
  const tower = await placeCoveringNear(api, kind, g, towerFrac * g.length);
  const towerSnap = towerById(await api.snapshot(), tower.id);
  const s = Math.max(0, firstInRange(g, towerSnap) - approachPx);
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
 *
 * `approachPx` poses the unit that many pixels FURTHER upstream, outside the radius, so it
 * spends the opening of the clip walking in. Use it whenever an item frames its evidence
 * with a lead-in (see LEAD_TICKS): a single tower's coverage window is shorter than it
 * sounds — about 2.7 s for a 6-electron atom under a 100-range Emitter, since the path's
 * curve cuts a chord through the radius rather than a diameter — so a two-second lead-in
 * spent INSIDE the window leaves almost none of it for the thing under test. Two items
 * learned that the hard way: `tower-art.projectiles-travel` reported "no shot is fired" and
 * `fx.neutralize` reported no kill, both against a build doing neither wrong. Spending the
 * lead-in on the approach instead leaves the whole window intact.
 */
export async function coverAndPassThrough(api, opts = {}) {
  return buildCoverAndPassThrough(api, startScenario, opts);
}

/** Twin of `coverAndPassThrough` callable from EITHER phase (no `reset`). Same return shape. */
export async function poseCoverAndPassThrough(api, opts = {}) {
  return buildCoverAndPassThrough(api, poseScenario, opts);
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
export async function actNoTowerRound(
  api,
  { max = 19200, poll = 120, nearlyClear = NEARLY_CLEAR_UNITS } = {},
) {
  // THE WAVE IS SKIPPED; THE RESOLUTION IS FILMED.
  //
  // A no-tower round is one to five minutes of game time — round 20 alone is 102 atoms —
  // and every one of these items is about what happens at the END of it: the clear bonus
  // landing, the interest paid on the bank, the countdown that follows. Run in real time
  // the record pass filmed the wave POURING OUT of the inlet and then ran out of budget, so
  // what a reviewer got was units entering and no payout at all — "it only shows the units
  // at the start".
  //
  // So the body of the round is stepped instantly and the recording picks up when the board
  // is nearly clear: the last few units walking into the collector, the round resolving, and
  // the bank changing. That is the same simulation either way — `skipUntil` runs the real
  // systems, it just does not film them.
  //
  // `peaked` is what makes "nearly clear" mean the tail of the wave rather than the moment
  // before it starts: a round opens with an EMPTY board, which satisfies any small-count
  // test on its first sample. The skip only starts looking for the tail once the wave has
  // actually filled the lane.
  let peaked = false;
  await api.skipUntil(
    (s) => {
      if (s.matter.length > nearlyClear) peaked = true;
      if (s.phase === "build" || s.screen !== "playing") return true;
      return peaked && s.matter.length <= nearlyClear;
    },
    { max, poll: Math.min(poll, 30) },
  );

  // 19200 ticks = the old 320s cap; poll 120 = the old 2s chunk.
  const r = await api.until(
    (s) => s.phase === "build" || s.screen !== "playing",
    { max: RESOLVE_MAX_TICKS, poll: 6 },
  );
  // Held on the resolution, so the bonus and the interest are legibly on the recording
  // rather than the frame the round happened to end on.
  await api.advance(TAIL_TICKS);
  return r.snap;
}

/** How few units left on the lane counts as the tail of a wave. */
const NEARLY_CLEAR_UNITS = 4;
/**
 * Game ticks allowed for those last units and the round's resolution.
 *
 * Generous, because it decides the VERDICT: the "nearly clear" test above is a heuristic
 * about where a wave's tail is, and a wave that dips to a few units mid-release leaves this
 * sweep more of the round to finish than a tight cap would allow. How much of it reaches
 * the recording is capped separately, by each item's `clipMs`, and the validate pass has no
 * filming budget at all — so a long allowance here costs a reviewer nothing.
 */
const RESOLVE_MAX_TICKS = 3600;

// ---- Aura crossings -----------------------------------------------------------
//
// The two support towers are auras: they "continuously affect every valid unit in range"
// (specs/towers.md), and what they do to a unit — a slow factor, an excite bonus, a reveal —
// is a FIELD on that unit that a check can simply read.
//
// Reading it is easy, and every one of these items used to do only that: pose the unit
// inside the aura, advance three ticks, read the field. Two things are wrong with it. The
// clip is 1/20th of a second of a unit that was already affected, so a reviewer sees no
// effect at all — a slow especially, since "moving at 0.55x" is not a thing you can see
// without the 1.0x to compare it against. And the reading itself is weaker than it looks: a
// value read on a unit posed inside the field is satisfied just as well by a build that
// applies the effect to everything everywhere and has no aura at all.
//
// So these helpers walk the unit ACROSS the boundary. The unit is posed outside the radius,
// the effect is read there, the sim runs until it is genuinely inside, and the effect is
// read again. The difference between the two readings is the aura, and the crossing is the
// clip.
//
// IN-FIELD IS DECIDED BY GEOMETRY, not by the effect. Keying the wait on "the slow changed"
// would hang forever on the one unit whose correct behavior is that nothing changes — the
// boss, which specs/towers.md makes immune — and that item needs to prove the boss was
// inside the field and unaffected, which is precisely a geometric claim.

/** How far outside an aura's radius a crossing is posed, in logical pixels. */
const AURA_APPROACH_PX = 90;
/** Cap for the walk-in sweep: generous for the slowest matter over AURA_APPROACH_PX. */
const AURA_CROSS_MAX_TICKS = 420;
/** Ticks to let the aura apply once the unit is geometrically inside it. */
const AURA_APPLY_TICKS = 6;

/**
 * ARRANGE-only. Place an aura tower of `kind` beside path 0 and pose a unit of `type`
 * upstream of its radius, so running time walks the unit into the field.
 *
 * Returns `{ unitId, towerId, outside }` — the ids, and the unit's snapshot as posed
 * (outside the field), which is the "before" every caller asserts against.
 */
export async function arrangeAuraApproach(
  api,
  { kind, type = "atom", electrons, mapId = MAP.single, frac = 0.32 } = {},
) {
  const snap = await startScenario(api, mapId);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * frac;
  // Near, not exact: a Moderator has no legal spot beside this arc length on every map, and
  // an exact request there made all three `slow.*` items inconclusive on one of the builds
  // under review — no verdict and no media.
  const t = await placeCoveringNear(api, kind, g, s0);

  // Read the radius off the tower the build actually built, not off the number in the
  // spec: a conformant build may field this aura at any tier, and what has to be cleared
  // is whatever this tower reports.
  const tower = towerById(await api.snapshot(), t.id);
  const startAt = s0 - (tower.range + AURA_APPROACH_PX);
  if (startAt < 0) {
    throw preconditionUnmet(
      `the lane has no room upstream of the ${kind} to pose an approach from outside its ` +
        `field (needs ${Math.round(tower.range + AURA_APPROACH_PX)}px before s=${Math.round(s0)})`,
    );
  }

  const unitId = await spawnAt(api, {
    type,
    electrons,
    pathId: 0,
    s: startAt,
  });
  return {
    unitId,
    towerId: t.id,
    outside: unitById(await api.snapshot(), unitId),
  };
}

/**
 * ACT half of an aura crossing: film the unit approaching outside the field, run on until
 * it is geometrically inside, then hold there.
 *
 * Returns `{ entered, inside }` — whether the unit reached the field, and its snapshot
 * taken at the first sample in which it was inside.
 */
export async function actAuraCrossing(
  api,
  ctx,
  { lead = LEAD_TICKS, hold = TAIL_TICKS } = {},
) {
  // Outside the field, unaffected: the state everything below is a change from.
  await api.advance(lead);

  const r = await api.until(
    (s) => {
      const t = towerById(s, ctx.towerId);
      const u = unitById(s, ctx.unitId);
      if (!t || !u) return false;
      return Math.hypot(u.x - t.x, u.y - t.y) <= t.range;
    },
    { max: AURA_CROSS_MAX_TICKS, poll: TICK },
  );

  // A few ticks for the aura to APPLY before the effect is read.
  //
  // Crossing the radius and being affected by the field are one tick apart, not the same
  // instant: the aura system runs on the tick after the unit is inside it. Reading on the
  // first in-range sample caught `slow.heavy-resists` mid-crossing and reported a factor of
  // 1 for a heavy the Moderator went on to slow correctly a frame later — a conformant
  // build failed on a race, which is the exact failure mode the old fixed `advance(3)` was
  // there to avoid before the wait was made geometric.
  await api.advance(AURA_APPLY_TICKS);
  const inside = unitById(await api.snapshot(), ctx.unitId);

  // Held inside, so the affected state is on screen for as long as the unaffected one was.
  await api.advance(hold);

  return { entered: r.hit && inside != null, inside };
}

/** The clip budget an aura crossing needs, worst case. */
export function auraClipMs() {
  return clipBudget(LEAD_TICKS + AURA_CROSS_MAX_TICKS + TAIL_TICKS);
}

// ---- Targeting scenes ---------------------------------------------------------
//
// The six targeting priorities (specs/towers.md) are one item each, not one item with six
// assertions in it. A single `targeting.modes` item posed all six scenes back to back and
// read each choice off `targetId` one tick in, which failed the review on both counts: a
// six-scene clip is under three seconds of scenes flashing past, and one red line on a
// six-way item says "targeting is broken" when what is broken is `weakest`.
//
// So this is the shared scene, and each priority names its own expected unit in its own
// file. `targeting.first-default` grades the DEFAULT (specs/towers.md: "Every tower defaults
// to `first`") and so is posed without arming anything; the other five arm their priority.
//
// THE SCENE. One Beam — 200 range, the longest in the game (specs/towers.md), so all three
// units sit inside it at once — covering arc length `s0`, and three atoms:
//
//   A  at s0 − 150,  6 electrons — least progress, most hit points
//   B  at s0,        1 electron  — middle progress, fewest hit points
//   C  at s0 + 110,  3 electrons — most progress
//
// Progress and hit points are therefore independent, which is what makes each priority
// resolve to a DIFFERENT unit: confusing `weakest` with `first` picks C instead of B, and
// confusing `strongest` with `last` is the one collision the scene cannot break (A is both),
// so `targeting.last` and `targeting.strongest` state that overlap rather than hide it.
//
// HIT POINTS ARE VISIBLE HERE, which is why no debug operation to set them is needed. An
// atom's electrons ARE its shells (specs/matter.md) and it "sheds an electron each time it
// is stripped" onto two drawn rings, so a 6-electron atom and a 1-electron atom are plainly
// different objects on screen. (Where a case's units carry a fraction-of-max health BAR
// instead, two units at full health draw the same full bar however far apart their totals
// are, and posing the difference needs an explicit wound — that is a different problem from
// this one.)
//
// DISTANCE IS MEASURED, NOT ASSUMED. `nearest` and `farthest` are straight-line distances
// from the tower's placed position, and a map's geometry is the model's own: a serpentine
// legitimately folds an arc length 150 upstream back alongside the tower. So the scene reads
// the three real distances out of the snapshot and hands back the ids ordered by them, and
// the two items that care assert the margin they got rather than trusting the layout.
const SCENE_FRAC = 0.22; // where along path 0 the Beam covers
// Candidate (behind, ahead) offsets for A and C. The scene needs the three atoms to be
// clearly DIFFERENT distances from the tower, and how far apart a given pair of arc lengths
// lands in world space is decided by the map's own curvature: on one build's conduit the
// first pair put the two most distant atoms 22px apart, under the margin `nearest` and
// `farthest` need, and `targeting.farthest` reported "precondition not satisfiable" —
// producing no media at all. So the pair is CHOSEN, by measuring each candidate against this
// build's own geometry and taking the one that separates them best.
const SCENE_OFFSETS = [
  [150, 110],
  [190, 140],
  [120, 170],
  [230, 90],
  [90, 210],
  [130, 90],
  [170, 70],
  [70, 150],
  [110, 130],
  [200, 60],
];
/** How much of the tower's radius a posed atom may sit at; the rest is drift allowance. */
const IN_RANGE_FRACTION = 0.85;
const SCENE_ELECTRONS = { A: 6, B: 1, C: 3 };
// How much clear water the distance ordering needs before `nearest`/`farthest` will rest a
// verdict on it. Below this the three units are effectively equidistant and the priority has
// no well-posed answer, which is a fact about the posed board, not about the build.
export const DISTANCE_MARGIN_PX = 25;

/**
 * Pose the three-atom scene and arm `priority` (pass `null` to leave the tower on its
 * default, which is what `targeting.first-default` grades). `begin` opens the run —
 * `startScenario` from `arrange`, `poseScenario` from `act`.
 *
 * The priority is armed LAST, after every unit is on the board, so every shot the item goes
 * on to see was aimed under the priority under test.
 *
 * Returns `{ towerId, A, B, C, dist, byDistance }` — the three ids, each one's distance from
 * the tower as posed, and the ids ordered nearest-first.
 */
export async function poseTargetingScene(api, begin, priority) {
  const snap = await begin(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * SCENE_FRAC;
  const t = await placeCoveringNear(api, "beam", g, s0);

  // Pick the offsets that separate the three atoms best on THIS map, measured from where the
  // tower actually ended up. Every atom must also stay inside the Beam's radius, or the
  // priority is not choosing among three.
  const towerNow = towerById(await api.snapshot(), t.id);
  const spreadOf = ([back, ahead]) => {
    const pts = [s0 - back, s0, s0 + ahead];
    if (pts.some((p) => p < 0 || p > g.length)) return -1;
    const ds = pts.map((p) => {
      const q = g.pointAt(p);
      return Math.hypot(q.x - towerNow.x, q.y - towerNow.y);
    });
    // Comfortably inside the radius, not merely inside it. The atoms keep travelling while
    // the tower reloads (a Beam is 1.2 s), so a candidate that puts one of them within a
    // few pixels of the edge has it OUTSIDE by the time the shot lands — which is how an
    // earlier version of this picker chose a pose whose front atom was at 193 of a 200
    // radius and 211 a moment later.
    if (ds.some((d) => d > towerNow.range * IN_RANGE_FRACTION)) return -1;
    const sorted = [...ds].sort((a, b) => a - b);
    // The tightest gap between neighbouring distances is what decides whether `nearest` and
    // `farthest` have an answerable question.
    return Math.min(sorted[1] - sorted[0], sorted[2] - sorted[1]);
  };
  let best = SCENE_OFFSETS[0];
  let bestSpread = -Infinity;
  for (const cand of SCENE_OFFSETS) {
    const v = spreadOf(cand);
    if (v > bestSpread) {
      bestSpread = v;
      best = cand;
    }
  }
  const [SCENE_BACK, SCENE_FRONT] = best;

  const A = await spawnAt(api, {
    type: "atom",
    electrons: SCENE_ELECTRONS.A,
    pathId: 0,
    s: s0 - SCENE_BACK,
  });
  const B = await spawnAt(api, {
    type: "atom",
    electrons: SCENE_ELECTRONS.B,
    pathId: 0,
    s: s0,
  });
  const C = await spawnAt(api, {
    type: "atom",
    electrons: SCENE_ELECTRONS.C,
    pathId: 0,
    s: s0 + SCENE_FRONT,
  });

  if (priority != null) await api.call("setTargeting", t.id, priority);

  const posed = await api.snapshot();
  const tower = towerById(posed, t.id);
  const dist = {};
  for (const id of [A, B, C]) {
    const u = unitById(posed, id);
    dist[id] = u ? Math.hypot(u.x - tower.x, u.y - tower.y) : Infinity;
  }
  const byDistance = [A, B, C].sort((p, q) => dist[p] - dist[q]);

  return { towerId: t.id, A, B, C, dist, byDistance };
}

/**
 * ACT half of a targeting scene: grade the tower's first shot by WHICH UNIT IT DAMAGES, then
 * keep filming the consequence.
 *
 * THE GRADED SIGNAL IS DAMAGE, NOT A PROJECTILE, AND NOT `targetId`. All three are ways of
 * asking "which unit did it fire at", and the other two are each unreliable on a different
 * conformant build:
 *
 *   * `targetId` is what a tower REPORTS it is aiming at, and specs/towers.md does not say
 *     when a build must refresh it. A build that re-picks only when it actually fires goes on
 *     reporting its previous choice for the whole of a reload — which is the reason
 *     `targeting.inert-priority` stopped reading it.
 *   * A PROJECTILE only appears in the snapshot if the shot is still in the air when the
 *     sweep samples. One of the builds under review resolves a short-range Beam shot inside
 *     the same tick, so `projectiles` reads empty at every tick boundary; waiting for "a new
 *     projectile" there silently skipped the first shot and graded the SECOND — by which time
 *     the 1-electron atom the priority had correctly chosen was already gone, and the item
 *     failed a build that had picked exactly right. Two different builds failed
 *     `targeting.nearest` and `targeting.weakest` that way.
 *
 * Damage has neither problem: a shot that lands is a unit whose hp fell (or that is gone),
 * and every build must show that, whatever it does with projectiles. The clip does not suffer
 * either — a Beam reloads at 0.85/s, so up to 1.2 s of the scene as posed plays before its
 * first shot lands, and the tail below then films the consequence.
 *
 * Returns `{ first, hit, ambiguous, inRange, snap }`: the id the first shot damaged, whether
 * a shot landed at all, whether more than one unit was hit at once (a splash or pierce, which
 * this single-target scene should never produce), whether all three units were inside the
 * radius on the sample BEFORE that shot landed, and that same snapshot — which is what every
 * per-priority premise is read from, so the premises are read while all three are still on
 * the board.
 */
export async function actTargetingPick(
  api,
  scene,
  { tail = 210, max = 300 } = {},
) {
  const ids = [scene.A, scene.B, scene.C];

  const start = await api.snapshot();
  const hp0 = {};
  for (const id of ids) hp0[id] = unitById(start, id)?.hp ?? null;

  // The last sample in which NOTHING had been hit yet: all three alive, standing where the
  // priority had to choose between them.
  let before = start;
  let picked = null;
  let ambiguous = false;

  const r = await api.until(
    (s) => {
      const struck = ids.filter((id) => {
        const u = unitById(s, id);
        if (hp0[id] == null) return false;
        return u == null || u.hp < hp0[id];
      });
      if (struck.length > 0) {
        picked = struck.length === 1 ? struck[0] : null;
        ambiguous = struck.length > 1;
        return true;
      }
      before = s;
      return false;
    },
    { max, poll: TICK },
  );

  // THE PREMISE IS ABOUT THE POSE, not about the instant the shot landed.
  //
  // A tower chooses its target and then reloads before the shot arrives — 1.2 s for a Beam —
  // and the atoms travel throughout. Asking "were all three in range when the damage landed"
  // therefore fails a perfectly good scene whenever the furthest atom has drifted past the
  // radius in the meantime, which says nothing about the priority. What the premise needs to
  // establish is that the tower had three reachable units to choose BETWEEN at the moment it
  // was choosing, and that is the posed board.
  const inRangeAt = (snapshot, id) => {
    const t = towerById(snapshot, scene.towerId);
    const u = unitById(snapshot, id);
    return (
      t != null && u != null && Math.hypot(u.x - t.x, u.y - t.y) <= t.range
    );
  };
  const inRange = ids.every((id) => inRangeAt(start, id));
  // ...and the unit it actually struck was reachable when it struck it, which is the part
  // that would expose a build shooting something it should not be able to reach.
  const pickReachable = picked == null ? false : inRangeAt(before, picked);

  await api.advance(tail);

  return {
    first: picked,
    hit: r.hit,
    ambiguous,
    inRange,
    pickReachable,
    snap: before,
  };
}

/**
 * The assertions every per-priority item shares: the tower actually fired, the scene really
 * did pose a choice, and the shot went to the expected unit. `label` names the priority in
 * the report and `pick` is the id it should resolve to.
 *
 * There is deliberately no "and it kept choosing it" tally. Every unit here is one or two
 * shots from being neutralized, so a second shot is a shot at a DIFFERENT board — and a
 * build that picked correctly and then moved on because its pick had been destroyed would
 * fail such a tally for doing exactly the right thing.
 */
export function checkTargetingPick(check, { label, result, pick }) {
  check.expectOk("the tower took a shot to grade", result.hit);
  check.expectOk(
    "...and it struck exactly one unit, so the choice is unambiguous",
    result.ambiguous === false,
  );
  check.expectOk(
    "all three units were posed in the tower's range together, so the priority had a choice",
    result.inRange,
  );
  check.expectEq(`${label} fires at the expected unit`, result.first, pick);
  check.expectOk(
    "...and that unit was inside the tower's range when the shot landed",
    result.pickReachable,
  );
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

// How long to let a confirmed menu choice land and paint before the screen is read.
const MENU_SETTLE_MS = 150;

// The key pairs specs/controls.md leaves the build to choose between: "`Up`/`Down` (or
// `W`/`S`) move the selection and `Enter`/`Space` confirms". BOTH movement bindings are
// conformant and so are both confirms, so a check that presses only `ArrowDown`+`Enter`
// pins one arrangement of four and reports a build that navigates fine on `W`/`S` as
// having no how-to-play screen at all. Movement is tried outermost because a movement key
// the build ignores leaves the selection where it was, so the next pair starts from the
// same first entry; the confirms are tried within a pair without re-pressing movement,
// for the same reason.
const MENU_MOVE_KEYS = ["ArrowDown", "KeyS"];
const MENU_CONFIRM_KEYS = ["Enter", "Space"];

/**
 * From a freshly reset title, drive the menu down `steps` entries and confirm — the same
 * keyboard path a player uses (specs/controls.md) — and return the SCREEN it reached.
 * A fresh page opens with the first entry highlighted, so `steps` counts entries below it.
 *
 * The caller asserts on the returned screen rather than on a bare boolean, so a build that
 * navigates to the wrong entry reports where it actually went.
 *
 * Opens with a real paint settle (see `MENU_PAINT_MS`); the presses themselves consume no
 * simulation time, so this is callable from either phase.
 */
export async function navigateMenu(api, steps) {
  await api.settle(MENU_PAINT_MS);
  let reached = (await api.snapshot()).screen;
  for (const move of MENU_MOVE_KEYS) {
    for (let i = 0; i < steps; i += 1) await api.call("press", move);
    for (const confirm of MENU_CONFIRM_KEYS) {
      await api.call("press", confirm);
      await api.settle(MENU_SETTLE_MS);
      reached = (await api.snapshot()).screen;
      // Anything but the title means the menu answered both keys of this pair. Trying a
      // further binding could only move the selection again from wherever the build left
      // it, so the entry that was confirmed is the answer — right or wrong.
      if (reached !== "title") return reached;
    }
  }
  return reached;
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
// Extra real time after the log goes quiet, for the remaining clips to fetch and decode.
const ARM_DECODE_MS = 1200;

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

  // A WARM-UP once the log has gone quiet, for the clips that have not finished decoding.
  //
  // Going quiet only means nothing NEW has started — which happens as soon as the music bed
  // is playing. The event cues are separate clips still being fetched and decoded, and a cue
  // driven before its own clip lands is dropped in silence: every build here guards its play
  // path on the buffer existing (`if (!buffers[name]) return`), with no queue and no retry,
  // so the sound is simply lost. It is lost permanently, because the simulation has moved on.
  //
  // That is not a defect a reviewer would ever see — a player takes seconds to place their
  // first tower — but a check arms audio and drives its event milliseconds later. One build
  // reported no leak alarm and no neutralize cue that way while calling `play()` for both,
  // unthrottled, from code that plainly works in game.
  await api.settle(ARM_DECODE_MS);
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
export async function settledAudioCount(api) {
  await api.settle(PAINT_SETTLE_MS);
  return audioCount(api);
}

// How long to let the build PAINT before a cue count is read.
//
// A build queues its cues from the simulation and plays them on its next animation frame
// (the reference's `main.ts` drains `sndQueue` there), so a cue driven during instant
// stepping has not reached Web Audio when the step returns. 80 ms was about five frames on
// an idle machine and none at all on a loaded one, and every audio item in this case passes
// its reference by a margin of exactly ONE source — so a single missed frame is the
// difference between "the cue plays" and "the build is silent". That is the shape the review
// ran into: items that fail validation for builds whose sound is plainly working in game.
//
// This is real time in both passes and is spent twice per measurement, so it is not free;
// 200 ms buys roughly a dozen frames of headroom, which is enough for a queue drained on the
// next frame and for one deferred a frame or two behind it.
const PAINT_SETTLE_MS = 200;

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
 * WHY NOT SIMPLY A WINDOW ROUND THE EVENT. A damage tower plays a cue every time it FIRES
 * (specs/assets.md, "the shot cue when a damage tower fires"), so any window long enough to
 * contain a bond snap, a decay or a kill also contains several shot cues, and the log grows
 * whether or not the event has a cue of its own. That is not a check of the event's cue — it
 * passes on the shots alone, and did: `audio.bond-snap` once recorded "a bond-snap cue plays
 * on the snap" as satisfied on a run where the bond never snapped.
 *
 * So this walks the fire shot by shot, skips INSTANTLY to the brink of the impact — a shot
 * already launched and on its way, so that shot's own launch cue is behind the baseline —
 * and then measures only until the event fires or the shot is spent.
 *
 * WHY THE MEASURED WINDOW RUNS IN REAL TIME. The skipping above is instant, and that is the
 * point; but the WINDOW cannot be. A build is entitled to queue its cues from the simulation
 * and play them when it next paints, and to throttle a repeated cue by the wall clock — both
 * are ordinary, and one of the builds under review does both. Under instant stepping the
 * whole window passes in a millisecond or two of real time, so a queue that drains on the
 * next animation frame has not drained and a throttle keyed to `AudioContext.currentTime`
 * has not expired: the cue is real, a player hears it, and the probe sees nothing. That
 * build's `audio.bond-snap` failed exactly that way, while running the same scenario on the
 * game's own clock showed its cue count climbing steadily as each bond gave way.
 *
 * So the window hands the clock back (`setAutoStep`), spends a REAL interval shorter than
 * the tower's reload — long enough for the shot in flight to land and its cue to be played,
 * too short for the next shot to be launched inside the measurement — and takes the clock
 * again. The event is confirmed to have happened inside that window before the gain is
 * attributed to it.
 *
 * `event(snapshot)` is evaluated at most once per sample and its verdict remembered.
 *
 * Consumes time, so `act` only. Returns `{ hit, gained, shots, snap }`.
 */
export async function cueOnImpact(
  api,
  unitId,
  event,
  { shots = 8, approach = 900 } = {},
) {
  // The window is derived from the firing tower's own reload rather than fixed: it has to
  // stay strictly inside one reload, or a second shot is launched inside the measurement and
  // its own launch cue is counted as the event's. An Emitter reloads in 33 ticks (1.8/s,
  // specs/towers.md), well under the 45 this used to assume.
  const towers = (await api.snapshot()).towers.filter((t) => t.fireRate > 0);
  const reloadTicks = towers.length
    ? Math.min(...towers.map((t) => TICK_HZ / t.fireRate))
    : 45;
  const windowMs = Math.max(200, Math.floor(reloadTicks * TICK_MS * 0.6));

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

    // The window, on the game's own clock.
    await api.call("setAutoStep", true);
    let fired = false;
    for (let waited = 0; waited < windowMs; waited += LIVE_STEP_MS) {
      await api.settle(LIVE_STEP_MS);
      if (event(await api.snapshot())) {
        fired = true;
        break;
      }
    }
    await api.call("setAutoStep", false);

    const gained = (await settledAudioCount(api)) - before;
    if (fired)
      return { hit: true, gained, shots: i, snap: await api.snapshot() };
  }
  return { hit: false, gained: 0, shots: 0, snap: await api.snapshot() };
}

/** How finely the live window above is sampled, in real milliseconds. */
const LIVE_STEP_MS = 60;
