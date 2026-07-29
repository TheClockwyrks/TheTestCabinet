// Case-specific helpers for Arc Foundry's automated-validation debug scripts.
//
// Every script drives the REAL, deterministic simulation through window.__foundry
// (see specs/instrumentation.md): control ops only ESTABLISH preconditions — a
// placed rock rolls through the real press, a kept candidate harvests through the
// real path, a combine resolves through the real combine code, a spawned unit walks
// the real pathfinder — and the observed result always comes from stepping the real
// simulation forward and reading `snapshot()` (or the rendered pixels). Nothing
// fabricates an outcome. These helpers factor out the common "arrange the board,
// step the real sim, read what happened" patterns and the fixed geometry/constants
// the scripts depend on (mirrored from specs/*.md and the canonical constants).
//
// The assertion primitives themselves are NOT here — they are the reporter-side
// `check` kit the runtime hands an item's `assert` phase
// (packages/browser-driver/validation.mjs), shared by every case. This file holds only
// what is specific to Arc Foundry.
//
// THE ARRANGE/ACT SEAM. An item is an `{ id, arrange, act, assert }` triple that the
// runtime runs TWICE from one implementation: once with time instant (deciding the
// verdict) and once in real time (recording the media). The two phases therefore mean
// different things and a helper must belong to exactly one of them:
//
//   * `arrange` is INSTANT and runs in BOTH passes. Only control ops belong here —
//     the setters that pose a board. Calling api.advance()/api.until() from arrange
//     THROWS.
//   * `act` is the only phase that consumes time, and the only thing filmed. It may
//     still call control ops (to pose a second scenario mid-scene); it may NOT call
//     api.reset(), which would hand the build back to its manual clock and silently
//     freeze the recording.
//
// So a helper that only poses state (`startBuild`, `placeCandidate`, `armTower`,
// `spawnControlled`, `assembleCombo`) is arrange-phase and used as-is, while a helper
// that consumes time is split into an `arrangeX` half and an `actX` half — the arrange
// half returns the ids the act half needs. Nothing here calls `setAutoStep`: the
// runtime owns the clock in both passes.
//
// UNITS ARE TICKS. The debug API's `step` counts whole simulation ticks of the fixed
// 60 Hz timestep (specs/instrumentation.md), so `api.advance(n)` / the `max` and
// `poll` of `api.until` are tick counts, not seconds. One second of game time is 60
// ticks. Nothing is rounded — a fractional count is rejected — so a measurement is
// exact and reproducible regardless of machine load.

// ---- Stage + grid geometry (specs/board.md, specs/overview.md) -----------------
export const STAGE_W = 1280;
export const STAGE_H = 720;
export const STATUS_H = 56; // top status bar; the board grid is anchored at (0, 56)
export const TILE = 20; // 20 px tiles
export const GRID_COLS = 50;
export const GRID_ROWS = 33;

// ---- The simulation clock (specs/controls.md, specs/instrumentation.md) --------
// The sim runs on a fixed 60 Hz timestep and the debug API counts whole ticks of it,
// so every duration below — and every `advance`/`until` a script writes — is a TICK
// COUNT. Multiply seconds by TICK_HZ to convert.
export const TICK_HZ = 60; // the fixed simulation rate, in Hz (matches FIXED_STEP = 1/60)
export const TICK = 1; // one tick — the finest `poll`, for reading the instant something happens
export const SECOND = 60; // one second of game time, in ticks

// A tile's center in logical-pixel space.
export function tileCenter(col, row) {
  return { x: TILE * col + TILE / 2, y: STATUS_H + TILE * row + TILE / 2 };
}
// A 2x2 footprint's center (used for range, targeting, drawing): (20*(col+1), 56+20*(row+1)).
export function footprintCenter(col, row) {
  return { x: TILE * (col + 1), y: STATUS_H + TILE * (row + 1) };
}

// ---- Economy / balance constants (constants.ts, specs/gameplay.md) -----------------
export const START_CHARGE = 10;
export const START_INTEGRITY = 20;
export const BUILDS_PER_LEVEL = 5;
// The wave-clear bonus (`specs/gameplay.md`): a function of the wave number and of nothing else.
// The spec used to hedge this as "about 10 on Wave 1" and attribute the formula to the reference
// build, which left a check asserting it pinning a number no build had been told to hit; the
// formula is now part of the seeded contract, so asserting it exactly is asserting what the model
// was given.
export function waveClearBonus(wave) {
  return 8 + 2 * wave;
}
// Quality ladder: damage multiplier by tier (index 0 unused), range per tier, flat rate.
export const QUALITY_MULT = [0, 1.0, 3.0, 9.0, 40, 110];
export const RANGE_PER_TIER = 8;
export const MAX_TIER = 5;
export const MAX_REFINEMENT = 8;
// UPGRADE QUALITY cost to REACH each Refinement level (index = target level; 0 unused).
export const REFINE_COST = [0, 20, 50, 80, 110, 140, 170, 200, 230];
// The quality-roll distribution [T1..T5] at each Refinement level R (0..8), each summing to 1.
export const QUALITY_ODDS_BY_R = [
  [1.0, 0.0, 0.0, 0.0, 0.0],
  [0.7, 0.3, 0.0, 0.0, 0.0],
  [0.6, 0.3, 0.1, 0.0, 0.0],
  [0.5, 0.3, 0.2, 0.0, 0.0],
  [0.4, 0.3, 0.2, 0.1, 0.0],
  [0.3, 0.3, 0.3, 0.1, 0.0],
  [0.2, 0.3, 0.3, 0.2, 0.0],
  [0.1, 0.3, 0.3, 0.3, 0.0],
  [0.0, 0.3, 0.3, 0.3, 0.1],
];

