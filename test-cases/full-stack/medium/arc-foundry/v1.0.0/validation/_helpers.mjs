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
//     still call control ops (to pose a second scenario mid-scene), and it may call
//     api.reset(): the build's own `reset` switches it to the manual clock, but the
//     runtime hands the clock straight back afterwards, so a reset mid-`act` does not
//     leave the recording filming a frozen game. Reach for it only when revisiting a
//     fresh state is what the item has to SHOW (`pathing/three-maps` walks all three
//     boards on camera); a scenario's opening pose still belongs in `arrange`.
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

// ---- Unmet preconditions -------------------------------------------------------

/**
 * Throw an UNMET PRECONDITION: the build answered every debug-API call correctly, but the
 * scenario this item wanted to pose did not take, so there is nothing to grade.
 *
 * An unmarked throw means the API misbehaved and fails the point; this one is recorded as
 * inconclusive and fails nothing, leaving the point for the reviewer. See
 * `PRECONDITION_UNMET` in `packages/browser-driver/validation.mjs` for why this is a plain
 * property rather than a shared error class (this file is loaded by path and cannot import it).
 */
export function unmetPrecondition(reason) {
  const err = new Error(reason);
  err.ttcPreconditionUnmet = true;
  return err;
}

// ---- The maze wall -------------------------------------------------------------
//
// One 2x2 piece dropped astride the row-5 corridor between the Entry and WP1, covering columns
// 20..21 of rows 4..5. The ground route has to round it: it dips a row before the wall, runs along
// under it, and rejoins the corridor after — trading two of the corridor's orthogonal steps for
// two diagonal ones.
//
// A single piece is enough because a route's LENGTH is what the maze figure measures — the sum of
// its step lengths, a diagonal counting sqrt(2) tiles against an orthogonal step's 1
// (`specs/board.md` "Shortest open route", `specs/controls.md`). So that dip costs 2*(sqrt(2) - 1),
// about 0.83 tiles, and the figure rises. Any wall the route must go around raises it; nothing
// here needs a bigger structure than the one placement the claim is about.
export const MAZE_WALL = { col: 20, row: 4 };

/**
 * ARRANGE. Drop the maze wall through the real placement path and return its piece id. Placement
 * is free and costs one of the level's five stamps.
 *
 * Throws an unmet precondition if the drop was refused: the anchor is legal on the Substation as
 * the spec lays it out (open floor, clear of every waypoint platform, sealing nothing), so a
 * build that refuses it has posed no wall to measure — and these items' subject is what a wall
 * DOES to the route, not which placements a build accepts (`pathing/never-seal-refused` and
 * `pathing/no-build-on-waypoint` are the items that grade refusals).
 */
export async function buildMazeWall(api) {
  const cand = await placeCandidate(api, "capacitor", 1, MAZE_WALL.col, MAZE_WALL.row);
  if (!cand) {
    throw unmetPrecondition(
      `the maze wall was refused at (${MAZE_WALL.col},${MAZE_WALL.row}); ` +
        `no wall was posed to measure`,
    );
  }
  return cand.id;
}

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
 * Returns the opening snapshot. Poses only, so it belongs in `arrange` — but it is safe in
 * `act` for an item whose subject IS reopening a run, since the runtime hands the build's
 * clock back after a reset (see the arrange/act seam above).
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
 * tower's id (it lands at the anchor/initiator footprint) and the ingredients as
 * `{ id, col, row }` — each one's FOOTPRINT as well as the id it was placed under.
 *
 * The footprints are what a caller checking the fold's aftermath wants. A consumed ingredient
 * is gone as a piece: `specs/build.md` has its FOOTPRINT harden into an inert blocker, and
 * whether the build hardens the piece in place under its old id or replaces it with a fresh
 * blocker at the same tiles is its own affair — no spec pins a piece's id across a combine.
 * So the anchor is the stable handle to what the fold left behind, and the id is only good
 * for naming the pieces the fold was given.
 *
 * A fresh-consuming recipe is the level's harvest, so the fold launches Wave 1. `clear` (the
 * default) runs that wave out with `skipClearWave`, for the same reason `armTower` does: the
 * caller gets the combo standing on an EMPTY floor and whatever it releases next is alone on
 * it. Pass `clear: false` for an item whose subject is the fold itself and the board it leaves
 * behind, where the wave the harvest sends is part of what the clip should show.
 */
/**
 * ARRANGE. Pose a recipe's ingredient board through the real placement path and name the explicit
 * combine multiset, WITHOUT committing the fold. Returns `{ ingredients, ids, initiatorId }`.
 *
 * Split out of `assembleCombo` so an item whose subject is the ASSEMBLY can hold on the posed
 * ingredients and then fold them on camera (`commitCombo`), rather than being handed a board on
 * which the fold has already happened.
 */
