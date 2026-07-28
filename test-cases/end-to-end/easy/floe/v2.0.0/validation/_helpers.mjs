// Case-specific helpers for Floe's automated-validation items.
//
// Every helper here drives the real, deterministic simulation through
// window.__floe (see specs/instrumentation.md): control ops only set up
// PRECONDITIONS, then time runs the real hopping, drift, collision, pursuit,
// scoring, and level logic forward, and `snapshot` (or `pixel`) reads the outcome
// back. Nothing fabricates a result.
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
//   * `assertX(check, outcome, ...)` — records the assertion(s) into the item's
//     `check`. Validate pass only.
//
// A helper that only poses state (`startCrossing`, `clearIce`, `buildSafeColumn`,
// `poseClimb`, `hopPocket`) is unpaired: it is arrange-callable on its own.
// Everything else comes in an `arrangeX` / `actX` PAIR, named for the same
// scenario, and the two halves must be used together — the act half assumes its
// arrange half posed the world.
//
// UNITS ARE TICKS. Floe is a 120 Hz fixed timestep and the debug API's `step`
// takes whole ticks, so every duration below is a tick count (the runtime converts
// to wall-clock for the record pass). The seconds these replace are noted inline.
// The seconds-valued debug ops are NOT affected: `setTimer(seconds)` and a lane's
// `speed` (tiles/second) still take seconds — they pose the world rather than
// advance time.
//
// The assertion primitives themselves are NOT here — they are the reporter-side
// `ttc` kit (`packages/browser-driver/ttc.mjs`), the single source of truth shared
// by every case. This file holds only what is specific to Floe.

// ---- Stage & strait geometry (specs/playfield.md, canonical constants) -----
export const STAGE_W = 1280;
export const STAGE_H = 720;
export const HUD_H = 80; // the strait sits below the 80px HUD bar
export const STRAIT_W = 1280;
export const TILE = 32;

// The simulation rate, and the finest granularity a sweep can poll at. One tick is
// one fixed physics step (this replaces the old `FIXED = 1/120` seconds constant);
// pass `poll: TICK` to `api.until` when the exact instant of an event matters (a
// crush, a drowning, a single glide step), and a coarser poll when the quantity
// read is stable between events (a pursuit closing) so the sweep stays cheap.
export const TICK_HZ = 120;
export const TICK = 1;

// Band rows (strait-local): far-shore cap 0, bays 1, water 2..9, median 10,
// ice 11..18, near shore 19.
export const ROW_BAYS = 1;
export const WATER_TOP = 2;
export const WATER_BOTTOM = 9;
export const ROW_MEDIAN = 10;
export const ICE_TOP = 11;
export const ICE_BOTTOM = 18;
export const ROW_NEAR = 19;

// The five goal bays, each two tiles wide (specs/playfield.md), left column first.
export const BAYS = [
  [3, 4],
  [11, 12],
  [19, 20],
  [27, 28],
  [35, 36],
];
export const BAY_LEFT = BAYS.map((b) => b[0]);

// The critter's hop cooldown (specs/controls.md: about 0.12 s), in ticks. 0.12 s is
// 14.4 ticks, which is not a whole tick count, so a scenario that needs to be PAST
// the cooldown rounds up: `HOP_COOLDOWN_TICKS` is the first whole tick at or past it
// and `HOP_TICKS` adds a margin on top, so a press always lands its hop.
export const HOP_COOLDOWN_TICKS = 15; // 0.125 s — the first whole tick past 0.12 s
export const HOP_TICKS = 18; // 0.15 s — a comfortable margin past the cooldown

// ---- Preconditions (arrange; route through the real systems) ----------------
//
// These pose the world with control ops and consume no time, so they are callable
// straight from `arrange` and need no act half.

/** Reset to the title and begin a fresh run, as choosing CROSS from the menu. */
export async function startCrossing(api, seed) {
  await api.reset(seed === undefined ? undefined : { seed });
  await api.call("startGame");
}

/** Clear every ice-band lane (rows 11..18) — empty, traversable road. */
export async function clearIce(api) {
  for (let r = ICE_TOP; r <= ICE_BOTTOM; r += 1) {
    await api.call("setLane", r, { cols: [] });
  }
}

/**
 * Build a clean vertical corridor at strait column `col`: every ice lane cleared,
 * and a stationary floe under `col` on every water row. A critter placed at `col`
 * can then hop straight from the near shore to the far shore without meeting a
 * vehicle or open water — so a check can drive a full, uninterrupted crossing and
 * read the real scoring, level, and pursuit logic that results.
 */
export async function buildSafeColumn(api, col) {
  await clearIce(api);
  for (let r = WATER_TOP; r <= WATER_BOTTOM; r += 1) {
    await api.call("setLane", r, { cols: [col], speed: 0 });
  }
}

/**
 * Pose the critter at the bottom of a safe corridor at `col` (call after
 * `startCrossing`), ready to climb it. The critter begins at the near shore, so
 * `bestRow` stays at the near shore and each real up-hop scores its row as it is
 * reached.
 *
 * Pair with `actClimbByPress` to drive the climb.
 */