// Base (Scrap / T1) component stats we assert against (constants.ts COMPONENTS).
export const BASE = {
  capacitor: { dmg: 6, range: 100, fireRate: 1.6 },
  coil: { dmg: 5, range: 110, fireRate: 1.0 },
  emitter: { dmg: 2, range: 88, fireRate: 4.5 },
  arcnode: { dmg: 5, range: 96, fireRate: 0.85 },
  discharge: { dmg: 18, range: 160, fireRate: 0.5 },
  choke: {
    dmg: 3,
    range: 104,
    fireRate: 1.3,
    slowAmt0: 0.22,
    slowPerTier: 0.03,
    slowDur: 1.2,
  },
  rectifier: { dmg: 2, range: 96, fireRate: 1.1, burnFrac: 0.5, burnDur: 2.0 },
  regulator: {
    dmg: 0,
    range: 0,
    fireRate: 0,
    auraRadius0: 90,
    auraBonus0: 0.1,
  },
};

// The Load roster base (Wave-1, Medium) stats (constants.ts LOAD, specs/enemies.md §7).
export const LOAD = {
  mote: { baseHp: 44, speed: 60, flies: false, bounty: 1, leak: 1 },
  spark: { baseHp: 27, speed: 120, flies: false, bounty: 1, leak: 1 },
  slug: { baseHp: 180, speed: 38, flies: false, bounty: 3, leak: 2 },
  cluster: { baseHp: 16, speed: 72, flies: false, bounty: 1, leak: 1 },
  filament: { baseHp: 74, speed: 85, flies: true, bounty: 2, leak: 1 },
  dynamo: { baseHp: 1500, speed: 30, flies: false, bounty: 40, leak: 5 },
};

// The difficulty table (constants.ts DIFFICULTY, specs/modes.md §9.2): wave count + toughness.
export const DIFFICULTY = {
  easy: {
    waves: 40,
    baseMult: 0.2,
    k: 0.5,
    surchargeC: 0.08,
    surchargeR: 1.09,
  },
  medium: {
    waves: 50,
    baseMult: 0.22,
    k: 1.17,
    surchargeC: 0.28,
    surchargeR: 1.145,
  },
  hard: {
    waves: 60,
    baseMult: 0.24,
    k: 1.3,
    surchargeC: 0.22,
    surchargeR: 1.15,
  },
};

// Per-wave HP scaling (constants.ts scaledHp, specs/enemies.md §7.1): the current linear
// ramp plus a late-game exponential surcharge (~0 in the opening/mid waves). Only HP grows.
export function scaledHp(baseHp, wave, diffKey = "medium") {
  const d = DIFFICULTY[diffKey];
  const linear = 1 + d.k * (wave - 1);
  const surcharge = d.surchargeC * (Math.pow(d.surchargeR, wave - 1) - 1);
  return Math.round(baseHp * d.baseMult * (linear + surcharge));
}

// A few combination-tower recipes used by the combo/ability scripts (constants.ts COMBOS).
// Each is the exact (type, tier) ingredient multiset a recipe-combine folds.
export const RECIPES = {
  fusecluster: [
    ["regulator", 1],
    ["rectifier", 1],
    ["arcnode", 1],
  ], // all-Scrap early combo
  forkarray: [
    ["emitter", 3],
    ["capacitor", 3],
    ["coil", 2],
  ], // multishot 3
  slagdriver: [
    ["discharge", 2],
    ["discharge", 1],
    ["emitter", 1],
  ], // crit
};

// ---- The standard tower spot on the entry corridor (substation) ----------------
// On the default "substation" map the Entry is tile (0,5) — center (10,166) — and the
// Load walks right along row 5 toward WP1 (44,5). A 2x2 tower anchored at (12,7) has its
// center at (260,216) and sits BELOW that corridor, so it never blocks the path while
// covering it: a unit walking row 5 (y=166, 50 px above the tower's center) is inside a
// Capacitor's 100 px range over x in [173, 347] and inside an Emitter's 88 px range over
// x in [188, 332], a window wide enough to hold two units posed a fraction of a second
// apart.
//
// The tower deliberately does NOT sit on top of the Entry. A unit released at the Entry
// walks a couple of seconds before it comes under fire, and `skipToApproach` spends that
// walk instantly, so a combat item's `act` opens on the unit closing the last stretch and
// then shows the shot leave the head, cross the gap, land, and apply its effect. Parked
// against the Entry the same shot fired on the opening frame and was over before the clip
// began.
export const ENTRY = { col: 0, row: 5 };
export const ENTRY_C = tileCenter(0, 5); // { x: 10, y: 166 }
export const TOWER = { col: 12, row: 7 };
export const TOWER_C = footprintCenter(12, 7); // { x: 260, y: 216 }
// A few more legal, non-sealing anchors along the corridor for extra pieces. SPOTS[0] is
// the TOWER spot, so an assembled combination tower lands covering the same corridor.
export const SPOTS = [
  { col: 12, row: 7 },
  { col: 12, row: 10 },
  { col: 16, row: 7 },
  { col: 16, row: 10 },
  { col: 20, row: 7 },
];

