// Case-specific helpers for Meltdown's automated-validation items.
//
// Every helper here drives the real, deterministic simulation through
// window.__meltdown (see specs/instrumentation.md): control ops only set up
// PRECONDITIONS (start a game, pose money/heat, build towers, spawn surge), then
// time runs the real firing, heat, cooling, conduction, pathing, movement, and
// scoring forward and `snapshot`/`pixel` read the outcome back. Nothing here
// fabricates a result. These helpers factor out the "arrange, run the real sim,
// read what happened" patterns and the floor geometry the scripts depend on
// (mirrored from specs/playfield.md and the canonical constants).
//
// The helpers are split along the runtime's arrange/act seam (see
// `packages/browser-driver/validation.mjs`). An item runs TWICE — once with time
// instant to decide the verdict, once in real time to record the media — and the
// runtime enforces the split by throwing if `arrange` consumes time:
//
//   * `arrangeX(api, ...)` — control ops and instant reads only. Callable from
//     `arrange`, runs in BOTH passes, so the record pass reaches `act` in exactly
//     the state the check saw.
//   * `actX(api, ...)` — consumes time via `api.advance` / `api.until` and returns
//     the outcome the assertions read. Callable from `act`, and the only part
//     filmed.
//
// A helper that only poses state or reads it instantly (`newGame`, `restartGame`,
// `build`, `spawn`, `tower`, `unit`, `heatOf`, `press`, `combatSetup`,
// `buildGateWall`, `buildGate`, `gateSetup`) is unpaired: it is
// arrange-callable on its own, and the instant READS are callable from any phase.
// `restartGame` is additionally act-safe — see its note, as are the gate builders,
// which place towers and nothing else.
//
// UNITS ARE TICKS. Meltdown is a 60 Hz fixed timestep and the debug API's `step`
// takes whole ticks, so every duration below is a tick count (the runtime converts
// to wall-clock for the record pass). The seconds these replace are noted inline.
// The exception is anything the GAME measures in seconds — `setBuildTimer`, a
// snapshot's `buildTimer`/`tripTimer`/`simTime` — which are game-facing quantities
// and stay in seconds.
//
// The assertion primitives are NOT here — they are the reporter-side `ttc` kit
// (packages/browser-driver/ttc.mjs), the single source of truth shared by every
// case. This file holds only what is specific to Meltdown.

// ---- Floor + grid geometry (specs/playfield.md, constants.ts) ----------------
export const STAGE_W = 1280;
export const STAGE_H = 720;
export const TILE = 19;
export const FLOOR_X0 = 18;
export const FLOOR_Y0 = 18;
export const COLS = 50;
export const ROWS = 36;
export const FLOOR_X1 = FLOOR_X0 + COLS * TILE; // 968 — right floor edge
export const FLOOR_Y1 = FLOOR_Y0 + ROWS * TILE; // 702 — bottom floor edge
export const REDLINE = 100; // the universal trip threshold (constants.REDLINE)

// The simulation rate, and the finest granularity a sweep can poll at. One tick is
// one fixed simulation step (this replaces the old `FIXED = 1/60` seconds constant);
// pass `poll: TICK` to `api.until` when the exact instant of an event matters.
export const TICK_HZ = 60;
export const TICK = 1;

/**
 * Seconds expressed as an exact whole number of 60 Hz ticks, for the handful of
 * durations a script states in the game's own units (a trip cooldown, a build
 * timer) and then has to advance past. Throws rather than rounding, matching the
 * debug API's own refusal to guess at a fractional step count — if a duration is
 * not a whole number of ticks, the script must decide deliberately what it meant.
 */
export function ticks(seconds) {
  const n = seconds * TICK_HZ;
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `ticks(${seconds}): not a whole non-negative number of ${TICK_HZ} Hz ticks`,
    );
  }
  return n;
}

// The four casing openings, as their floor-edge tile rows/cols.
export const LEFT_VENT_ROWS = [16, 17, 18, 19];
export const TOP_VENT_COLS = [22, 23, 24, 25, 26, 27, 28, 29];

// The eight shop tower types: the six emitters of `specs/towers.md` plus the Forge
// and Sink.
//
// A SET, deliberately not a shop layout. `specs/controls.md` ties the number keys to
// "the eight tower types in shop order (top to bottom, left to right)", but the shop's
// order is the build's own presentation choice — `specs/ui.md` asks for "a grid of
// buyable towers, one button per type" without fixing their sequence, and the debug API
// exposes no way to read the layout back (there is no shop listing in `snapshot()`, and
// `hoverShop` sets a hover rather than enumerating). So no automated check can know
// which type sits in slot 4, and any hardcoded order here would fail conformant builds
// that chose a different one. What IS checkable is that the eight digits arm these
// eight types, one apiece; the positional claim belongs to `controls.arm-hotkeys`'s
// clip and human review.
export const TOWER_TYPES = [
  "arc",
  "stutter",
  "rime",
  "flak",
  "bloom",
  "lance",
  "forge",
  "sink",
];

// The tower footprint size (in tiles) per type, from specs/towers.md.
export const TOWER_SIZE = {
  arc: 2,
  stutter: 2,
  lance: 4,
  bloom: 3,
  rime: 2,
  flak: 2,
  forge: 2,
  sink: 2,
};

// A tower footprint's center in logical pixels (matches Tower.cx/cy).
export function fpCenter(col, row, size) {
  return {
    x: FLOOR_X0 + (col + size / 2) * TILE,
    y: FLOOR_Y0 + (row + size / 2) * TILE,
  };
}

// A tile center in logical pixels (specs/instrumentation.md).
export function tileCenter(col, row) {
  return {
    x: FLOOR_X0 + col * TILE + TILE / 2,
    y: FLOOR_Y0 + row * TILE + TILE / 2,
  };
}

// ---- State-only helpers (arrange) ------------------------------------------
//
// These pose the world with control ops and consume no time, so they are callable
// straight from `arrange` and need no act half.

/**
 * A fresh match on the untimed opening build phase, with money posed if given.
 *
 * ARRANGE ONLY — it calls `api.reset()`, which the runtime refuses from `act`
 * (reset hands the build back to its manual clock and would freeze the recording).
 * A script that needs a SECOND scenario partway through its drive wants
 * `restartGame` below.
 */