export async function poseClimb(api, col) {
  await buildSafeColumn(api, col);
  await api.call("placeCritter", col, ROW_NEAR);
}

/**
 * Pose a small safe pocket the critter can hop around in without meeting a hazard:
 * a fresh crossing with the top two ice lanes cleared and the critter on the top
 * ice row. Up lands on the median, down on cleared ice, and left/right on cleared
 * ice — every direction is a safe, solid tile, so a controls check reads only the
 * hop the key produced.
 *
 * ARRANGE half of a single-direction controls check; pair with `actHopOnce`.
 */
export async function hopPocket(api) {
  await startCrossing(api);
  await api.call("setLane", ICE_TOP, { cols: [] });
  await api.call("setLane", ICE_TOP + 1, { cols: [] });
  await api.call("placeCritter", 20, ICE_TOP);
}

/** ARRANGE half of a single-direction controls check. Alias of `hopPocket`. */
export const arrangeHop = hopPocket;

// ---- Input-driven play (drives the game the way a player does) --------------

/**
 * ACT half of a single-direction controls check: from the posed pocket, one real
 * press hops the critter, and the simulation runs just past the hop cooldown so the
 * hop completes through the game's own play code. Reads the critter either side of
 * the press.
 *
 * The old helper followed this with a separate real-time clip tail that re-posed the
 * pocket and hopped again; `act` IS the clip now, so this single timed run is both
 * what is checked and what is filmed.
 *
 * Pair with `arrangeHop` / `hopPocket`. Returns `{ before, after }` — `before` is the
 * critter before the press, `after` is the WHOLE snapshot afterwards (the assertions
 * read `screen` and `phase` off it as well as the critter's tile).
 */
export async function actHopOnce(api, code, { ticks = HOP_TICKS } = {}) {
  const before = (await api.snapshot()).critter;
  await api.call("press", code);
  await api.advance(ticks); // 18 ticks = the old 0.15 s, just past the hop cooldown
  const after = await api.snapshot();
  return { before, after };
}

/**
 * ACT half of a climb: hop the critter straight up, one real hop per press, until it
 * reaches `stopRow` (or a cap of hops as a safety net). Each `press` sets the pending
 * hop and the following advance runs the real hop through the game's own play code,
 * so the climb exercises the actual controls and scoring — not a posed jump. Stops
 * before the row that would enter a bay, so a caller controls the final hop.
 *
 * Pair with `poseClimb` (or any arrange that leaves a safe column under the critter).
 * Returns the snapshot at the end of the climb (what the old `climbByPress`
 * returned).
 */
export async function actClimbByPress(
  api,
  code,
  stopRow,
  { maxHops = 40, ticks = 16 } = {},
) {
  for (let i = 0; i < maxHops; i += 1) {
    const s = await api.snapshot();
    if (s.critter.row <= stopRow || s.phase !== "crossing") break;
    await api.call("press", code);
    // 16 ticks = 0.1333 s, the whole-tick stand-in for the old 0.13 s (15.6 ticks):
    // just over the 0.12 s hop cooldown, so the next press hops.
    await api.advance(ticks);
  }
  return api.snapshot();
}

// ---- Controls assertions (record into the item's `check`) ------------------

/**
 * Assert a single-direction controls result: `r` is what `actHopOnce` returned. One
 * real press must move the critter exactly one tile in the expected direction
 * (`dcol`/`drow`) with no death. `who` names the key for the assertions. Records into
 * `check`.
 *
 * This is the assert half of the old all-in-one `hopControlCheck`, with the same four
 * assertions, in the same order, with the same labels.
 */
export function assertHopControl(check, r, { dcol, drow, who }) {
  check.expectEq(
    `${who}: column after the hop`,
    r.after.critter.col,
    r.before.col + dcol,
  );
  check.expectEq(
    `${who}: row after the hop`,
    r.after.critter.row,
    r.before.row + drow,
  );
  check.expectEq(
    `${who}: no death from a normal hop`,
    r.after.screen,
    "playing",
  );
  check.expectNe(`${who}: still crossing`, r.after.phase, "dying");
}

// ---- Pixel / color sampling (reads the rendered canvas) ---------------------
//
// The color checks read the pixels the build actually PAINTS, through the driver's
// `api.pixel(u, v)` — `u`, `v` are fractions across the game canvas, so a stage
// pixel maps to a fraction by dividing by the stage size and an item never has to
// know the canvas's pixel dimensions. Reading the rendered pixel (rather than a
// color the game merely reports) means a build cannot pass by returning a value it
// does not draw.

/** Stage-pixel center of a strait tile (col, row): x across, y below the HUD. */
export function tileCenter(col, row) {
  return { x: TILE * col + TILE / 2, y: HUD_H + TILE * row + TILE / 2 };
}

/**
 * Average the rendered color over a small 5-point cluster (center + four
 * neighbors a few px out) around a STAGE pixel, so a stray antialiased or glow
 * pixel at an edge cannot swing the reading. Returns `{ r, g, b }` (0..255).
 *
 * A pure read of the canvas: it consumes no simulation time, but it must run in
 * `act` because it needs the posed scene to have painted (see `actColorSettle`).
 */