// ---- Core drive helpers --------------------------------------------------------

/** A snapshot shorthand. */
export async function snap(api) {
  return api.snapshot();
}

// `stepUntil` is gone: the runtime's `api.until(pred, { max, poll })` is the same drive,
// advancing until `pred(snapshot)` holds or `max` ticks are spent and returning
// `{ snap, hit, spent }`. Pass a coarse `poll` when the quantity read is constant between
// events (a long traverse), or `TICK` to read state the instant something happens.

/**
 * ARRANGE. Reset (reseeding all randomness) and begin a run at its opening build phase.
 * `charge` optionally overrides the starting Charge as a precondition for an upgrade.
 * Returns the opening snapshot. Poses only — call it from `arrange`, never from `act`
 * (it resets, which would hand the build back to its own clock mid-recording).
 */
export async function startBuild(
  api,
  { seed = 1, map = "substation", difficulty = "medium", charge } = {},
) {
  await api.reset({ seed });
  await api.call("startRun", { map, difficulty });
  if (charge != null) await api.call("setCharge", charge);
  return api.snapshot();
}

/**
 * ARRANGE. Arm the exact roll and drop a rock at (col,row) through the real placement path,
 * landing a candidate. Returns the placed candidate's snapshot entry, or null if the drop
 * was refused (illegal footprint). Instant — a placement consumes no game time.
 */
export async function placeCandidate(api, type, tier, col, row) {
  await api.call("setNextRoll", type, tier);
  await api.call("placeRock", col, row);
  const s = await api.snapshot();
  return (
    s.towers.find(
      (t) => t.col === col && t.row === row && t.kind === "candidate",
    ) ?? null
  );
}

/**
 * ARRANGE. Arm a single firing tower on the entry corridor and leave it standing on an EMPTY
 * floor. Returns the tower's id (a KEEP promotes the candidate to a component of the same id).
 *
 * Promoting a candidate to a firing component is only possible through the level's harvest, and
 * a harvest sends the wave (`specs/build.md`) — so arming a tower necessarily composes Wave 1.
 * That wave is the game's own traffic, and it walks the same corridor the measurement does. The
 * old arrangement raced it: it measured inside the first 0.6 s, on the reasoning that the kept
 * level's Wave 1 does not release its first unit until 600 ms in. But `specs/enemies.md` leaves
 * "the exact spawn timing and per-wave mix" to the build, so that is the reference build's
 * cadence and nothing a conformant build owes. A build that releases its first unit on the
 * opening tick put one of its own units on the floor alongside the measured one, and a tower on
 * the default `first` priority then shot THAT unit instead — failing a check about whether the
 * tower fires at all.
 *
 * So the wave is run out rather than raced. `skipUntil` spends it instantly in BOTH passes (no
 * wall clock, no filming budget, no footage), and what the caller gets back is the build phase
 * it reopens into: one standing tower, nothing on the floor. `spawnUnit` then releases exactly
 * the units under test into a live wave with nothing else scheduled
 * (`specs/instrumentation.md`), so a measurement reads only what the scenario posed.
 *
 * Integrity is set out of reach first: Wave 1 is deliberately unopposed (one T1 component), so
 * its units leak, and the default 20 Grid Integrity would overload the run before the wave ended.
 * `charge` is applied AFTER the clear, since clearing pays the wave-clear bonus.
 */
export async function armTower(
  api,
  {
    type = "capacitor",
    tier = 1,
    seed = 1,
    difficulty = "medium",
    charge,
    clear = true,
  } = {},
) {
  await startBuild(api, { seed, difficulty });
  await api.call("setIntegrity", 999);
  const cand = await placeCandidate(api, type, tier, TOWER.col, TOWER.row);
  await api.call("keep", cand.id); // the harvest launches Wave 1
  if (clear) await skipClearWave(api);
  if (charge != null) await api.call("setCharge", charge);
  return cand.id;
}

/**
 * ARRANGE. Walk the level's own Wave 1 up to the tower and stop when something is in reach.
 *
 * The counterpart to `armTower({ clear: false })`, for an item that needs the tower to have
 * SOMETHING to shoot but does not care what. That is most of the audio cues: "a zap plays when a
 * Capacitor fires" is a claim about the cue, not about which unit was on the other end of it, so
 * pinning it to a specifically released unit buys nothing and makes an audio check fail whenever
 * the debug spawner does. `specs/enemies.md` has early waves "mostly Motes and Sparks", so a
 * wave walking the corridor is exactly the traffic these items want.
 *
 * Returns the `skipUntil` result; `hit` is false if nothing ever came into reach.
 */