export async function newGame(
  api,
  mode = "containment",
  difficulty = "medium",
  money,
) {
  await api.reset();
  await api.call("startGame", mode, difficulty);
  if (money !== undefined) await api.call("setMoney", money);
  return api.snapshot();
}

/**
 * The same fresh match, WITHOUT the `reset()` — act-safe.
 *
 * This is what an A/B script uses to pose its second configuration mid-drive. The
 * comparison checks (cooling by rotation, Sink vs no Sink, Forge setpoint by level,
 * conduction, upgrade scaling) each run one layout forward, read it, then build the
 * other layout and run that forward, so their second setup lands in `act` — where
 * `reset()` throws. `startGame` alone is a complete re-pose: it rebuilds the match
 * from scratch (clearing towers, surge, money, lives, and the wave) through the same
 * real start path, and unlike `reset` it never touches the clock, so the recording
 * keeps running across the switch.
 *
 * Only the seed differs: `reset({ seed })` is the sole way to reseed. Meltdown's
 * base variant uses no randomness, so nothing here depends on that.
 */
export async function restartGame(
  api,
  mode = "containment",
  difficulty = "medium",
  money,
) {
  await api.call("startGame", mode, difficulty);
  if (money !== undefined) await api.call("setMoney", money);
  return api.snapshot();
}

// `stepUntil` is gone: the runtime's own `api.until(pred, { max, poll })` does the
// same sweep in both passes and returns `{ snap, hit, spent }`. Convert its two
// seconds arguments to ticks — a 10s cap is `max: 600`, the old default `FIXED`
// chunk is `poll: TICK`, an 0.1s chunk is `poll: 6`, an 0.2s chunk is `poll: 12`.

// ---- The clip tail (act) ---------------------------------------------------

/**
 * The beat an `act` runs on for AFTER the instant its verdict was decided, so the
 * clip shows the thing happening rather than stopping on the frame before it.
 *
 * `api.until` returns on the first sample where its predicate holds, and `act`
 * returning ends the record pass — Playwright finalizes the video when the context
 * closes, so the last frame filmed is the one at the predicate's edge. For a check
 * whose subject is an EVENT that is what a reviewer least wants to see: the sweep
 * that waits for `hp < maxHp` cuts on the tick the shot connects, so the clip is a
 * flyer approaching and then nothing. The verdict was right and the evidence shows
 * everything except the moment it is evidence of.
 *
 * So an item that decides on an event runs on afterwards. It costs the verdict
 * nothing — the validate pass advances instantly and has already read its outcome
 * before the tail runs — and in the record pass it is exactly the follow-through:
 * the impact lands, the number moves, the life is deducted, on screen, at the speed
 * the game actually runs.
 *
 * 90 ticks (1.5 s) is the default because it is about the shortest beat that still
 * reads as a beat at 60 Hz: long enough for a hit to resolve and a HUD number to be
 * legible after it moves, short enough that adding one to every event item costs a
 * suite run a few seconds. Pass more where what follows the event is itself the
 * point — a payout landing after a wave clears, a countdown handing over to the next
 * wave. The tail spends the same `clipMs` budget as everything else in `act`, so if a
 * long approach is crowding it out, the fix is to skip the approach (see
 * `skipToApproach` below) rather than to raise the budget.
 *
 * This is deliberately `advance` and not `settle`: the game should keep MOVING
 * through the tail. `settle` is a paint pause that consumes no simulation time, and
 * a tail made of it would film a frozen world in the validate pass and a stalled one
 * in the record pass.
 *
 * WHERE IT GOES. A tail runs the real simulation, so it belongs AFTER the reads that
 * decide the verdict and never between a pose and a read that depends on it. The
 * distinction is easy to lose because most scenarios pose their state with control
 * ops, which consume no time and therefore hold still; slip a tail into the middle of
 * one and the world moves out from under it. `sealing.no-trap` is the cautionary
 * case: its pocket is framed with one side left open, so a beat inserted between the
 * frame going up and the placement being tried is long enough for the unit inside to
 * walk out — after which closing that side traps nobody and is correctly allowed, and
 * a conformant build fails an item it should pass. When in doubt, put the tail last.
 */
export const TAIL = 90;

/** Run the sim on for a beat so the clip shows the outcome. See {@link TAIL}. */
export async function actTail(api, ticks = TAIL) {
  await api.advance(ticks);
}

// ---- Clip budgets ----------------------------------------------------------
//
// WHY SO MANY ITEMS CARRY A `clipMs` EVEN THOUGH THEY ARE SHORT.
//
// A budget is a CEILING on filming, not a target, and the reason to set one is not
// the reference implementation — it is every other implementation. How long a
// scenario takes to play out is the build's own business: unit speeds, spawn spacing,
// and above all its pathing. A build that routes a left-vent unit up over the top of
// the reactor and back down covers three times the distance for the same leak, and
// every surge, economy and refund item that waits on that unit films three times as
// long. The verdict is unaffected — those items check WHAT happened, not how long it
// took, and a slow route is a pathing item's business, not theirs — but the clip
// balloons, and a reviewer is handed a minute of wandering to see a two-second event.
//
// So each item sized its budget a little above what the scenario costs on a
// conformant build. Past that it is padding out a defect that some other item owns,
// and cutting there loses nothing a reviewer needed. The numbers below are per-item
// (a Core crossing is not a Mote crossing) and each is stated at its use site with
// what it covers.

// A BUDGET IS NOT A STOPWATCH. `clipMs` is spent in SIMULATION time — `advance(n)`
// and each `until` poll bill `n / tickHz` seconds against it — while the clip is
// however long the record pass actually takes, and those two are not the same number.
// Every poll also costs a snapshot round trip that the budget does not bill, so an
// item polling one tick at a time burns 16.7 ms of budget per iteration while
// consuming nearer 30 ms of wall clock, and its clip runs close to twice its budget.
// A coarsely-polled item lands much nearer 1:1.
//
// So size a cap against what the item POLLS, not against the seconds you want to see:
// halve it for a `poll: TICK` sweep, take it at face value for a `poll: 12` one. And
// expect the cap to bite only on a pathological build — on a conformant one these
// items finish well inside their budget, which is why the reference clips are shorter
// than the numbers here suggest.