export async function arrangeComboBoard(api, comboId, { seed = 1, difficulty = "medium" } = {}) {
  const recipe = RECIPES[comboId];
  await startBuild(api, { seed, difficulty });
  await api.call("setIntegrity", 999);
  const ingredients = [];
  for (let i = 0; i < recipe.length; i += 1) {
    const [type, tier] = recipe[i];
    const spot = SPOTS[i];
    const cand = await placeCandidate(api, type, tier, spot.col, spot.row);
    if (!cand) {
      throw unmetPrecondition(
        `the ${type} T${tier} ingredient was refused at (${spot.col},${spot.row}); the recipe ` +
          `board could not be posed`,
      );
    }
    ingredients.push({ id: cand.id, col: spot.col, row: spot.row });
  }
  const ids = ingredients.map((g) => g.id);
  await api.call("setCombineSet", ids);
  return { ingredients, ids, initiatorId: ids[0] };
}

/**
 * Commit the fold `arrangeComboBoard` posed and return the combination tower it produced (or
 * `null` if none did). Legal in `act`, which is where an item whose evidence is the ASSEMBLY
 * itself has to commit it — the fold is the event, and posing it in `arrange` puts it before the
 * recording's first frame.
 */
export async function commitCombo(api, initiatorId) {
  await api.call("combine", initiatorId);
  const s = await api.snapshot();
  const combo = s.towers.find(
    (t) => t.kind === "combo" && t.col === SPOTS[0].col && t.row === SPOTS[0].row,
  );
  return combo ? combo.id : null;
}