export async function skipToFirstTarget(
  api,
  towerId,
  { lead = 30, max = 120 * SECOND, poll = 3 } = {},
) {
  const t = towerById(await api.snapshot(), towerId);
  if (!t) return { snap: await api.snapshot(), hit: false, spent: 0 };
  const reach = Math.max(t.range || 0, t.auraRadius || 0);
  return api.skipUntil(
    (s) => s.units.some((u) => Math.hypot(u.x - t.cx, u.y - t.cy) <= reach + lead),
    { max, poll },
  );
}

/**
 * ARRANGE. Run the live wave out to the build phase it reopens into, INSTANTLY in both passes.
 *
 * The same drive as `actClearWave`, but on `skipUntil` rather than `until`: it lands in exactly
 * the same state and decides exactly the same verdicts (the validate pass was always instant),
 * while the record pass spends no wall clock and films nothing. Use it whenever a wave is the
 * journey to the evidence rather than the evidence — arming a tower, reopening the build phase
 * for a second placement — and keep `actClearWave` for the items whose subject IS the clear.
 *
 * The poll is coarse (0.5 s) because nothing read here changes between the wave ending and the
 * phase flipping, and a coarse poll is far fewer round trips across a wave's worth of ticks.
 */
export async function skipClearWave(api, { maxTicks = 300 * SECOND, poll = 30 } = {}) {
  const r = await api.skipUntil(
    (s) => s.phase === "build" || s.screen !== "playing",
    { max: maxTicks, poll },
  );
  return r.snap;
}

/**
 * ARRANGE. Spend the walk that brings `unitId` to the edge of `towerId`'s reach, instantly in
 * both passes, and stop `lead` px short of it.
 *
 * A unit released at the Entry walks a few seconds before the corridor tower can touch it. That
 * walk is not the behavior any combat item checks, and filming it burns the clip budget before
 * the shot — but opening the clip with the unit ALREADY under fire is no better, because the
 * first shot then leaves the head before the recording's first frame. Stopping a beat outside
 * range gives the clip a moment of approach, then the shot, its travel, the impact, and the
 * effect it applies.
 *
 * The reach is the piece's own — its firing `range`, or its `auraRadius` for a non-firing
 * support piece, whichever is larger — so this stops a beat outside whatever the piece under
 * test actually projects. A unit that draws alongside the tower's column also counts as
 * arrived, which keeps the helper terminating for a piece that projects nothing at all.
 *
 * Returns the `skipUntil` result; `hit` is false if the unit never got there (it died, leaked,
 * or the tower is nowhere near the route), which a caller should treat as a failed pose.
 */
export async function skipToApproach(
  api,
  towerId,
  unitId,
  { lead = 30, max = 60 * SECOND, poll = 3 } = {},
) {
  const t = towerById(await api.snapshot(), towerId);
  if (!t) return { snap: await api.snapshot(), hit: false, spent: 0 };
  const reach = Math.max(t.range || 0, t.auraRadius || 0);
  return api.skipUntil(
    (s) => {
      const u = unitById(s, unitId);
      if (!u) return false;
      return (
        Math.hypot(u.x - t.cx, u.y - t.cy) <= reach + lead || u.x >= t.cx - lead
      );
    },
    { max, poll },
  );
}

/**
 * ARRANGE (or mid-`act`). Spawn controlled Load units at the Entry through the real spawner
 * and return the NEW
 * units (diffed against those already live), so a caller can track exactly the units it
 * released. In the build phase this transitions to the wave phase with NO composed wave, so
 * the units walk the real pathfinder with nothing else on the floor.
 */
export async function spawnControlled(api, type, opts = {}) {
  const before = new Set((await api.snapshot()).units.map((u) => u.id));
  await api.call("spawnUnit", type, opts);
  const after = (await api.snapshot()).units;
  return after.filter((u) => !before.has(u.id));
}

/**
 * ARRANGE. Assemble a combination tower by the real recipe-combine: place each (type,tier)
 * ingredient
 * as a candidate (the first at the corridor anchor so the combo covers the route
 * entry-spawned units walk), set the explicit combine multiset, and commit. Returns the combo
 * tower's id (it lands at the anchor/initiator footprint) and the ingredient ids.
 *
 * A fresh-consuming recipe is the level's harvest, so the fold launches Wave 1. `clear` (the
 * default) runs that wave out with `skipClearWave`, for the same reason `armTower` does: the
 * caller gets the combo standing on an EMPTY floor and whatever it releases next is alone on
 * it. Pass `clear: false` for an item whose subject is the fold itself and the board it leaves
 * behind, where the wave the harvest sends is part of what the clip should show.
 */