/**
 * The headroom a clip budget carries over the length the same scenario films on a
 * conformant build: enough that ordinary variation between builds never clips a
 * payoff, small enough that a pathological one is cut off rather than indulged.
 */
export const CLIP_HEADROOM_MS = 1500;

// ---- Getting to the brink (arrange) ----------------------------------------
//
// The counterpart to the tail. Meltdown's floor is 950 logical pixels across and its
// units walk it at 30-120 px/s, so almost every surge check spends the better part of
// half a minute watching something cross a reactor before the moment it is about can
// happen at all. `api.skip`/`api.skipUntil` run that approach through the real
// simulation without filming it (see `packages/browser-driver/validation.mjs`), so an
// item can pose its world, close the distance, and hand `act` a scenario that is
// already at the brink. The clip then opens seconds from the payoff instead of a
// minute before it, and the verdict is unaffected — the validate pass was always
// instant.

/**
 * How close to its exhaust a unit has to be to count as on final approach.
 *
 * 120 px is a little over six tiles: about two seconds of filmed walking for a Mote,
 * four for a Core. Enough that a reviewer sees the unit arrive under its own power
 * rather than materialising on the edge, and short enough that the arrival is the
 * clip rather than the epilogue of one.
 */
export const APPROACH_PX = 120;

/**
 * Whether `u` is on final approach to the exhaust it was assigned. A unit's exhaust is
 * fixed at spawn (`specs/playfield.md`), and the two lie on different axes, so which
 * coordinate to measure comes from the unit itself rather than from its vent.
 */
export function nearlyOut(u) {
  return u.exhaust === "right"
    ? u.x >= FLOOR_X1 - APPROACH_PX
    : u.y >= FLOOR_Y1 - APPROACH_PX;
}

/**
 * Run the real simulation, unfilmed, until the unit with `id` is on final approach to
 * its exhaust (or has already left the floor). Returns `api.skipUntil`'s result.
 *
 * 3600 ticks is a 60 s ceiling: comfortably more than the ~32 s a Core — the slowest
 * unit in the game — needs to cross the floor end to end, so no conformant build runs
 * out of runway. Polled every 12 ticks because nothing here needs the exact instant;
 * the sweep only has to stop somewhere on the approach.
 */
export async function skipToApproach(api, id, { max = 3600 } = {}) {
  return api.skipUntil(
    (s) => {
      const u = s.surge.find((x) => x.id === id);
      return !u || nearlyOut(u);
    },
    { max, poll: 12 },
  );
}

// ---- Instant reads (any phase) ---------------------------------------------
//
// Pure `snapshot` reads. They consume no time, so they are callable from `arrange`,
// `act`, and `assert` alike.

export async function tower(api, id) {
  return (await api.snapshot()).towers.find((t) => t.id === id) ?? null;
}
export async function unit(api, id) {
  return (await api.snapshot()).surge.find((u) => u.id === id) ?? null;
}
export async function heatOf(api, id) {
  const t = await tower(api, id);
  return t ? t.heat : NaN;
}

/**
 * Where `build` parks the held preview after a place — the top-left tile of a
 * footprint in the far bottom-right of the floor, clear of every scenario any item
 * lays out (nothing here builds past column 40 / row 34, and the columns the maze
 * and sealing walls occupy are 20-26).
 */
export const PARK_COL = 46;
export const PARK_ROW = 33;

/**
 * Build a tower through the real placement code and return the placed tower's id
 * (the newest tower whose footprint top-left and type match), or null if the
 * placement was refused. Routes through canPlaceAt, so an invalid placement builds
 * nothing and returns null.
 *
 * The held placement is MOVED OFF the scenario afterward. Placement legitimately
 * stays armed after a place (`specs/controls.md`, and `building.place-stays-armed` is
 * the item that checks it), but the preview then sits on the footprint just built —
 * which is now occupied, so the preview is INVALID and the build paints the
 * invalid-footprint highlight (`#ff4d4d`, `specs/controls.md`) over it. Any check that
 * samples the rendered tower afterward would read that overlay instead of the tower's
 * own body: a correct cold emitter (`#3a7bd5`) reads warm-red through it.
 *
 * Parked with `movePreview`, NOT cancelled with an Esc keypress, because this runs in
 * nearly every item's arrange and so must not depend on anything but the placement
 * ops it is already using. Esc is a THREE-WAY binding — cancel the placement, else
 * deselect, else pause (`specs/controls.md`) — so what it does here depends on the
 * build having left a placement armed and on its having bound the key in that order.
 * Get either wrong and Esc pauses the game instead, in `arrange`, silently: every
 * `advance` afterwards is then a no-op, and heat, cooling, targeting, economy and
 * audio items all report a frozen world as if their subject were broken. Those are
 * separate items with their own verdicts (`controls.cancel-placement` and
 * `building.place-stays-armed` are where an Esc or arming defect belongs), and laying
 * out a floor must not be able to fail them. `movePreview` means one thing, and is a
 * harmless no-op on a build holding nothing.
 *
 * A check whose subject IS the armed state drives `armTower`/`movePreview`/`place`
 * directly instead.
 */
export async function build(api, type, col, row, rot = 0) {
  await api.call("placeTower", type, col, row, rot);
  const matches = (await api.snapshot()).towers.filter(
    (t) => t.type === type && t.col === col && t.row === row,
  );
  if (matches.length === 0) return null;
  // Park the preview off the scenario instead of cancelling it. Consumes no time,
  // so this stays arrange-callable. See PARK_COL/PARK_ROW.
  await api.call("movePreview", PARK_COL, PARK_ROW);
  return matches.reduce((a, b) => (b.id > a.id ? b : a)).id;
}

export async function spawn(api, type, vent = "left") {
  return api.call("spawnUnit", type, vent);
}

// ---- Input (through the real key handling) ---------------------------------
export async function press(api, code) {
  await api.call("press", code);
}

// `liveClip` is gone. It existed only to re-pose a scenario and film it in real
// time after the verdict had already been measured with exact steps. `act` IS the
// clip now: the runtime replays the same `act` in real time for the record pass, so
// an item films exactly the drive that decided its verdict. Delete every
// `liveClip(api, ms)` call rather than translating it — the timed work belongs in
// `act`.