export async function sampleStage(api, sx, sy) {
  const offsets = [
    [0, 0],
    [4, 0],
    [-4, 0],
    [0, 4],
    [0, -4],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [dx, dy] of offsets) {
    const p = await api.pixel((sx + dx) / STAGE_W, (sy + dy) / STAGE_H);
    r += p.r;
    g += p.g;
    b += p.b;
  }
  const n = offsets.length;
  return { r: r / n, g: g / n, b: b / n };
}

/** Sample the rendered color at the center of a strait tile (col, row). Act phase. */
export async function sampleTile(api, col, row) {
  const c = tileCenter(col, row);
  return sampleStage(api, c.x, c.y);
}

/** Euclidean distance between two RGB colors (0 to ~441). */
export function colorDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * ARRANGE half of the color checks: pose a clean, live scene — a fresh crossing with
 * a water row and an ice row cleared (so their band colors read unobstructed), the
 * critter on the median, and a bear on the cleared road. Every element the color
 * items sample then renders unobstructed, in a solid color.
 *
 * This is the old `poseColorScene` minus its trailing paint pause, which consumed
 * real time and so cannot run in `arrange`; that pause is now `actColorSettle`.
 *
 * Pair with `actColorSettle`.
 */
export async function arrangeColorScene(api) {
  await startCrossing(api);
  await api.call("setLane", 5, { cols: [] }); // open-water sample row
  await api.call("setLane", 15, { cols: [] }); // road sample row
  await api.call("placeCritter", 20, ROW_MEDIAN); // critter on the median
  await api.call("setBear", 0, { col: 24, row: 15 }); // bear on the road
}

/**
 * ACT half of the color checks: let a frame paint so the sampled pixels reflect the
 * posed scene. Call this first in `act`, then `sampleTile` / `sampleStage` the points
 * the item cares about. The scene is static, so the settle only has to cover a
 * repaint — not any simulation.
 *
 * A REAL pause, not `advance`. These checks read the pixels the build actually
 * painted, which needs a frame to have landed since the scene was posed — and in the
 * validate pass `advance` is instant, so it produces no frame at all. Waiting on
 * driver round trips instead would make the sample a race that fails a build which
 * painted the scene correctly. See `api.settle` in validation.mjs.
 *
 * Pair with `arrangeColorScene`. Returns nothing.
 */
export async function actColorSettle(api, { settleMs = 80 } = {}) {
  await api.settle(settleMs);
}

// ---- Audio (reads the Web Audio cues the build actually schedules) ----------
//
// Floe's cues are synthesized with the Web Audio API (specs/ui.md), so the driver
// reports every source the build starts (see `api.audio`). The game must not
// autoplay: it creates (or resumes) its AudioContext only on the first real user
// interaction, so before driving an event whose cue is checked, arm audio with a
// GENUINE browser gesture. A build may feed the debug API through a purely logical
// input path and unlock audio only from a real DOM event (a keydown OR a pointer),
// so arming uses both `api.userKey` and a corner `api.userClick` rather than a debug
// `press` — a debug press would leave a conformant build's AudioContext uncreated,
// so no cue would ever be scheduled though it plays fine for a real player. `KeyZ`
// has no game binding and the (4, 4) click lands in the inert HUD corner (Floe binds
// no pointer input), so arming never disturbs game state. From there a cue is
// confirmed by the audio log growing across the driven event.
export async function armAudio(api) {
  await api.userKey("KeyZ");
  await api.userClick(4, 4);
}

// How long to let the page paint before reading the audio log. See `audioCount`.
const AUDIO_SETTLE_MS = 120;

/**
 * The number of Web Audio sources the build has started so far, read after letting
 * the page paint.
 *
 * THE PAUSE IS THE WHOLE POINT. Scheduling a cue and stepping the simulation are not
 * the same act, and the spec does not require them to happen together: specs/ui.md
 * asks for a cue on each event and says nothing about which turn of the build's own
 * machinery starts it. A build that raises a sound the moment its simulation decides
 * one is due has started the source by the time `step` returns; an equally
 * conformant build queues the events its step produced and hands them to Web Audio
 * from its render loop, which cannot have run yet — the validate pass holds the
 * manual clock and steps between driver round trips, so no frame has been painted
 * since the event happened. Reading the log straight after the step scores the
 * second build as silent for a cue every player hears, and does it as a RACE: it
 * depends on whether an animation frame happened to land in the microseconds between
 * two driver calls, so the same build passes some cue checks and fails others.
 *
 * `api.settle` is a real pause in both passes but moves no simulation (see
 * `packages/browser-driver/validation.mjs`), so it gives the render loop its frame
 * without letting the game reach any further event that could confuse the reading.
 * Both ends of a cue measurement go through here, so the count either side is a
 * settled one and the delta belongs to the event that was driven between them.
 */
export async function audioCount(api) {
  await api.settle(AUDIO_SETTLE_MS);
  return (await api.audio()).length;
}