export async function assembleCombo(
  api,
  comboId,
  { seed = 1, charge = 400, difficulty = "medium", clear = true } = {},
) {
  const recipe = RECIPES[comboId];
  await startBuild(api, { seed, difficulty });
  await api.call("setIntegrity", 999);
  const ids = [];
  for (let i = 0; i < recipe.length; i += 1) {
    const [type, tier] = recipe[i];
    const spot = SPOTS[i];
    const cand = await placeCandidate(api, type, tier, spot.col, spot.row);
    ids.push(cand.id);
  }
  await api.call("setCombineSet", ids);
  await api.call("combine", ids[0]);
  const s = await api.snapshot();
  const combo = s.towers.find(
    (t) =>
      t.kind === "combo" && t.col === SPOTS[0].col && t.row === SPOTS[0].row,
  );
  if (clear) await skipClearWave(api);
  // The clear pays the wave-clear bonus, so the Charge a caller asked for is set after it.
  await api.call("setCharge", charge);
  return { comboId: combo ? combo.id : null, ingredientIds: ids };
}

/**
 * ACT. Run the real simulation until the wave clears and the build phase reopens (or the run
 * ends), and return the snapshot at that instant. Polls coarsely (every 15 ticks, a quarter
 * second) because nothing read here changes between the wave ending and the phase flipping.
 * `maxTicks` defaults to 14400 ticks — four minutes of game time, long enough for a full
 * wave to walk the chain and die.
 *
 * Replaces the old `clearWave(api, maxSeconds)`; the seconds budget is now a tick budget.
 */
export async function actClearWave(
  api,
  { maxTicks = 240 * SECOND, poll = 15 } = {},
) {
  const r = await api.until(
    (s) => s.phase === "build" || s.screen !== "playing",
    { max: maxTicks, poll },
  );
  return r.snap;
}

/**
 * Read the inspector's action buttons, waiting for the panel to have been DRAWN.
 *
 * `panelButtons()` reports the buttons as last rendered (`specs/instrumentation.md`), so it is
 * empty until the build's frame loop has painted the inspector — and instant stepping never
 * paints. A fixed `settle` is not a reliable answer to that: the number of animation frames a
 * given pause buys is up to the browser, and a headless Chromium that throttles its frame loop
 * can deliver none at all in a tenth of a second, which is what made a panel read pass on one
 * run and come back empty on the next.
 *
 * So this waits for the panel to appear rather than for a duration: settle, read, and repeat
 * until the buttons are there or the budget is gone. A build that genuinely draws no buttons
 * still returns `[]` — it just takes the full budget to say so, which no check is timing.
 */
export async function readPanel(api, { tries = 12, per = 80 } = {}) {
  let buttons = [];
  for (let i = 0; i < tries; i += 1) {
    await api.settle(per);
    buttons = (await api.call("panelButtons")) ?? [];
    if (buttons.length > 0) return buttons;
  }
  return buttons;
}

/**
 * ARRANGE. Spend a ground unit's walk across the chain instantly and stop it on the Collector's
 * doorstep, `lead` px short of the sink.
 *
 * Everything that happens AT the Collector — the ground-out, the Grid Integrity it costs, the
 * leak alarm, the overload when integrity runs out, the Victory the post-final boss triggers —
 * is at the end of a walk that crosses the yard six times. A Slug takes over a minute to make
 * it, which is several times any recording budget, so filming from the release means the clip
 * runs out somewhere in the middle of the yard and the event itself is never on screen. This
 * skips the crossing and leaves the unit close enough that the act opens on the arrival.
 *
 * It deliberately stops SHORT of the Collector rather than at it: the arrival is what the act
 * is there to measure and to film, so it must not have happened yet.
 *
 * Proximity alone is not enough to know a unit is arriving. The chain doubles back across the
 * yard, so a leg can pass close to the sink while the unit is still several waypoints from
 * being allowed to enter it — on the Substation the WP1->WP2 leg runs down column 44 and clears
 * the Collector by 100 px, most of a lap early. A sweep that stopped on distance alone stopped
 * there, and the act then waited out its whole budget for an arrival that was two legs away.
 * So the unit must ALSO be on the last leg: `waypointIndex` of `k + 1` is the Collector, the
 * node it heads for once the last waypoint is behind it (`specs/instrumentation.md`).
 *
 * `onSample` is called with each sampled snapshot, for a caller that needs to watch something
 * ACROSS the walk rather than only at the end of it — the invincible boss's HP, say, which has
 * to hold steady the whole way past a firing tower and not merely on arrival.
 */
export async function skipUntilNearCollector(
  api,
  unitId,
  { lead = 140, max = 300 * SECOND, poll = 15, onSample } = {},
) {
  const s0 = await api.snapshot();
  const sink = tileCenter(s0.collector.col, s0.collector.row);
  // The chain runs 1..k and the Collector is k+1 (`specs/instrumentation.md`), so the final
  // stretch begins at the last waypoint. The gate is `>= k` rather than `== k + 1` deliberately:
  // this is a NAVIGATION helper used by half a dozen items, and it should walk a unit to the
  // sink rather than sit in judgement on how a build numbers its chain. `pathing/ordered-waypoints`
  // is the item that enforces the numbering, and one item failing for it is the right blast
  // radius — a build that is off by one should not also hang every sweep that needs a unit
  // delivered. Paired with the distance test the looser gate still excludes the early legs: the
  // nearest waypoint platform to the sink is WP6 at (36,20), 260 px away.
  const lastStretch = s0.waypoints.length;
  return api.skipUntil(
    (s) => {
      if (onSample) onSample(s);
      const u = unitById(s, unitId);
      if (!u) return true; // gone already — nothing left to walk
      if (u.waypointIndex < lastStretch) return false; // still working the chain
      return Math.hypot(u.x - sink.x, u.y - sink.y) <= lead;
    },
    { max, poll },
  );
}