// ---- Running on the build's own clock (the audio items) ---------------------
//
// `setAutoStep` is the runtime's to call, with ONE exception, and this is it.
//
// Everywhere else an item advances the simulation with `advance`/`until`/`skip`, which
// bottom out in the debug API's `step`. `specs/instrumentation.md` says exactly what that
// advances: "firing, heat, cooling, conduction, movers, surge movement, pathing, and the
// build-phase and wave timers". That list is the SIMULATION, and audio is not on it — nor
// should it be, because `specs/gameplay.md` requires the sim be "decoupled from rendering"
// with "rendering only read[ing] the state, so the core makes progress without a canvas or
// the wall clock". A cue is played through the Web Audio API by a presentation layer
// reading events the sim emitted; it sits on the same side of that line as the canvas.
//
// So a build is free to raise its cues from its frame loop and not from inside `step`, and
// one that does is following the architecture the spec asks for rather than cutting a
// corner. Driving such a build with `step` and then asking what it played is asking the
// wrong half of it: the sim ran, the presentation layer never did, and the audio log is
// empty for a game whose cues work perfectly for a player. That failed a conformant build
// on all six of its differenced cue items.
//
// The reference happens to drain its cues inside `step`, which is why these items ever
// worked. That is one valid choice, and the items had quietly encoded it as though it were
// the requirement.
//
// The fix is to measure the cue where a player hears it: hand the clock to the build for
// the window being counted, and let its own frame loop run the simulation and play the
// sound. What that costs is exactness — a window is then "however many ticks fit in this
// many milliseconds" rather than an exact tick count — so an item that needs its windows to
// hold the same EVENTS polls on state (`damageDealt`, `tripped`, `lives`) rather than on
// time. What it costs in wall clock is bounded by keeping the approach on `skip`, which
// stays instant and unfilmed; only the measured window runs in real time.
//
// The clock is deliberately LEFT with the build afterwards. That reads like a leak and is
// not one: in the validate pass the next `advance`/`skip` calls `step`, which the debug
// contract has switch back to manual on its own, and in the record pass the clip needs the
// game running anyway. Restoring it by hand would need to know which pass is running, which
// an item cannot ask and should not care about.

/**
 * Hand the clock to the build, so its own frame loop drives the simulation — and then let
 * the handover settle before anything is measured.
 *
 * THE FIRST FRAME AFTER THE HANDOVER IS NOT A NORMAL FRAME. The simulation has been on the
 * manual clock for the whole of `arrange`, which is many round trips of wall clock, so the
 * build's loop comes back to a large elapsed delta and catches up in one go — ordinary
 * accumulator behaviour, and every build here clamps it, but the clamp is generous. On one
 * of them that first frame ran a full second of firing at once, which took a pair of cold
 * Stutters from 0 heat to 98: over the redline on the very poll a window opened on, leaving
 * the rest of it silent by design and the item blaming the cue for it.
 *
 * So the burst is spent here, before the caller's first reading. `settleMs` is a beat of
 * real time for the build to work through whatever it accumulated; a caller that also poses
 * state (heat, say) should do it AFTER this returns, so the catch-up cannot undo the pose.
 */
export async function giveClockToBuild(api, { settleMs = 250 } = {}) {
  await api.call("setAutoStep", true);
  await api.settle(settleMs);
}

/**
 * Run the build's own frame loop until `predicate(snapshot)` holds, or `maxMs` of real time
 * has passed. The counterpart to `api.until` for a window that has to be driven by the
 * build rather than stepped — pair it with {@link giveClockToBuild}.
 *
 * Returns `{ snap, hit, spentMs }`. `stepMs` is how long to let the build run between
 * reads: 80 ms is about five frames at 60 Hz, fine enough to stop within a few frames of
 * an event and coarse enough that the round trips do not dominate the window.
 */
export async function untilOnOwnClock(
  api,
  predicate,
  { maxMs = 4000, stepMs = 80 } = {},
) {
  let snap = await api.snapshot();
  if (predicate(snap)) return { snap, hit: true, spentMs: 0 };
  for (let spent = 0; spent < maxMs; spent += stepMs) {
    await api.settle(stepMs);
    snap = await api.snapshot();
    if (predicate(snap)) return { snap, hit: true, spentMs: spent + stepMs };
  }
  return { snap, hit: false, spentMs: maxMs };
}

// ---- Pixel / color sampling (reads the rendered canvas) --------------------
//
// Color checks read the pixels the build actually PAINTS, through api.pixel(u, v)
// (u, v are fractions across the largest canvas). A logical stage coordinate maps
// to a fraction by dividing by the stage size, so a script never needs the canvas's
// device dimensions. Reading the rendered pixel (not a value the game reports)
// means a build cannot pass by claiming a color it does not draw.
export function uv(x, y) {
  return [x / STAGE_W, y / STAGE_H];
}
export async function pixelAt(api, x, y) {
  const [u, v] = uv(x, y);
  return api.pixel(u, v);
}