export async function assembleCombo(
  api,
  comboId,
  { seed = 1, charge = 400, difficulty = "medium", clear = true } = {},
) {
  const { ingredients, ids } = await arrangeComboBoard(api, comboId, { seed, difficulty });
  await api.call("combine", ids[0]);
  const s = await api.snapshot();
  const combo = s.towers.find(
    (t) =>
      t.kind === "combo" && t.col === SPOTS[0].col && t.row === SPOTS[0].row,
  );
  if (clear) await skipClearWave(api);
  // The clear pays the wave-clear bonus, so the Charge a caller asked for is set after it.
  await api.call("setCharge", charge);
  return { comboId: combo ? combo.id : null, ingredients };
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

// ---- The held rock's ghost (for an item whose evidence is a REFUSAL) ------------
//
// A refused placement leaves the board exactly as it was, so a still taken after one is a
// picture of nothing happening — indistinguishable from a build that was never asked. The
// evidence a reviewer needs is the refusal being MADE: a rock held over the tile with its
// footprint cue reading illegal (`#ff4d4d`, `specs/controls.md`). These two helpers pose that
// and read it back.

/**
 * Whether the held ghost's 2x2 footprint covers tile `(col, row)`.
 *
 * The test is on the footprint rather than on the anchor because `specs/board.md` says only
 * that "the placement preview snaps the 2x2 block to the grid under the cursor" — it does not
 * pin whether the block's anchor is the tile under the pointer or the block is centred on it,
 * and both readings are conformant. Every claim these items actually make is about which TILE
 * the rock is over, which coverage answers under either reading.
 */
export function heldCovers(held, col, row) {
  if (!held || !held.active) return false;
  return (
    col >= held.col && col <= held.col + 1 && row >= held.row && row <= held.row + 1
  );
}

/**
 * ACT. Pull the scrap-press the way a player does (`B`, `specs/controls.md`), park the pointer
 * on `(col, row)`, and let the build paint the held ghost. Returns the ghost as the snapshot
 * reports it, for a caller that wants to assert WHERE it is and how its cue reads before
 * capturing the still.
 *
 * The settle is real time in both passes: the ghost is PAINTED from hover state and instant
 * stepping paints nothing, the same reason `readPanel` waits rather than steps. It is generous
 * because a headless browser may throttle its frame loop.
 */
export const GHOST_PAINT_MS = 300;

export async function hoverHeldRock(api, col, row, { paintMs = GHOST_PAINT_MS } = {}) {
  await api.call("press", "KeyB");
  const c = tileCenter(col, row);
  await api.call("pointerMove", c.x, c.y);
  await api.settle(paintMs);
  return (await api.snapshot()).held;
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

// ---- Menus (driven by the mouse, the way the spec makes primary) ----------------
//
// `specs/ui.md` fixes each menu's CONTENT and NAVIGATION but leaves its layout to the build, and
// `specs/controls.md` requires every menu to be "fully operable with the mouse alone, with the
// keyboard accelerators as an alternative" — the pointer being the primary path and the keys "an
// alternative". So a check that drives menus by `Enter` is checking the alternative, and failing a
// build for it reads as "this state is unreachable" when the state is perfectly reachable with the
// mouse. That is what happened: a build whose menus a player walks without trouble failed four
// state-reachability items because it bound no menu keys.
//
// Clicking instead needs somewhere to click, and no spec pins menu geometry. `menuButtons()` is
// what closes that gap (`specs/instrumentation.md`), exactly as `panelButtons()` does for the
// inspector: it reports the current menu's entries with their rectangles and an `action` naming
// where each one leads, and a click at the middle of a reported rectangle must activate it. A
// script can then take the mouse path on ANY layout.

/**
 * Read the current menu's entries, waiting for the menu to have been DRAWN.
 *
 * A menu screen is PAINTED, not simulated: `step` does nothing at all on one
 * (`specs/instrumentation.md`), so no amount of instant stepping produces the frame a
 * geometry read needs, and a build that reports its entries from the last rendered frame
 * legitimately has nothing to report until it has drawn. A fixed `settle` is not a reliable
 * answer either — how many animation frames a given pause buys is up to the browser, and a
 * throttled headless Chromium can deliver none.
 *
 * So this waits for the entries to appear rather than for a duration, exactly as `readPanel`
 * does. A build that genuinely draws no entries still returns `[]`, taking the full budget to
 * say so, which no check is timing.
 */
export async function readMenu(api, { tries = 12, per = 80 } = {}) {
  let entries = [];
  for (let i = 0; i < tries; i += 1) {
    await api.settle(per);
    entries = (await api.call("menuButtons")) ?? [];
    if (entries.length > 0) return entries;
  }
  return entries;
}

/**
 * Click a menu choice by its `action`, the way a player would: find the entry the build reports
 * and click the middle of the rectangle it reported, then wait for the screen to change. Returns
 * the entry, or null if the menu offered no such choice (which a caller should treat as the
 * navigation failing, not as a throw — the point of the click is to find out whether the choice
 * leads where the spec says).
 */
export async function clickMenu(api, action, { tries = 12, per = 80 } = {}) {
  const entries = await readMenu(api);
  const entry = entries.find((e) => e && e.action === action && !e.disabled);
  if (!entry) return null;
  const from = (await api.snapshot()).screen;
  await api.call("click", entry.x + entry.w / 2, entry.y + entry.h / 2);
  // Wait for the navigation to LAND rather than assuming it landed by the next round trip.
  //
  // A build is free to handle its click asynchronously — one does, gating the menu action behind
  // `await audio.resume()` so its own AudioContext is running before anything else happens, which
  // is a perfectly sensible thing to do on a first interaction. The debug API's `click` returns as
  // soon as it has dispatched, so a screen read taken on the very next call can beat the handler
  // to it, and the item reports a state as unreachable when a player reaches it in one click.
  // Nothing in `specs/instrumentation.md` requires a click to resolve synchronously — only that a
  // click at the reported rectangle "must activate that choice" — so the wait is the check's job.
  //
  // A build that genuinely goes nowhere still returns after the full budget, which no check times.
  // Read BEFORE settling, so a build that navigates synchronously — which is most of them, and
  // the reference among them — pays nothing for this and its media is unchanged.
  for (let i = 0; i < tries; i += 1) {
    if ((await api.snapshot()).screen !== from) break;
    await api.settle(per);
  }
  return entry;
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

// ---- The spread pack (for an effect whose subject is hitting SEVERAL units) -----
//
// The Coil's chain and the Arc-Node's splash are claims about ONE shot touching MORE THAN ONE
// unit, so the media has to show more than one unit being touched. Both items used to release
// their pack with `spawnUnit`'s `count`, which spawns every unit AT THE ENTRY on the same tick —
// so all of them sat at exactly the same coordinates, walked at the same speed, and stayed
// perfectly superimposed for the whole clip. Measured against the run implementation the four
// units of the pack were all at (120, 166): a reviewer watching the recording sees a single
// Mote, and the one thing the item exists to demonstrate is invisible. Worse, the check passed
// on it — "two units lost HP" is trivially true of two units in the same place, which is not
// what "chains to NEARBY units" or "splashes an AREA" means.
//
// So the pack is released one unit at a time with a walk between releases, which spaces it along
// the corridor: separate sprites on screen, at a real distance from each other, so the effect
// visibly reaches PAST its primary target. The gap is chosen against the spec's own radii
// (`specs/towers.md`): a T1 Arc-Node splashes 42 px from the impact point and a Coil's bolt leaps
// up to 70 px, so at 24 px apart the neighbours are comfortably inside both while still reading
// as distinct units (a unit is drawn about one 20 px tile across).
export const PACK_COUNT = 4;
// 0.4 s at a Mote's 60 px/s is ~24 px between neighbours.
const PACK_GAP_TICKS = 0.4 * SECOND;
// How far up the wave ramp the pack is scaled. This is a balance between two ways the clip can
// fail to show the effect, and it used to sit hard against one of them.
//
// A Wave-1 Mote pops in a hit or two and takes the evidence off screen with it. But at Wave 14 a
// Mote carries ~170 HP, and a Scrap Coil's bolt deals 5 — so one hit moves its bar by 3%, and
// the leaps beyond the primary target deal LESS than that again (`specs/towers.md`). Measured
// against all three run implementations the act was several seconds of units walking through a
// tower that was plainly firing and visibly doing nothing at all: the snapshot could see the
// chain in the HP numbers, and a reviewer watching the recording could not see it anywhere.
//
// Wave 6 (~69 HP) is the middle: a bolt takes a visible bite out of the bar and each leap is a
// legible smaller one, while the pack still survives the whole act — the item's own budget is
// six seconds of firing plus a three-second tail, which at a Coil's one shot a second is well
// short of killing anything.
const PACK_WAVE = 6;

/**
 * ARRANGE. Arm a firing piece on the corridor and walk a SPREAD pack of Motes up to it, stopping
 * before the leader is in reach so the act opens on the pack closing the last stretch.
 *
 * Returns `{ towerId, ids, initHp }` — the pack in chain order (leader first) and each unit's HP
 * at the moment the act begins, which is what an "how many were hurt by one shot" check diffs
 * against.
 *
 * The approach stops on the LEADER, not the tail: stopping on the tail would leave the leader
 * already well inside range, and the first shot — the one the whole item is about — would be away
 * before the recording's first frame.
 */
/**
 * ARRANGE. Release `count` Motes at the Entry ONE AT A TIME, with a walk between releases, so the
 * pack is spaced along the corridor rather than stacked on the spawn tile. Returns their ids in
 * chain order (leader first).
 *
 * `spawnUnit`'s own `count` puts every unit at the Entry on the same tick, which leaves them at
 * identical coordinates walking at identical speeds — one sprite as far as any recording is
 * concerned. Any item whose claim is about SEVERAL units (a chain forking, a splash covering an
 * area, a volley engaging distinct targets) then films a single Mote and demonstrates nothing.
 */
export async function releaseSpread(api, { count = PACK_COUNT, wave = PACK_WAVE, gap = PACK_GAP_TICKS } = {}) {
  const ids = [];
  for (let i = 0; i < count; i += 1) {
    const [u] = await spawnControlled(api, "mote", { wave });
    if (!u) {
      throw unmetPrecondition(
        `only ${ids.length} of ${count} pack units could be released; there is no pack to hit`,
      );
    }
    ids.push(u.id);
    if (i < count - 1) await api.skip(gap); // this one walks ahead of the next
  }
  return ids;
}

export async function arrangeSpreadPack(api, type, { tier = 1, count = PACK_COUNT } = {}) {
  const towerId = await armTower(api, { type, tier });
  const ids = await releaseSpread(api, { count });
  // Sweep coarsely: every sample is a round trip, and the record pass films those round trips as
  // a fast-forward before the act begins, so a fine poll buys only a longer burst of teleporting
  // units at the head of the clip.
  await skipToApproach(api, towerId, ids[0], { lead: APPROACH_LEAD, poll: APPROACH_POLL });
  const s = await api.snapshot();
  const initHp = {};
  for (const id of ids) {
    const l = unitById(s, id);
    if (l) initHp[id] = l.hp;
  }
  return { towerId, ids, initHp };
}

/** How many of `ids` are below the HP they started the act with — i.e. hurt by what just fired. */
export function hurtCount(s, ids, initHp) {
  let hurt = 0;
  for (const id of ids) {
    const l = unitById(s, id);
    if (l && l.hp < initHp[id]) hurt += 1;
  }
  return hurt;
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

// ---- The `nearest` pose --------------------------------------------------------
//
// `nearest` is the one priority `arrangeHeadTargets` cannot grade, and it silently did not.
// That pose releases its pair a beat apart on a corridor the tower sits BESIDE and stops them
// as they walk in, so the leading unit is further along the chain AND closer to the tower for
// the whole measurement: `first` and `nearest` name the same unit, and a build that implements
// either one passes both. Measured against a run implementation that visibly shot the
// furthest-along unit under `nearest`, this item passed it.
//
// Progress and distance only come apart once a unit has walked PAST the tower's column, because
// from there every further step takes it away again. So this pose walks the pair on until the
// leader is beyond the column and the TRAILING unit is the nearer of the two, and stops at the
// first instant that holds with both still inside the tower's reach — the earliest such instant,
// which leaves the most of that window for the act to spend.
//
// The pair is Slugs (38 px/s) rather than Motes, so the stretch of corridor the tower covers
// takes three times as long to cross and the window in which the trailing unit is the nearer one
// is wide enough to measure in. A Slug scaled to Wave 8 carries ~380 HP against a Scrap Emitter's
// 2 a shot, so neither unit is going anywhere during the look.
//
// The tower stays the Emitter the other head-targeting items use, and its cadence is why. The act
// reads the head half a second after the pose is handed over, and a build is only required to
// point the head "at the target it is firing at" (`specs/towers.md`) — nothing says it tracks
// between shots. So the wait has to contain a shot fired under the posed geometry, or the bearing
// read is the one left over from before the trailing unit became the nearer of the two. An
// Emitter fires every ~13 ticks and clears that easily; a Capacitor, at ~37 ticks, does not fit
// inside the same half second at all.
const NEAREST_GAP_TICKS = 1.2 * SECOND; // ~45 px between two Slugs: plainly two units
// How much nearer, in px, the trailing unit must be before the pose counts as posed. Enough that
// the choice cannot turn on a rounding difference, small enough that it arises early in the
// window.
const NEAREST_MARGIN = 12;

/**
 * ARRANGE half of the `nearest` pose: arm the Emitter, release two Slugs a beat apart, and
 * walk them on until the trailing one is the NEARER of the two with both inside the tower's
 * reach. Returns `{ towerId, aId, bId }` — `a` the leader (further along, further away), `b` the
 * trailing unit `nearest` is required to pick.
 *
 * Throws an unmet precondition if that instant never arrives, because then the board never
 * offered a choice in which `nearest` and `first` differ and a verdict either way would be
 * meaningless.
 *
 * Pair with `actHeadTargets`.
 */
export async function arrangeNearestTargets(api) {
  const towerId = await armTower(api, { type: "emitter", tier: 1 });
  // Armed before anything is in reach, so no shot is ever loosed under the default priority —
  // see APPROACH_LEAD for what went wrong when a priority was armed afterwards.
  await api.call("setTargeting", towerId, "nearest");
  const [lead] = await spawnControlled(api, "slug", { wave: 8 });
  await api.skip(NEAREST_GAP_TICKS); // the leader walks ahead, and will pass the tower first
  const [trail] = await spawnControlled(api, "slug", { wave: 8 });
  if (!lead || !trail) {
    throw unmetPrecondition("the nearest-targeting pair could not both be released");
  }
  const posed = await api.skipUntil(
    (s) => {
      const t = towerById(s, towerId);
      const a = unitById(s, lead.id);
      const b = unitById(s, trail.id);
      if (!t || !a || !b) return false;
      const dA = Math.hypot(a.x - t.cx, a.y - t.cy);
      const dB = Math.hypot(b.x - t.cx, b.y - t.cy);
      return dA <= t.range && dB <= t.range && dB + NEAREST_MARGIN < dA;
    },
    { max: 120 * SECOND, poll: TICK },
  );
  if (!posed.hit) {
    throw unmetPrecondition(
      "no instant arose with both units inside the tower's reach and the TRAILING one nearer, " +
        "so `nearest` and `first` would have named the same unit and the pose could not tell " +
        "them apart",
    );
  }
  return { towerId, aId: lead.id, bId: trail.id };
}

// How far apart the HP pose separates its two units along the chain, in ticks of walking. ~27 px
// between two Slugs: plainly two sprites, and small against the ~190 px stretch of corridor a
// Tuned Capacitor covers, so the pair is in reach together for most of the crossing.
//
// The gap is deliberately no wider than it has to be. Everything this pose does — wearing one
// unit down, and then measuring the choice — has to happen while BOTH units are inside the
// tower's reach, and every pixel of gap is a pixel off the front of that window. It also costs
// twice over: while the leader is in reach alone the tower is already shooting it, which drags
// down the HP the wearing-down afterwards has to beat.
const HP_GAP_TICKS = 0.7 * SECOND;
// Bounded wait for the tower's in-flight shots to land before the measurement is baselined. See
// `actHpTargets` for why this matters and why it is only best-effort.
const CLEAR_SHOTS_TICKS = 1 * SECOND;
// How long the pose watches the tower keep choosing, once both units are in reach and baselined.
// A Tuned Capacitor's cadence is ~37 ticks, so this is a couple of full cadences — enough that
// the unit it favours is unmistakable, and short enough to finish before the pair walks out the
// far side of the reach the wearing-down already spent half of.
const HP_MEASURE_TICKS = 1.2 * SECOND;

// How far below its partner the wounded unit of the pair is posed, as a fraction of the maximum
// they share. Two fifths is unmistakable in a bar read at a glance, and far more than the
// measurement that follows can close, so the pair cannot swap places mid-measurement and turn the
// reading over.
const WOUNDED_AT = 0.4;

/**
 * ARRANGE half of the HP-targeting pose: arm the Capacitor, release two identical Slugs a beat
 * apart, walk them into reach, wound ONE of them outright, and only then arm the targeting `mode`.
 * Returns `{ towerId, strongId, weakId, pickId, otherId }` — `pickId` being the unit `mode` is
 * required to choose, which is the TRAILING unit whichever mode it is.
 *
 * WHY THE PAIR IS IDENTICAL. The two units used to be separated by scaling them to different waves
 * (`spawnUnit`'s `options.wave`), which gives them different HP and different MAXIMUM HP. The
 * check could read that difference; a reviewer could not see it, because an HP bar is a fraction
 * of a unit's own maximum and two units at full health both draw a full bar however far apart
 * their totals are. The recording showed two apparently identical Slugs and a tower choosing
 * between them for reasons invisible on screen — which is not evidence of a targeting priority,
 * it is a picture of a tower shooting. Identical units at one wave scaling share a maximum, so a
 * difference in HP is a difference in the bar.
 *
 * WHY THE DIFFERENCE IS SET RATHER THAN SHOT IN. The difference used to be made by aiming the
 * tower at one of the pair and letting it wear that unit down — which meant the pose LEANED on a
 * targeting priority (`first` to hit the leader, `last` to hit the trailing one) in order to
 * grade a targeting priority. Against a build whose `last` is broken the tower spent the sweep
 * shooting the unit that was supposed to be left alone, and `weakest` could not be posed at all:
 * it came back inconclusive on exactly the builds it existed to catch. `setUnitHp`
 * (`specs/instrumentation.md`) removes the circularity — the wound is posed directly, no priority
 * has to work for the scenario to exist, and a build that gets `mode` wrong now fails plainly
 * instead of going ungraded.
 *
 * Which unit is wounded is what makes each mode's answer the TRAILING one, and that is the point:
 * a trailing unit is neither the furthest along nor the nearest, so a build that confuses the mode
 * under test with `first` or `nearest` reaches for the wrong unit and fails.
 *
 *   * `strongest` wounds the LEADER, leaving the trailing unit the healthier of the two.
 *   * `weakest` wounds the TRAILING unit, leaving it the hurt one.
 *
 * A Capacitor and Slugs, rather than the old Emitter and Motes, because the measurement has to fit
 * inside the stretch of corridor over which the tower can reach both units: Slugs cross it at
 * 38 px/s instead of 60, and a Capacitor's 108 px reach makes it longer to begin with.
 *
 * Pair with `actHpTargets`.
 */
export async function arrangeHpTargets(api, mode) {
  const towerId = await armTower(api, { type: "capacitor", tier: 2 });
  const [lead] = await spawnControlled(api, "slug", { wave: 3 });
  await api.skip(HP_GAP_TICKS); // one walks ahead: further along the chain, and nearer the tower
  const [trail] = await spawnControlled(api, "slug", { wave: 3 });
  if (!lead || !trail) {
    throw unmetPrecondition("the HP-targeting pair could not both be released");
  }

  // Walk the pair on until BOTH are inside the tower's reach: a priority only ever chooses among
  // what is in range, so until both are there the tower is not making the choice under test.
  const inReach = await api.skipUntil(
    (s) => {
      const t = towerById(s, towerId);
      const a = unitById(s, lead.id);
      const b = unitById(s, trail.id);
      if (!t || !a || !b) return false;
      return (
        Math.hypot(a.x - t.cx, a.y - t.cy) <= t.range &&
        Math.hypot(b.x - t.cx, b.y - t.cy) <= t.range
      );
    },
    { max: 120 * SECOND, poll: TICK },
  );
  if (!inReach.hit) {
    throw unmetPrecondition(
      "the pair never came inside the tower's reach together, so there was no choice to pose",
    );
  }

  // Wound one of them outright. Both were released alike, so they share a maximum and this is a
  // difference a reviewer can read off the bars.
  const woundedId = mode === "strongest" ? lead.id : trail.id;
  const wounded = unitById(inReach.snap, woundedId);
  if (!wounded) {
    throw unmetPrecondition("the unit this pose has to wound was gone before it could be posed");
  }
  await api.call("setUnitHp", woundedId, Math.max(1, Math.round(wounded.maxHp * WOUNDED_AT)));

  // Read it back: `setUnitHp` is part of the debug-API contract, and a build that ignores it has
  // posed no difference for the priority to choose on. Failing loudly here beats measuring a pair
  // that is still identical and reporting whatever the tower happened to do.
  const posed = await api.snapshot();
  const hurt = unitById(posed, woundedId);
  const whole = unitById(posed, mode === "strongest" ? trail.id : lead.id);
  if (!hurt || !whole || !(hurt.hp < whole.hp)) {
    throw new Error(
      `setUnitHp did not wound the unit it was given: ${woundedId} reads ` +
        `${hurt ? Math.round(hurt.hp) : "gone"} of ${hurt ? Math.round(hurt.maxHp) : "?"} ` +
        `against its partner's ${whole ? Math.round(whole.hp) : "gone"}`,
    );
  }

  // Only now is the priority under test armed, so every shot the item goes on to see was aimed
  // under it — see APPROACH_LEAD for what went wrong when a priority was armed afterwards.
  await api.call("setTargeting", towerId, mode);

  const strongId = mode === "strongest" ? trail.id : lead.id;
  const weakId = mode === "strongest" ? lead.id : trail.id;
  return { towerId, strongId, weakId, pickId: trail.id, otherId: lead.id };
}

/**
 * ACT half of the HP-targeting pose: wait until both units are genuinely in reach together,
 * baseline their HP there, then watch the tower shoot for a while and report how much damage each
 * of them took. Returns `{ strong, weak, strongHp0, weakHp0, bothInReach, pickDamage,
 * otherDamage, firstHitWasPick }`.
 *
 * WHY IT WAITS FOR THE AIR TO CLEAR BEFORE BASELINING. `arrangeHpTargets` hands over a pair that
 * is already both in reach, and the tower has been firing at them under its default priority for
 * the whole walk in. A shot is a traveling projectile that carries its damage to impact
 * (`specs/towers.md`), so the last of those shots is still in the air when the priority under test
 * is armed, and it lands a fraction of a second later — inside the measurement, against whichever
 * unit the OLD priority chose. Baselining before it drains would count that damage against the
 * new priority and could invert the reading outright.
 *
 * Waiting for the projectile list to drain is best-effort and bounded — a build with a fast enough
 * cadence may never show an empty one — which is why the verdict rests on how the damage is
 * DIVIDED across a window of several shots rather than on a single hit. Over a good half-dozen
 * cadences the unit the tower actually favours takes visibly more, and one stray impact cannot
 * flip that.
 *
 * Pair with `arrangeHpTargets`.
 */
export async function actHpTargets(api, { towerId, strongId, weakId, pickId, otherId }) {
  // Both in reach: until then the head is not making the choice this item is about.
  const reach = await api.until(
    (s) => {
      const t = towerById(s, towerId);
      const a = unitById(s, strongId);
      const b = unitById(s, weakId);
      if (!t || !a || !b) return false;
      return (
        Math.hypot(a.x - t.cx, a.y - t.cy) <= t.range &&
        Math.hypot(b.x - t.cx, b.y - t.cy) <= t.range
      );
    },
    { max: 6 * SECOND, poll: TICK },
  );
  // Let whatever was already in the air land, so it cannot be counted as this priority's pick.
  await api.until((s) => (s.projectiles || []).length === 0, {
    max: CLEAR_SHOTS_TICKS,
    poll: TICK,
  });

  const s0 = await api.snapshot();
  const hp0 = (id) => {
    const u = unitById(s0, id);
    return u ? u.hp : 0;
  };
  const strongHp0 = hp0(strongId);
  const weakHp0 = hp0(weakId);
  const pickHp0 = hp0(pickId);
  const otherHp0 = hp0(otherId);

  // Which one the tower reaches for first, now that it has a real choice.
  const first = await api.until(
    (s) => {
      const p = unitById(s, pickId);
      const o = unitById(s, otherId);
      return (!p || p.hp < pickHp0) || (!o || o.hp < otherHp0);
    },
    { max: 6 * SECOND, poll: TICK },
  );
  const firstHitWasPick = (() => {
    const p = unitById(first.snap, pickId);
    return !p || p.hp < pickHp0;
  })();

  // Then watch it keep choosing, which is also what makes the priority read as a choice on screen.
  await api.advance(HP_MEASURE_TICKS);
  const s = await api.snapshot();
  const damage = (id, before) => {
    const u = unitById(s, id);
    return u ? before - u.hp : before; // gone entirely means it took everything it had
  };

  return {
    strong: unitById(s, strongId),
    weak: unitById(s, weakId),
    strongHp0,
    weakHp0,
    bothInReach: reach.hit,
    firstHitWasPick,
    pickDamage: damage(pickId, pickHp0),
    otherDamage: damage(otherId, otherHp0),
  };
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

/**
 * The label an audio-cue assertion carries, which changes when the build turns out not to use Web
 * Audio at all.
 *
 * "act=0" on its own is a confusing thing to hand a reviewer who can plainly HEAR the build: it
 * reads as "the cue did not play" when what actually happened may be that the cue played
 * perfectly, through a path this probe cannot see. `api.audio` reports Web Audio sources — it
 * wraps the source nodes' `start()` — and a build that plays its produced `.wav`s from an
 * `<audio>` element instead starts none of them, so every audio item comes back zero while the
 * yard is making noise. One run implementation does exactly that, and the flat "0" sent a reviewer
 * looking for a missing sound that was not missing.
 *
 * `specs/assets.md` is not ambiguous about which it wants — the produced clips are "played via Web
 * Audio", decoded with `decodeAudioData` — so such a build is failing a real requirement. It is
 * just failing a different one from the one the bare number implies, and the verdict should say
 * which. A count of zero across a whole item (the arming gesture included, which starts the music
 * bed on any unmuted build) is the signature.
 */
export function audioCueLabel(what, count) {
  if (count > 0) return `${what} (Web Audio sources started)`;
  return (
    `${what} — and this build started NO Web Audio source at any point in this item, so it is ` +
    `not playing its produced .wav files the way \`specs/assets.md\` requires (decoded with ` +
    `\`decodeAudioData\` and played through the Web Audio API). Sound played another way (an ` +
    `<audio> element, say) is audible but invisible to this probe`
  );
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

// ---- Reading what a status-bar control actually DREW ---------------------------
//
// Some claims are about the HUD changing, not about a snapshot field changing — the mute control
// showing that audio is muted, say (`specs/ui.md`). A snapshot read cannot see that: a build can
// flip `muted` correctly and draw nothing at all, which is exactly what one run implementation
// does. So the control itself is sampled.
//
// WHY THIS SAMPLES A REPORTED RECTANGLE RATHER THAN SWEEPING THE BAR. The first version of this
// swept the whole 1280x56 band on a grid, because no spec pins where within the bar a build draws
// any one control. That could not be made both cheap and sound: a mute indicator is a GLYPH, and
// measured at 2 px across eight rows, toggling mute moved 8 of 5120 samples on one build (x
// 1242..1248) and 8 on another (x 1206..1226). A grid coarse enough to be affordable swept
// straight past both — reporting "nothing changed" for two builds that draw the indicator
// correctly, and passing only because the one build that draws nothing also reported nothing.
//
// `statusControls()` (`specs/instrumentation.md`) closes that gap: the build reports the control's
// own rectangle, so the sweep is a few dozen pixels rather than seventy thousand, and can be dense
// enough to be conclusive.

// How finely a reported control's rectangle is sampled, in logical px. A glyph stroke is ~2 px, so
// stepping by 2 cannot fall between the strokes of one.
const CONTROL_STEP = 2;

/** Find one status-bar control by `action`, or null if the build reports none. */
export async function statusControl(api, action) {
  const controls = (await api.call("statusControls")) ?? [];
  return controls.find((c) => c && c.action === action) ?? null;
}

/**
 * Sample everything a reported status-bar control DREW, and return a signature of it for comparing
 * one rendered state against another. `api.pixel` takes NORMALIZED coordinates over the largest
 * canvas, so the control's logical rectangle is mapped onto them.
 */
export async function controlSignature(api, control) {
  const sig = [];
  if (!control) return sig;
  for (let y = control.y; y < control.y + control.h; y += CONTROL_STEP) {
    for (let x = control.x; x < control.x + control.w; x += CONTROL_STEP) {
      const p = await api.pixel(x / STAGE_W, y / STAGE_H);
      sig.push(`${p.r},${p.g},${p.b}`);
    }
  }
  return sig;
}

/** How many samples differ between two control signatures. */
export function signatureDiff(a, b) {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) n += 1;
  return n;
}