// ---- Targeting pose helpers ----------------------------------------------------
//
// Both pose a single Emitter on the corridor (single-target, so only the chosen unit is hit,
// and its head tracks the chosen target every tick regardless of cadence) with an EMPTY floor
// behind it (`armTower`), then walk the units under test up to it.
//
// A priority only chooses among the units currently IN RANGE, so both units of a pose have to
// be inside the Emitter's 88 px reach at the moment the head is read — which is why each pose
// arranges its pair, walks them up together with `skipToApproach`, and only then hands over to
// the act. Everything up to the tower is skipped: instant in both passes, so no verdict moves
// and the clip opens on the pair already under the head.
//
// Each is split across the arrange/act seam: posing the board is arrange, and the act is the
// beat in which the priority is applied and the head swings onto its pick — which is also
// exactly what the clip should show.

// How far apart the head pose separates its two units along the chain, in ticks of walking.
// A Mote covers 60 px/s, so half a second puts ~30 px between them: a clear difference in
// progress and in distance, and still small against the ~145 px stretch of corridor an Emitter
// covers, so both are comfortably in range together.
const HEAD_GAP_TICKS = 0.5 * SECOND;
// Where a pose stops walking its units: this far OUTSIDE the tower's reach, so the tower has not
// fired a single shot when the act begins.
//
// Both poses used to walk the pair INTO range and only then set the priority under test, which
// left two ways to measure the wrong thing. The tower spends the approach on its default `first`
// priority, so by the time the priority was set it had already fired — and a shot is a traveling
// projectile that carries its damage to impact (`specs/towers.md`), so a bolt loosed under
// `first` lands a fraction of a second later, inside the act, and reads as the new priority's
// choice. That is exactly how `weakest` came to fail: the only HP that moved was a Mote hit by a
// shot fired before `weakest` was ever set, and `strongest` passed on the same stray shot only
// because it happened to agree with it.
//
// Stopping short and arming the priority first means every shot the item ever sees was aimed
// under the priority it is testing. It also gives the clip the approach itself, which is the part
// with both units on screen.
const APPROACH_LEAD = 60;
// A coarse sweep for the walk-up. Every sample is a round trip, and the record pass films those
// round trips as a fast-forward before the act begins, so a finer poll buys nothing but a longer
// burst of teleporting units at the head of the clip.
const APPROACH_POLL = 10;

/**
 * ARRANGE half of the head-targeting pose: arm the Emitter, release unit `a`, let it walk
 * ahead, release unit `b` behind it, and walk the pair up to the tower's reach. `a` is then
 * further along the chain AND nearer the tower; `b` is the fresh one. Returns
 * `{ towerId, aId, bId }` for the act half.
 *
 * Both units are released here, which the old split could not do: it spawned `b` from the
 * ACT, because the gap between the two spawns is what separates them and `advance` is the only
 * thing that may consume time in a filmed phase. `skip` lifts that constraint — it moves the
 * same simulation instantly in both passes — so the separation now happens in arrange, and
 * the act is left to be the thing worth watching.
 *
 * Pair with `actHeadTargets`.
 */
export async function arrangeHeadTargets(api, mode) {
  const towerId = await armTower(api, { type: "emitter", tier: 1 });
  // The priority is armed before anything is within reach, so no shot is ever fired under the
  // default one (see APPROACH_LEAD).
  await api.call("setTargeting", towerId, mode);
  const [a] = await spawnControlled(api, "mote", { wave: 8 }); // tough enough to survive the look
  await api.skip(HEAD_GAP_TICKS); // a walks ahead: further along, and nearer the tower
  const [b] = await spawnControlled(api, "mote", { wave: 8 }); // fresh at the Entry, behind a
  // Walk the pair up together, stopping short of the TRAILING unit's reach so neither is yet
  // being shot at and both are on screen when the act opens.
  await skipToApproach(api, towerId, b.id, {
    lead: APPROACH_LEAD,
    poll: APPROACH_POLL,
  });
  return { towerId, aId: a.id, bId: b.id };
}