export function colorDist(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * Bare-floor tile centers, used as the reference for "this pixel is the floor, not
 * the tower". Sampled from THIS build rather than assumed, so the comparison is
 * against the build's own floor color and never an absolute brightness (a build is
 * free to paint a lighter or darker floor than the reference's `#15181d`).
 *
 * A clear patch in the floor's upper right: no item builds past column 40 or above
 * row 2 there, it is well clear of the parked preview (PARK_COL/PARK_ROW) and of the
 * top vent (columns 22-29), and tile CENTERS dodge the faint tile-grid lines.
 */
const FLOOR_PROBE_TILES = [
  [42, 3],
  [44, 6],
  [46, 9],
];

/**
 * How far a sampled pixel must sit from the build's own floor color to count as
 * painted by the tower. Small — it only has to clear the floor's own tile-grid
 * contrast — because what it separates is "floor" from "anything the tower drew",
 * not dark from bright.
 */
const FLOOR_TOLERANCE = 24;

/** The build's own floor color, per {@link FLOOR_PROBE_TILES}. */
export async function sampleFloor(api) {
  const seen = [];
  for (const [col, row] of FLOOR_PROBE_TILES) {
    const c = tileCenter(col, row);
    seen.push(await pixelAt(api, c.x, c.y));
  }
  return {
    r: median(seen.map((p) => p.r)),
    g: median(seen.map((p) => p.g)),
    b: median(seen.map((p) => p.b)),
  };
}

/**
 * How far a pixel must move between the two posed states to count as part of what
 * the build repaints to express the change. Comfortably above frame-to-frame
 * antialiasing jitter and far below any real color step on the heat ramp.
 */
const CHANGE_TOLERANCE = 24;

// The sample grid over a tower footprint. The bottom strip is left out because the
// on-footprint heat read lives there (`specs/heat.md`): a separate readout with its
// own unfilled track and redline marker, so its pixels are not the tower's glow.
const GRID_N = 8; // 8x8 = 64 points, dense enough to land on a border-drawn glow
const GRID_INSET = 3; // clear of the footprint's outer edge and its antialiasing
const HEAT_BAR_STRIP = 12;

/**
 * Read every point of the sample grid over a tower's footprint, plus the build's own
 * floor color. The raw material for {@link glowBetween}; on its own it decides
 * nothing.
 *
 * Returns `{ floor, points: [{ r, g, b }] }` in a fixed grid order (so two samples of
 * the same tower are point-for-point comparable), or null if the tower is gone.
 */
async function sampleTowerGrid(api, t) {
  const s = t.size * TILE;
  const x0 = FLOOR_X0 + t.col * TILE;
  const y0 = FLOOR_Y0 + t.row * TILE;
  const floor = await sampleFloor(api);
  const points = [];
  for (let i = 0; i < GRID_N; i += 1) {
    for (let j = 0; j < GRID_N; j += 1) {
      const x = x0 + GRID_INSET + ((s - 2 * GRID_INSET) * i) / (GRID_N - 1);
      const y =
        y0 +
        GRID_INSET +
        ((s - GRID_INSET - HEAT_BAR_STRIP) * j) / (GRID_N - 1);
      points.push(await pixelAt(api, x, y));
    }
  }
  return { floor, points };
}

/**
 * ACT-phase read of a tower's painted footprint: let a frame land, then sample the
 * whole grid. Pair two of these with {@link glowBetween}.
 *
 * The settle is a REAL pause in both passes, not `advance`. These checks read the
 * pixels the build actually painted, which needs a frame to have been drawn since
 * the heat/trip state was posed — and in the validate pass `advance` is instant, so
 * it produces no frame at all. See `api.settle` in validation.mjs.
 *
 * The settle is generous because it is the ONLY lever a pixel check has against the
 * renderer. `getImageData` happily returns the last frame that was painted, so a
 * settle that comes up short does not fail loudly — it silently reads the canvas as it
 * was BEFORE the state this check posed, and reports a confident wrong color. At 90 ms
 * that raced often enough to flake roughly one full-suite run in two; the only two
 * items that sample pixels are this one's callers, so the wider margin costs a fraction
 * of a second across the whole suite.
 *
 * Returns the sample, or null if the tower is gone.
 */
export async function actSampleTower(api, id, { settleMs = 300 } = {}) {
  await api.settle(settleMs);
  const t = await tower(api, id);
  return t ? sampleTowerGrid(api, t) : null;
}

/**
 * Given two samples of the same tower posed differently — cold and hot, or online
 * and tripped — report the color its GLOW read in each, as `{ before, after }`.
 *
 * Finding the glow by asking what MOVED is the whole point. Where in a footprint the
 * heat color is painted is the build's own presentation choice: `specs/overview.md`
 * asks only that "an emitter's glow color tracks its heat along the ramp" and that a
 * tripped one is unmistakable, never that the body is a solid fill. The obvious
 * implementations both encode a guess about the rendering and both get it wrong on
 * some conformant build:
 *
 *   * One interior point offset from the center bets the body is filled solid. A
 *     build that draws the tower as a lit frame around a dark interior — an ordinary
 *     industrial look — paints the entire ramp on its border, and the center read
 *     returns the same dead color at every heat, failing a build that renders the
 *     ramp perfectly.
 *   * Summarizing the whole footprint instead bets the glow is most of what the
 *     footprint paints. It is not, on that same framed build, once the interior is
 *     lit rather than black: the majority color is then an inert fill that never
 *     tracks heat, and the reading is flat again.
 *
 * The pixels that carry the ramp, however they are arranged, are exactly the ones
 * that differ between the two states — so mask to those and let the build place its
 * glow wherever it likes. Two guards keep the mask honest: a point must also read as
 * something other than the build's own floor (sampled, never an absolute brightness,
 * so a lighter or darker floor than the reference's is fine), and the summary is a
 * MEDIAN, so minority features that happen to shift — the cyan radiator fins, a
 * center glyph, a lit highlight — cannot drag the reading the way a mean would.
 *
 * Returns null when NOTHING in the footprint moved between the two states, which is
 * not a measurement failure but the finding itself: a tower that paints the same
 * whether it is cold or white-hot, or online or tripped, communicates nothing. The
 * caller asserts on that rather than reporting a color.
 */
export function glowBetween(before, after) {
  if (!before || !after) return null;
  const moved = [];
  for (let i = 0; i < before.points.length; i += 1) {
    const a = before.points[i];
    const b = after.points[i];
    if (colorDist(a, b) <= CHANGE_TOLERANCE) continue;
    const aIsFloor = colorDist(a, before.floor) <= FLOOR_TOLERANCE;
    const bIsFloor = colorDist(b, after.floor) <= FLOOR_TOLERANCE;
    if (aIsFloor && bIsFloor) continue;
    moved.push([a, b]);
  }
  if (moved.length === 0) return null;
  const summarize = (pick) => ({
    r: median(moved.map((m) => pick(m).r)),
    g: median(moved.map((m) => pick(m).g)),
    b: median(moved.map((m) => pick(m).b)),
  });
  return { before: summarize((m) => m[0]), after: summarize((m) => m[1]) };
}

// ---- Trip scenarios --------------------------------------------------------
//
// The trip checks all pose an emitter near its redline, give it a real target, and
// let the REAL firing/heat systems carry it over 100 — the trip is the game's own,
// never posed. `arrangeNearRedline` is the shared arrange half; the act halves below
// run the real sim to the trip (and, for the cooldown check, back out of it).

/**
 * ARRANGE half of a trip scenario: build `type` where a Core walking from the left
 * vent will come into its range, spawn that Core, and pose the emitter's heat just
 * under the redline so a few steps of real firing carry it over. Lives are posed high
 * so a leak during the drive cannot end the run out from under the check.
 *
 * `gate: true` stands the emitter at the gate (see `buildGate`) instead of parking it
 * at `col,row` beside the lane a build may or may not walk, and makes `walls` part of
 * the result for the item to assert on. An item whose subject is the trip itself wants
 * that: engagement stops being a coincidence of the build's pathfinding. `col`/`row`
 * are ignored when it is set — the gate fixes the spot.
 *
 * Pair with `actUntilTripped` / `actTripAndRecover`. Returns `{ id, coreId }`, plus
 * `walls` in the gate form.
 */
export async function arrangeNearRedline(
  api,
  type,
  { heat = 92, col = 3, row = 20, rot = 0, gate = false } = {},
) {
  await api.call("setLives", 100000);
  const c = gate
    ? await gateSetup(api, type, rot)
    : await combatSetup(api, type, col, row, rot);
  await api.call("setHeat", c.id, heat);
  return c;
}

/**
 * ACT half of a trip scenario: run the real sim until the emitter trips, and return
 * the tower's state at that instant. Polls one tick at a time — the exact step the
 * redline is crossed on is what the check reads.
 *
 * Pair with `arrangeNearRedline`. Returns `{ hit, snap, t }` where `t` is the
 * tripped tower (or null).
 */
export async function actUntilTripped(
  api,
  id,
  { max = 360, poll = TICK } = {},
) {
  // 360 ticks = the old 6s cap.
  const r = await api.until(
    (s) => s.towers.some((t) => t.id === id && t.tripped),
    { max, poll },
  );
  return {
    hit: r.hit,
    snap: r.snap,
    t: r.snap.towers.find((t) => t.id === id) ?? null,
  };
}

/**
 * ACT half of the trip-cooldown scenario: run the real sim to the trip, then keep
 * running until the emitter comes back online, and report the trip, the LAST sample
 * in which it was still offline, and the first in which it is back.
 *
 * `lastTripped` is what carries the "returns cold" claim, and it is reported
 * separately because it is the only reading of the cooldown that nothing else can
 * touch. `specs/heat.md` has a tripped tower's "heat bleed[] off to 0 over the
 * cooldown", and while it is tripped it "stops firing and deals no damage" — so at
 * the far end of the cooldown, heat is the cooldown's own work and cannot be anything
 * else.
 *
 * The reading at the moment it comes back cannot say the same. The sim is a 60 Hz
 * fixed step and `back` is the first STEP on which the tower is online, not an
 * instant inside it: if the build resolves the cooldown before it resolves firing,
 * the tower comes back cold, acquires the target that was still in range, and takes
 * one shot's self-heat — all within the step the sweep reads. Both reference builds
 * bear this out, one landing on 0 and the other on a single shot's worth, from the
 * same posed scenario. Which side of a step two systems fall on is not something
 * `specs/heat.md` fixes, so `back.t.heat` cannot be asserted as 0 without failing a
 * conformant build for its update order. Read `back` for the ONLINE flag, and read
 * `lastTripped` for the heat.
 *
 * Pair with `arrangeNearRedline`. Returns `{ tripped, lastTripped, back }`, where
 * `tripped` and `back` are the shape `actUntilTripped` returns and `lastTripped` is
 * the tower as last seen offline (or null if it never was).
 */
export async function actTripAndRecover(
  api,
  id,
  { tripMax = 360, backMax = 420 } = {},
) {
  // 360 ticks = the old 6s trip cap; 420 ticks = the old 7s recovery cap.
  const tripped = await actUntilTripped(api, id, { max: tripMax });
  let lastTripped = tripped.t && tripped.t.tripped ? tripped.t : null;
  const r = await api.until(
    (s) => {
      const t = s.towers.find((x) => x.id === id);
      if (t && t.tripped) lastTripped = t;
      return Boolean(t && !t.tripped);
    },
    {
      max: backMax,
      poll: TICK,
    },
  );
  return {
    tripped,
    lastTripped,
    back: {
      hit: r.hit,
      snap: r.snap,
      t: r.snap.towers.find((t) => t.id === id) ?? null,
    },
  };
}

// ---- Combat scenario helpers ----------------------------------------------
//
// A standard "sustained target" layout: an emitter placed just BELOW the left
// vent lane (rows 16..19) so it does not block the lane, with a slow, tanky Core
// spawned at the left vent walking straight through its range. `setHeat` is used as
// a documented precondition to reproduce a thermal starting point; the real firing
// / heat / trip systems act on it from the next step, so the outcome a check reads
// (a trip, a kill, a slow) is still the game's own.

/**
 * Place `type` at (col,row) below the left lane and spawn a Core walking through
 * its range so the emitter has a real target to fire at. Returns { id, coreId }.
 *
 * The default (col, row) sits below the lane and a few tiles in, which reaches a unit
 * that crosses the floor along the rows it entered on. That is a route the spec
 * permits but does not require — see the gate below for the placement an item should
 * use when it needs the emitter to engage WHATEVER route the build takes.
 */
export async function combatSetup(api, type, col = 3, row = 20, rot = 0) {
  const id = await build(api, type, col, row, rot);
  const coreId = await spawn(api, "core", "left");
  return { id, coreId };
}

// ---- The gate: engaging a left-vent unit on ANY route -----------------------
//
// WHY A SCENARIO CANNOT ASSUME THE SURGE CROSSES ON THE ROWS IT ENTERED ON.
//
// Nearly every item here that needs an emitter to fire poses one target: a unit at the
// left vent, walking to the right exhaust. Where to put the emitter so it engages that
// unit looks like it has an obvious answer — beside the lane the unit walks — and it
// does not, because the lane is not the spec's to give. `specs/playfield.md` pins the
// two ENDS of the journey (the surge appears on tiles `(0, 16)`..`(0, 19)` and leaves
// through the right exhaust on rows 16..19) and then says only that the surge "walks
// the shortest available route" between them, where a diagonal step costs the same as
// an orthogonal one.
//
// On an empty floor that leaves a wide family of equally shortest routes, and the
// straight one across the entry rows is merely the one a reference happens to pick. A
// build whose pathfinder expands its neighbours in a different order climbs to the top
// of the floor, runs along the ceiling and comes back down for exactly the same step
// count, and is walking a shortest route the whole way. Which of those a build takes is
// a real property worth checking — `pathing.opposite-left` and `pathing.opposite-top`
// are the items that own it, and they measure the deviation directly — but it must not
// be the hidden precondition of every OTHER item. An emitter parked beside the assumed
// lane never acquires a target on such a build, never fires, and never heats, so items
// about tripping, baking, splash, bounty and targeting all report their own subject as
// broken when what actually happened is that the check was aimed at empty floor.
//
// THE FIX IS TO BUILD THE LANE RATHER THAN ASSUME IT, AND TO BUILD IT ACROSS THE WHOLE
// FLOOR. Towers are walls (`specs/playfield.md`) and the surge re-paths around them, so
// a scenario can force the unit through a chosen tile using nothing but the game's own
// rules — but only if the wall it builds spans every route, and that is where the
// earlier version of this helper fell down. It roofed the vent with two rows of sinks
// and called the rows below them a corridor, which assumes the unit STARTS in the
// corridor. A build that spawns its unit on a vent tile the roof covers (and one of the
// three reference-grade builds does exactly that) drops the unit out of the opening
// ABOVE the roof, where the floor is wide open, and it walks the length of the map
// three rows clear of a gun that never sees it. The check then reports the emitter as
// broken for a spawn-placement defect that `sealing.partial-opening-ok` owns.
//
// So the wall runs the FULL HEIGHT of the floor, from row 0 to row 35, with a two-row
// gap at rows 18-19 and nothing else. A left-vent unit has to reach the right exhaust,
// the exhaust is on the far side of that wall, and rows 18-19 at columns 8-9 are the
// only open tiles in it — so every route, on every pathfinder, from every spawn tile,
// runs through the gap. The emitter under test sits one clear column short of the gap,
// squarely inside its range ring whatever its type.
//
//   col      0 1 2 3 4 5 6 7 8 9 10
//   r0..r17  . . . . . . . . S S .    <- the wall: 2x2 sinks stacked down the column
//   r18      . . . . E E . . . . .    <- the gap, and the emitter under test
//   r19      . . . . E E . . . . .
//   r20..r35 . . . . . . . . S S .    <- the wall again, down to the floor's bottom row
//
// The walls are SINKS, which never fire and have no heat of their own, and the emitter
// is held one clear column short of them, so they shape the route and do nothing else —
// a Sink cools only a TOUCHING emitter (`specs/heat.md`), and a gate that quietly
// drained the tower under test would wreck every heat item that uses it. The emitter
// keeps all four faces open to the air exactly as it would standing alone.
//
// Nothing here seals the floor, so the never-seal rule (`specs/playfield.md`) has no
// reason to refuse any of it: rows 18-19 stay open across the wall, the left vent
// reaches them over open floor, and the top-vent-to-bottom-exhaust route never crosses
// column 8 at all.

/** The wall's left column; its 2x2 sinks cover columns 8 and 9. */
export const GATE_COL = 8;

/** The two rows left open through the wall — the only way across the floor. */
export const GATE_GAP_ROWS = [18, 19];

/**
 * The top-left rows of the 2x2 sinks making up the wall: every pair of rows from the
 * top of the floor to the bottom, except the gap.
 */
const GATE_WALL_ROWS = [];
for (let row = 0; row + 1 < ROWS; row += 2) {
  if (!GATE_GAP_ROWS.includes(row) && !GATE_GAP_ROWS.includes(row + 1)) {
    GATE_WALL_ROWS.push(row);
  }
}

/** How many sinks a complete gate wall is built from. An item asserts on this. */
export const GATE_WALLS = GATE_WALL_ROWS.length;

/** The gap's own tile centre, for range and approach arithmetic. */
export const GATE_CENTER = tileCenter(GATE_COL, GATE_GAP_ROWS[0]);

/**
 * Where the emitter under test stands: on the gap's rows, one clear column short of
 * the wall, so every face is on open air and the gap is well inside its range.
 *
 * The column is measured back from the wall by the tower's own size, so a 2x2 Arc, a
 * 3x3 Bloom and a 4x4 Lance all end up with the same one-column gap to the sinks. The
 * furthest of them (the Lance) still sits under four tiles from the gap, against the
 * shortest range in the roster (the Stutter's 5.0), so every emitter type covers it.
 */
export function gateCell(type) {
  return { col: GATE_COL - TOWER_SIZE[type] - 1, row: GATE_GAP_ROWS[0] };
}

/**
 * Build the gate's wall and report how many of its sinks actually went down.
 *
 * Separate from {@link buildGate} because an item whose emitter comes with its own
 * structure — `cooling.boxed-bakes` boxes one in movers on all four faces — cannot use
 * the standard emitter cell, but wants the same forcing wall in front of it.
 */
export async function buildGateWall(api) {
  let walls = 0;
  for (const row of GATE_WALL_ROWS) {
    if ((await build(api, "sink", GATE_COL, row)) !== null) walls += 1;
  }
  return walls;
}

/**
 * Build the gate with a `type` emitter standing at its gap, and report how many of the
 * wall's sinks actually went down.
 *
 * Returns `{ id, walls }`: the emitter's id (null if its placement was refused), and
 * the sink count, which an item should assert is `GATE_WALLS`. A missing sink is worth
 * failing on rather than driving through — it opens a second way across the floor, and
 * the item would then report its own subject as broken for a hole in its scenery.
 */
export async function buildGate(api, type, rot = 0) {
  const walls = await buildGateWall(api);
  const cell = gateCell(type);
  const id = await build(api, type, cell.col, cell.row, rot);
  return { id, walls };
}

/**
 * The gate counterpart to {@link combatSetup}: a `type` emitter standing at the gate
 * with a real Core walking down to it. Returns `{ id, coreId, walls }`.
 */
export async function gateSetup(api, type, rot = 0) {
  const { id, walls } = await buildGate(api, type, rot);
  const coreId = await spawn(api, "core", "left");
  return { id, coreId, walls };
}

/**
 * Run the real simulation, unfilmed, until the unit with `id` has come within
 * `withinPx` of the gate (or has left the floor). The gate is only eight columns in
 * from the vent, so most items need no skip at all — this is for the ones that film a
 * WINDOW at the gate and would otherwise spend it watching the walk in.
 */
export async function skipToGate(api, id, { withinPx = 90, max = 3600 } = {}) {
  return api.skipUntil(
    (s) => {
      const u = s.surge.find((x) => x.id === id);
      return !u || u.x >= GATE_CENTER.x - withinPx;
    },
    { max, poll: 6 },
  );
}

// ---- Audio (reads the Web Audio cues the build actually schedules) ----------
//
// Meltdown's cues are synthesized with the Web Audio API (specs/ui.md), so the
// driver reports every source the build starts (see `api.audio`). The game must
// not autoplay: it creates (or resumes) its AudioContext only on the first real
// user interaction, so before driving an event whose cue is checked, arm audio
// with a GENUINE browser gesture. Meltdown is mouse-driven (`input.ts` fires the
// same unlock from a mousedown as from a keydown), so a conformant build may
// unlock audio only from a pointer rather than a key — arming uses both
// `api.userKey` and a corner `api.userClick` rather than a debug `press`, which
// would leave such a build's AudioContext uncreated, so no cue would ever be
// scheduled though it plays fine for a real player. `KeyZ` has no game binding.
// The click lands at (1100, 90): inside the build panel (`x >= PANEL_X` = 986,
// constants.ts), in the gap between the readouts strip (y 18..62) and the shop
// grid (y from 122, ui.ts) — no button rect covers that point on any screen. In
// a menu-overlay state the click only tests `menuHits` (laid out around the
// centre); in "playing" it falls through `onPanelClick` matching nothing. So
// arming never places a tower, arms/disarms the shop, or fires a menu action,
// regardless of what the precondition already armed or built. From there a cue
// is confirmed by the audio log growing across the driven event.
//
// A CUE IS NOT SCHEDULED ON THE TICK ITS EVENT HAPPENS, SO THE LOG MUST NOT BE READ
// THERE.
//
// The validate pass advances the simulation INSTANTLY (`advance` is an exact `step`;
// see `packages/browser-driver/validation.mjs`), so a sweep that stops on the tick a
// tower fires, a unit leaks or a tower trips has consumed no wall clock at all. That is
// exactly what makes the verdict deterministic, and it is also why reading `api.audio()`
// right there measures nothing: how a build gets from a simulation event to a
// `start()`ed Web Audio source is its own business, and the two common shapes both need
// real time to have passed.
//
//   * Queue-and-flush. The sim records "a tower fired" and the RENDER frame turns the
//     frame's events into cues — an ordinary way to keep the simulation free of
//     rendering and audio, and precisely what `specs/gameplay.md` asks for ("rendering
//     only reads the state"). Between an instant `step` and the very next `evaluate`
//     round trip there may be no animation frame at all, so the cue has not been
//     scheduled yet when the log is read.
//   * Wall-clock rate limiting. A gun firing several times a second gets its cue
//     throttled against `AudioContext.currentTime` so it does not machine-gun. Under
//     instant stepping `currentTime` barely moves, so every shot after the first
//     collapses into the throttle window — and a throttle seeded at 0 swallows the
//     first one too.
//
// Both are conformant. All three of the builds this was re-checked against exhibit one
// or the other, and on the strictest of them EVERY audio item read zero and reported a
// game with a full set of working cues as having none.
//
// So an audio item spends real time on purpose. `api.settle` is a genuine wall-clock
// pause in BOTH passes (unlike `advance`, which is instant in the validate pass), and
// the build's frame loop keeps painting through it, so it is the one lever that lets a
// deferred cue land before the log is read. Every read below goes through
// {@link audioSettled}, and {@link armAudio} settles too — a context created a
// millisecond ago is still starting up, and a throttle measured from its `currentTime`
// rejects the first cue of the run.

/**
 * How long to let the build's own frame loop run before reading the audio log.
 *
 * 250 ms is about fifteen frames at 60 Hz: comfortably more than the one frame a
 * queue-and-flush build needs, and past any startup guard on a freshly created
 * `AudioContext`. It is spent in real time, so it is charged to an item's `clipMs`
 * budget in the record pass — which is why items keep to one settled read per event
 * rather than sampling in a loop.
 */
export const CUE_SETTLE_MS = 250;

export async function armAudio(api) {
  await api.userKey("KeyZ");
  await api.userClick(1100, 90);
  // The context is created by the gesture above; give it a moment to actually start
  // running before anything measures what it has played.
  await api.settle(CUE_SETTLE_MS);
}

/** The number of Web Audio sources the build has started so far. */
export async function audioCount(api) {
  return (await api.audio()).length;
}

/**
 * The number of Web Audio sources started so far, read after letting the build's frame
 * loop run. This is what an audio item should use on both sides of an event — see the
 * note above.
 */
export async function audioSettled(api, ms = CUE_SETTLE_MS) {
  await api.settle(ms);
  return audioCount(api);
}

/**
 * Advance in short beats until the audio log grows past `from`, and report the count it
 * reached and whether it ever grew.
 *
 * For the cues attached to a REPEATING event rather than a one-off. An emitter firing is
 * the case that matters: `specs/ui.md` asks for a cue when an emitter fires and says
 * nothing about every single shot, so a build is free to throttle a gun that fires
 * seven times a second down to something a person can stand. Reading one shot and
 * declaring the cue missing fails that build for a reasonable choice; giving the gun a
 * few seconds of sustained fire and asking whether ANY of it was audible is the claim
 * the spec actually makes.
 *
 * Each beat is `advance` (simulation) followed by a settle (wall clock for the cue to
 * land), so the sweep costs its caller roughly `beats * (beat/tickHz + CUE_SETTLE_MS)`
 * of clip budget — keep `beats` small.
 */
export async function untilCue(api, from, { beat = 30, beats = 8 } = {}) {
  let count = from;
  for (let i = 0; i < beats; i += 1) {
    await api.advance(beat);
    count = await audioSettled(api);
    if (count > from) return { count, hit: true };
  }
  return { count, hit: false };
}
