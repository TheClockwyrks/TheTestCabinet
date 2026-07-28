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
// `build`, `spawn`, `tower`, `unit`, `heatOf`, `press`, `combatSetup`) is unpaired:
// it is arrange-callable on its own, and the instant READS are callable from any
// phase. `restartGame` is additionally act-safe — see its note.
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
// `act`, and `setAutoStep` is the runtime's to call, never an item's.

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
 * ARRANGE half of a trip scenario: build `type` below the left lane, spawn a Core
 * walking through its range, and pose the emitter's heat just under the redline so
 * a few steps of real firing carry it over. Lives are posed high so a leak during
 * the drive cannot end the run out from under the check.
 *
 * Pair with `actUntilTripped` / `actTripAndRecover`. Returns `{ id, coreId }`.
 */
export async function arrangeNearRedline(
  api,
  type,
  { heat = 92, col = 3, row = 20, rot = 0 } = {},
) {
  await api.call("setLives", 100000);
  const c = await combatSetup(api, type, col, row, rot);
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
 */
export async function combatSetup(api, type, col = 3, row = 20, rot = 0) {
  const id = await build(api, type, col, row, rot);
  const coreId = await spawn(api, "core", "left");
  return { id, coreId };
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
export async function armAudio(api) {
  await api.userKey("KeyZ");
  await api.userClick(1100, 90);
}

/** The number of Web Audio sources the build has started so far. */
export async function audioCount(api) {
  return (await api.audio()).length;
}