/**
 * ACT half of the head-targeting pose: film the pair walking into reach and wait for the head to
 * swing onto whichever of them the priority picks, so a caller can assert which one it chose.
 * Returns `{ towerId, t, la, lb }` (the tower snap and the two live units).
 *
 * It waits for the tower to FIRE rather than for a fixed beat. A firing head is only required to
 * "rotate to point at the target it is firing at" (`specs/towers.md`); nothing says it tracks
 * continuously between shots, and a build that turns the head as part of loosing a shot is
 * conformant. The old two-tick wait assumed continuous tracking, and against a build that turns
 * on fire it read the bearing left over from the previous target — which is how `last` came to
 * fail while visibly doing the right thing. An Emitter's own cadence is ~13 ticks, so the wait
 * has to be at least that long whatever the build does.
 *
 * The clip then carries on past the measurement: the priority is a CHOICE between two units, and
 * a reviewer can only see it as one by watching both of them under the head for long enough to
 * tell which it settled on.
 *
 * Pair with `arrangeHeadTargets`.
 */
export async function actHeadTargets(api, { towerId, aId, bId }) {
  // Wait for BOTH units to be inside the tower's reach. A priority only chooses among what is
  // in range, so until both are there the head is not making the choice this item is about — it
  // is shooting the only thing it can see. The pair walks up 30 px apart, so the leading unit
  // enters reach first and a measurement taken then reads its bearing whatever the priority.
  await api.until(
    (s) => {
      const t = towerById(s, towerId);
      const la = unitById(s, aId);
      const lb = unitById(s, bId);
      if (!t || !la || !lb) return false;
      return (
        Math.hypot(la.x - t.cx, la.y - t.cy) <= t.range &&
        Math.hypot(lb.x - t.cx, lb.y - t.cy) <= t.range
      );
    },
    { max: 6 * SECOND, poll: TICK },
  );
  // Then a full firing cadence with both in reach, so at least one shot is loosed with the real
  // choice available — and the head has turned for it, on a build that only turns when it fires.
  await api.advance(0.5 * SECOND);
  const s = await api.snapshot();
  const posed = {
    towerId,
    t: towerById(s, towerId),
    la: unitById(s, aId),
    lb: unitById(s, bId),
  };
  await api.advance(2.5 * SECOND);
  return posed;
}

/**
 * ARRANGE half of the HP-targeting pose: arm the Emitter, release a HIGH-HP and a LOW-HP unit
 * on the SAME tick so progress and distance tie and only HP distinguishes them, walk them up to
 * the tower's reach, and set the targeting `mode`. Returns `{ towerId, strongId, weakId }`.
 *
 * The two units are both MOTES, differing only in the wave their HP is scaled to
 * (`spawnUnit`'s `options.wave`, `specs/instrumentation.md`). The pose used to use a Slug and a
 * Cluster, which works only while the pair is measured where it spawns: they carry different
 * roster SPEEDS (38 vs 72 px/s), so the moment the pose involves any walking they draw apart,
 * and by the time the corridor tower can reach one of them the other is far outside its range
 * and not a candidate for any priority. One type at two wave scalings holds the tie the pose
 * depends on — same speed, same position, same progress — for the whole walk.
 *
 * Pair with `actHpTargets`.
 */
export async function arrangeHpTargets(api, mode) {
  const towerId = await armTower(api, { type: "emitter", tier: 1 });
  // The priority is armed before anything is within reach, so every shot the item sees was aimed
  // under it — see APPROACH_LEAD for what went wrong when it was armed afterwards.
  await api.call("setTargeting", towerId, mode);
  const [strong] = await spawnControlled(api, "mote", { wave: 20 }); // scaled up: the high-HP one
  const [weak] = await spawnControlled(api, "mote", { wave: 4 }); // the low-HP one
  // Stop short of reach: neither has been shot at when the act opens, and both are on screen for
  // it. They spawn on the same tick at the same speed, so they arrive together and only HP tells
  // them apart.
  await skipToApproach(api, towerId, weak.id, {
    lead: APPROACH_LEAD,
    poll: APPROACH_POLL,
  });
  return { towerId, strongId: strong.id, weakId: weak.id };
}

/**
 * ACT half of the HP-targeting pose: read both units' pre-shot HP, then run the real
 * simulation until the first shot lands, so a caller can assert which unit lost HP (the
 * single-target Emitter hits only its chosen target). Polls one tick at a time because the
 * instant the HP drops is what is read. Returns `{ strong, weak, strongHp0, weakHp0 }`.
 *
 * Pair with `arrangeHpTargets`.
 */
export async function actHpTargets(api, { strongId, weakId }) {
  const s0 = await api.snapshot();
  const strongHp0 = unitById(s0, strongId).hp;
  const weakHp0 = unitById(s0, weakId).hp;
  // The pair walks the last of the approach and the first shot lands. The budget covers that
  // walk plus a cadence or two, so a build that opens a component on a full cooldown still
  // resolves.
  await api.until(
    (s) => {
      const a = unitById(s, strongId);
      const b = unitById(s, weakId);
      return (a && a.hp < strongHp0) || (b && b.hp < weakHp0);
    },
    { max: 6 * SECOND, poll: TICK },
  );
  const s = await api.snapshot();
  const posed = {
    strong: unitById(s, strongId),
    weak: unitById(s, weakId),
    strongHp0,
    weakHp0,
  };
  // Carry on past the measurement so a reviewer watches the tower keep picking the same one out
  // of the pair, which is the only way the priority reads as a choice on screen.
  await api.advance(3 * SECOND);
  return posed;
}

// ---- Read helpers --------------------------------------------------------------
export function towerById(s, id) {
  return s.towers.find((t) => t.id === id) ?? null;
}
export function unitById(s, id) {
  return s.units.find((u) => u.id === id) ?? null;
}
export function towerAt(s, col, row) {
  return s.towers.find((t) => t.col === col && t.row === row) ?? null;
}

// The angle from a tower center to a unit, and the smallest difference between two angles
// (for asserting a firing head aims at the chosen target).
export function angleTo(cx, cy, u) {
  return Math.atan2(u.y - cy, u.x - cx);
}
export function angDiff(a, b) {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

// ---- Motion clip ---------------------------------------------------------------
//
// `liveClip` is gone, and nothing replaces it. It existed to hand the clock back and burn
// real time at the END of a script so the recorded video showed the board in motion; under
// the two-pass runtime the `act` phase IS the clip — the record pass replays exactly that
// phase in real time, filming the very scenario the item checks. An item that wants motion
// in its media puts the motion in `act`; there is no separate tail to append, and no script
// ever touches `setAutoStep`.

// ---- Audio (reads the Web Audio cues the build actually schedules) -------------
//
// Arc Foundry's cues are the PRODUCED `.wav` files (specs/assets.md "Audio"), decoded and
// played through the Web Audio API — the driver reports every source the build starts (see
// `api.audio`). The game must not autoplay: `main.ts`'s `gesture()` creates (and resumes) the
// `AudioContext` only on the first REAL DOM interaction the raw `input.ts` listeners catch (a
// canvas `mousedown` or a window `keydown`), so arming uses `api.userKey`/`api.userClick` — a
// genuine, browser-trusted tap — rather than the debug API's own `press`/`click`. A build may
// feed the debug API through a purely logical input path that never reaches those DOM
// listeners; a debug press would then leave a conformant build's `AudioContext` uncreated and
// no cue would ever be scheduled, though it plays fine for a real player. `KeyZ` binds nothing
// (specs/controls.md), and (4, 4) sits in the top status bar, left of its leftmost control
// (COMBOS at x=838) and above the board hit-test's `y > STATUS_H` (56) — so the click lands on
// no clickable region in ANY game state (`main.ts`'s `routeClick`) and arming never disturbs
// game state, in the build phase, a live wave, or a menu.
//
// A cue is not played the instant the game logic decides to play it: `sim.ts` only QUEUES it
// (`game.sndQueue`), and `main.ts`'s animation-frame loop is what flushes the queue into actual
// `audio.play()` calls, once a frame. That loop keeps running in REAL time — driven by
// Chromium's own rendering, not by anything the driver does — regardless of what the debug
// API's manual clock is doing, so the flush (and the arm's own `resume()`, which the same
// frame loop's `gesture()` kicks off) needs a slice of REAL wall-clock time to land, not
// another instant `step()`. `api.settle` is exactly that: a real pause in both the validate and
// the record pass. `armAudio` settles after arming; a script settles again after driving its
// cue's event, before reading the audio log.
export const AUDIO_SETTLE_MS = 150;

/** ARRANGE. Arm audio with a genuine browser gesture (a key tap and a corner click), then
 * settle so the build's own frame loop has real time to create/resume the `AudioContext`,
 * decode the produced clips, and (unmuted) start the music loop. Call this LAST in `arrange`,
 * after everything else has posed the scenario. */
export async function armAudio(api) {
  await api.userKey("KeyZ");
  await api.userClick(4, 4);
  await api.settle(AUDIO_SETTLE_MS);
}

/** The number of Web Audio sources the build has started so far. */
export async function audioCount(api) {
  return (await api.audio()).length;
}

/**
 * Read the audio log once it has grown past `baseline`, waiting for the cue rather than for a
 * fixed pause. Returns the count reached, whether or not it grew.
 *
 * A cue does not become a Web Audio source the instant the simulation decides to play it. The
 * sim only QUEUES it; the build's animation-frame loop flushes the queue into real `play()`
 * calls, the `AudioContext` may still be resuming from the arming gesture, and a produced clip
 * has to finish decoding before anything can be started from it. All of that is real,
 * asynchronous, and none of it is on the simulation clock — so how much of it lands inside any
 * given pause is up to the browser, and a single fixed `settle` is a guess. It was a good enough
 * guess most of the time, which is the worst kind: the music-bed check in particular passed on
 * one run and failed on the next with nothing changed.
 *
 * Settling in short slices until the log moves turns that into a wait for the thing itself. A
 * build that never plays the cue still returns an ungrown count — it just takes the full budget
 * to say so, and no check is timing how long the answer took.
 */
export async function waitForAudio(api, baseline, { tries = 12, per = AUDIO_SETTLE_MS } = {}) {
  let n = await audioCount(api);
  for (let i = 0; i < tries && n <= baseline; i += 1) {
    await api.settle(per);
    n = await audioCount(api);
  }
  return n;
}
