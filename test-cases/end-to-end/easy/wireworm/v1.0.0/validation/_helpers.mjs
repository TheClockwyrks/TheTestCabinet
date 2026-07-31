// Case-specific helpers for Wireworm's automated-validation items.
//
// Every helper here drives the real, deterministic simulation through
// window.__wireworm (see specs/instrumentation.md): control ops only set up
// PRECONDITIONS, then time runs the real systems forward and `snapshot` reads the
// outcome back. Nothing fabricates a result.
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
// A helper that only poses state (`freshBoard`, `setWorm`) is unpaired: it is
// arrange-callable on its own. Note that `freshBoard` calls `api.reset`, which the
// runtime FORBIDS in `act` — a second scenario inside `act` must be re-posed with
// control ops (`setCursor`/`setNode`/`setWorm`/`spawnFoe`) instead.
//
// UNITS ARE TICKS. Wireworm is a 120 Hz fixed timestep and the debug API's `step`
// takes whole ticks, so every duration below is a tick count (the runtime converts
// to wall-clock for the record pass). The seconds these replace are noted inline.
//
// The assertion primitives themselves are NOT here — they are the reporter-side
// `ttc` kit (`packages/browser-driver/ttc.mjs`), the single source of truth shared
// by every case. This file holds only what is specific to Wireworm.

// ---- Stage & board geometry (specs/board.md and the canonical constants) -----
export const STAGE_W = 1280;
export const STAGE_H = 720;
export const BOARD_Y = 80; // top of the board (below the 80px HUD)
export const TILE = 32;
export const COLS = 40; // 0..39
export const ROWS = 20; // 0..19

// The simulation rate, and the finest granularity a sweep can poll at. One tick is
// one fixed simulation step (this replaces the old `FIXED = 1/120` seconds
// constant); pass `poll: TICK` to `api.until` when the exact instant of an event
// matters, and a coarser poll when the value read is constant between events.
export const TICK_HZ = 120;
export const TICK = 1;

// The player band is the bottom two rows (18..19); the cursor is clamped into it.
export const BAND_TOP_ROW = 18;
export const BAND_TOP_Y = BOARD_Y + BAND_TOP_ROW * TILE; // 656
// The cursor centre is clamped to [TILE/2, STAGE_W-TILE/2] x [BAND_TOP_Y+TILE/2,
// STAGE_H-TILE/2] — i.e. x in [16, 1264], y in [672, 704].
export const CURSOR_X_MIN = TILE / 2; // 16
export const CURSOR_X_MAX = STAGE_W - TILE / 2; // 1264
export const CURSOR_Y_MIN = BAND_TOP_Y + TILE / 2; // 672
export const CURSOR_Y_MAX = STAGE_H - TILE / 2; // 704
export const BAND_CX = STAGE_W / 2; // 640, the respawn cursor x
export const BAND_CY = (BAND_TOP_Y + STAGE_H) / 2; // 688, the respawn cursor y

// Tile <-> logical-pixel helpers (matches constants.ts).
export const tileLeft = (c) => c * TILE;
export const tileTop = (r) => BOARD_Y + r * TILE;
export const tileCX = (c) => c * TILE + TILE / 2;
export const tileCY = (r) => BOARD_Y + r * TILE + TILE / 2;

// ---- Snapshot readers --------------------------------------------------------
//
// Pure functions over a snapshot object. They consume no time and touch no api, so
// they are callable from any phase.

/** The head tile of the first worm, or undefined if there is no worm. */
export function head(snap) {
  return snap.worms[0]?.segments[0];
}

/** The node at tile (c, r) in a snapshot, or undefined if the tile is empty. */
export function nodeAt(snap, c, r) {
  return snap.nodes.find((n) => n.c === c && n.r === r);
}

/** The charge at tile (c, r): the node's charge, or -1 if the tile is empty. */
export function chargeAt(snap, c, r) {
  const n = nodeAt(snap, c, r);
  return n ? n.charge : -1;
}

/** All foes of a given kind in a snapshot. */
export function foesOf(snap, kind) {
  return snap.foes.filter((f) => f.kind === kind);
}

/** Whether tile (c, r) holds a segment of any worm. */
export function segmentAt(snap, c, r) {
  return snap.worms.some((w) => w.segments.some((s) => s.c === c && s.r === r));
}

// ---- State-only helpers (arrange) --------------------------------------------
//
// These pose the world with control ops and consume no time, so they are callable
// straight from `arrange` and need no act half.

/**
 * Reset (reseeding all randomness) and enter a clean, empty, live board at level
 * 1: `enterPlay` puts the build directly into `playing`/`active` — no level banner
 * and no spawn-in invulnerability (see specs/instrumentation.md) — and `clearField`
 * then empties the scattered field it laid, which is the state a posed mechanic
 * scenario needs.
 *
 * `enterPlay` is what makes this instant, and it is REQUIRED: no control operation
 * starts a run on its own, and `step` only advances live play, so without it the
 * build would sit on the title screen and nothing an item did would move. (That is
 * not hypothetical — this helper used to rely on `clearField` implicitly starting a
 * run, which the spec never promised, and every check that did not happen to call
 * `setWorm` silently measured a frozen title screen.)
 *
 * It then poses a BYSTANDER worm, because `enterPlay` alone does not leave a state
 * a level can be played from — see `poseBystander` for why an empty board is a
 * cleared level and what that does to a scenario. A check that poses its own worm
 * needs no further thought: `setWorm` REPLACES the worms on the board, so the
 * bystander is gone the moment the scenario's own worm is laid.
 *
 * ARRANGE ONLY. This calls `api.reset`, which the runtime rejects inside `act`
 * (reset hands the build back to its manual clock, which would silently freeze the
 * recording). To pose a second scenario mid-`act`, use control ops instead.
 */
export async function freshBoard(api, seed = 1) {
  await api.reset({ seed });
  await api.call("enterPlay");
  await api.call("clearField");
  await poseBystander(api);
}

// The bystander's parking spot: the top row, at the right edge, heading INTO that
// edge. See `poseBystander` for why each of those three facts matters.
export const BYSTANDER_C = COLS - 1; // 39
export const BYSTANDER_R = 0;

/**
 * Pose a bystander worm — a worm no assertion ever reads — purely so the board is
 * not empty of worm segments while a scenario runs.
 *
 * A board with no worm segments on it is a CLEARED LEVEL. specs/worm.md fixes the
 * condition as "a level is cleared when every worm segment on the board is gone",
 * and the build is entitled to evaluate that the moment it sees it — nothing in the
 * specs says the level must first have HAD a worm. So the worm-less board
 * `enterPlay` is specified to produce (specs/instrumentation.md: it "leaves the
 * board clear of worms and foes") reads exactly like the player having shot the
 * last segment, and the level clears on the very first tick that runs. Three things
 * follow from that one tick, and all of them bite:
 *
 *   * The clock. Clearing advances the level, and a level opens on its banner
 *     (specs/ui.md). A banner is not live play, so `step` does not advance the
 *     simulation through it — the scenario is frozen for the whole banner, which is
 *     most or all of the tick budget an item's `until` sweep is allowed. The item
 *     then times out having never run the mechanic it poses.
 *   * The board. Advancing rebuilds the level: the posed foes and bolts are cleared
 *     and the cursor is re-centred, so a foe an item spawned and then read back is
 *     simply gone, and a scenario posed around a cursor position is measuring some
 *     other cursor.
 *   * The score and level. Clearing banks `100 * level` (specs/progression.md), so
 *     an item comparing a score delta against a bounty or a node's `+1` reads the
 *     clear bonus instead, and an item that pins its level reads the next one.
 *
 * So a bystander is not only for scenarios that destroy a worm: ANY item that
 * `freshBoard`s and then spends time without posing a worm of its own needs one, or
 * the level ends underneath it before its first tile step.
 *
 * Parking. The worm is put in the TOP ROW at the RIGHT EDGE, heading into that
 * edge, and every one of those is load-bearing:
 *
 *   * Top row, because a worm only descends when something turns it
 *     (specs/worm.md) — on an empty board that is the side edge, so it crosses all
 *     40 columns before dropping a single row. At level 1 (0.14 s per tile step,
 *     the slowest the game ever runs) that is ~5.6 s per row, so it is still in the
 *     top rows long after the longest item here has finished, and it can neither
 *     reach the player band nor disturb a scenario posed on rows 3..19.
 *   * Right edge, because the scenarios here are posed on columns 5..20 and the
 *     worm walks AWAY from them: it turns on the edge immediately and winds left,
 *     so it is ~39 tile steps from column 0 and never near a fired column early on,
 *     when the bolt checks resolve.
 *   * One segment, so it is the smallest thing that satisfies "a worm segment on
 *     the board" and blocks as little of it as possible.
 *
 * It is never read by an assertion and never fired at. Note `clearField` does NOT
 * remove it (that op clears nodes, not worms), but `setWorm` does — an item that
 * poses its own worm replaces the bystander, which is exactly what it wants.
 */
export async function poseBystander(api) {
  await setWorm(api, [{ c: BYSTANDER_C, r: BYSTANDER_R }], 1, 1);
}

/** Replace the worms with a single worm laid out by `spec` (segments[0] = head). */
export async function setWorm(api, segments, dh = 1, dv = 1) {
  await api.call("setWorm", { segments, dh, dv });
}

/** A straight horizontal worm of `len` tiles with its head at (headC, r). */
export function straightWorm(headC, r, len, dh = 1) {
  const segs = [];
  for (let i = 0; i < len; i++) segs.push({ c: headC - dh * i, r });
  return segs;
}

// ---- Worm stepping (act) -----------------------------------------------------

/**
 * ACT: advance the real simulation by exactly one worm tile-step, detected by the
 * head moving to a new tile. Polls one tick at a time because the snapshot wanted
 * is the one at the instant the worm stepped, which a coarse sweep would overshoot.
 *
 * Returns the snapshot the instant the worm stepped, or — matching the old
 * `wormStep` — the last snapshot if the worm vanished (shot out from under the
 * scan) or never moved within the cap.
 */
export async function actWormStep(api, { max = 480 } = {}) {
  // 480 ticks = the old 4s cap.
  const before = head(await api.snapshot());
  if (!before) return api.snapshot();
  const r = await api.until(
    (s) => {
      const h = head(s);
      if (!h) return true; // the worm is gone; stop and hand back what we have
      return h.c !== before.c || h.r !== before.r;
    },
    { max, poll: TICK },
  );
  return r.snap;
}

/**
 * ACT: advance the worm `n` tile-steps and return the final snapshot.
 * Replaces the old `wormSteps`.
 */
export async function actWormSteps(api, n, { max = 480 } = {}) {
  let snap = await api.snapshot();
  for (let i = 0; i < n; i++) snap = await actWormStep(api, { max });
  return snap;
}

// ---- Firing (act) ------------------------------------------------------------

/**
 * ACT: fire a bolt from the cursor now and run the real shot code forward until the
 * bolt resolves (leaves the board or is consumed by a hit). Returns the snapshot
 * the instant no bolts remain in flight.
 *
 * `fire()` is a control op, so it consumes no time and does not touch the clock —
 * it lives here rather than in an arrange half because the shot and its resolution
 * are one scenario, and the clip must show the bolt actually travelling.
 *
 * Replaces the old `fireAndResolve`.
 */
export async function actFireAndResolve(api, { max = 180 } = {}) {
  // 180 ticks = the old 1.5s cap.
  await api.call("fire");
  const r = await api.until((s) => s.bolts.length === 0, { max, poll: TICK });
  return r.snap;
}

// ---- Injected-input helpers --------------------------------------------------
//
// These drive the game the way a player does — through injected keyboard input
// (window.__wireworm keyDown/keyUp/press, see specs/instrumentation.md) — rather
// than posing the world with the control ops. Because they never pose the cursor
// directly, the cursor moves through the game's normal moveCursor code as time
// runs, which is exactly what a controls check must confirm.

/**
 * ARRANGE half of a movement-key check: a clean live board with the cursor placed
 * at a start clear of the bound it will move toward, so the measured displacement
 * is not eaten by the band clamp.
 *
 * Pair with `actHoldMove`.
 */
export async function arrangeMoveControl(api, { startX, startY }) {
  await freshBoard(api);
  await api.call("setCursor", startX, startY);
}

/**
 * ACT half of a movement-key check: hold a movement key and report how the cursor
 * moved. The verdict is read after exactly `ticks` of held input, so the measured
 * displacement is the same in both passes; the extra `tailTicks` are held
 * afterwards purely so the recorded clip shows the cursor sliding for a readable
 * moment before the key is released (they cannot affect the returned deltas, which
 * were already captured).
 *
 * Pair with `arrangeMoveControl`. Returns `{ dx, dy, before, after }` — the same
 * shape the old `holdMove` returned.
 */
export async function actHoldMove(
  api,
  code,
  { ticks = 60, tailTicks = 78 } = {},
) {
  const before = (await api.snapshot()).cursor;
  await api.call("keyDown", code);
  await api.advance(ticks); // 60 ticks = the old 0.5s of measured motion
  const after = (await api.snapshot()).cursor;
  await api.advance(tailTicks); // 78 ticks = the old 650ms visible hold
  await api.call("keyUp", code);
  return { dx: after.x - before.x, dy: after.y - before.y, before, after };
}

const HMOVE_MIN = 40; // a clearly non-trivial horizontal displacement, in px
const VMOVE_MIN = 10; // the band is only ~32px tall, so a smaller vertical bound

/**
 * Assert a movement-key control result: `r` is what `actHoldMove` returned.
 * `axis` is "x" or "y"; `dir` is -1 (left/up) or +1 (right/down). Recorded as a
 * threshold comparison so a failure shows the actual delta against the bound.
 *
 * Records into `check`. Replaces the assertion half of the old `moveControlCheck`.
 */
export function assertMoveControl(check, r, { code, axis, dir }) {
  const delta = axis === "x" ? r.dx : r.dy;
  const min = axis === "x" ? HMOVE_MIN : VMOVE_MIN;
  const way =
    dir < 0 ? (axis === "x" ? "left" : "up") : axis === "x" ? "right" : "down";
  if (dir < 0) {
    check.expectLt(
      `holding ${code} moves the cursor ${way} (Δ${axis})`,
      delta,
      -min,
    );
  } else {
    check.expectGt(
      `holding ${code} moves the cursor ${way} (Δ${axis})`,
      delta,
      min,
    );
  }
}

/**
 * ARRANGE half of a pause-key check: a clean live board at level 1.
 *
 * Pair with `actPauseControl`.
 */
export async function arrangePauseControl(api) {
  await freshBoard(api);
}

/**
 * ACT half of a pause-key check: let the board play visibly for a beat, press the
 * pause key, then hold on the result so the clip shows the pause landing. The old
 * helper decided the verdict from an instant press and then re-posed a separate
 * real-time clip; `act` IS the clip now, so it is one timed run — the pause verdict
 * never depended on the timing.
 *
 * Pair with `arrangePauseControl`. Returns the screen after the press.
 */
export async function actPauseControl(
  api,
  code,
  { playTicks = 60, holdTicks = 72 } = {},
) {
  await api.advance(playTicks); // 60 ticks = the old 500ms of visible play
  await api.call("press", code);
  await api.advance(holdTicks); // 72 ticks = the old 600ms hold on the pause screen
  return (await api.snapshot()).screen;
}

/**
 * Assert a pause-key control result: `screen` is what `actPauseControl` returned.
 * Records into `check`. Replaces the assertion half of the old `pauseControlCheck`.
 */
export function assertPauseControl(check, screen, { code }) {
  check.expectEq(`pressing ${code} pauses the game`, screen, "paused");
}

// ---- Rendered-pixel color sampling ------------------------------------------
//
// The color checks read the pixels the build actually PAINTS, through the driver's
// `api.pixel(u, v)` — u, v are fractions across the game canvas — so a logical
// pixel maps to a fraction by dividing by the stage size and an item never has to
// know the canvas's device dimensions. Reading the rendered pixel (not a color the
// game reports) means a build cannot pass by returning a value it does not draw.

/**
 * Average the rendered color over a small 5-point cluster (centre + four neighbours
 * a few px out) around a logical-pixel point, so a stray antialiased edge pixel
 * cannot swing the reading. Returns `{ r, g, b }` (0–255).
 *
 * A pure read of the canvas: it consumes no simulation time, but it must run in
 * `act` because it needs the posed scene to have painted. Precede it with
 * `api.settle(ms)` — a REAL pause in both passes — so a frame has landed since the
 * scene was posed; in the validate pass `api.advance` is instant and produces no
 * frame at all. See `api.settle` in validation.mjs.
 */
export async function sampleColor(api, x, y) {
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
    const p = await api.pixel((x + dx) / STAGE_W, (y + dy) / STAGE_H);
    r += p.r;
    g += p.g;
    b += p.b;
  }
  const n = offsets.length;
  return { r: r / n, g: g / n, b: b / n };
}

/** Euclidean distance between two RGB colors (0 to ~441). */
export function colorDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** Perceived brightness of an RGB color (0–255). */
export function brightness(c) {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

// ---- Audio (reads the Web Audio cues the build actually schedules) ----------
//
// Wireworm's cues are synthesized with the Web Audio API (specs/ui.md), so the
// driver reports every source the build starts (see `api.audio`). The game must
// not autoplay: it creates (or resumes) its AudioContext only on the first real
// user interaction, so before driving an event whose cue is checked, arm audio
// with a GENUINE browser gesture. A build may feed the debug API through a purely
// logical input path and unlock audio only from a real DOM event (a keydown OR a
// pointer), so arming uses both `api.userKey` and a corner `api.userClick` rather
// than a debug `press` — a debug press would leave a conformant build's
// AudioContext uncreated, so no cue would ever be scheduled though it plays fine
// for a real player. `KeyZ` has no game binding, and Wireworm has no pointer
// input at all (keyboard only, specs/controls.md), so the click cannot disturb
// game state at any position — (4, 4) is used for consistency with other cases.
// From there a cue is confirmed by the audio log growing across the driven event.
//
// The genuine keydown only reaches the game's own audio-unlock code (Wireworm
// resumes its AudioContext from `handleInput`, called once per real animation
// frame — every mechanic-driven cue below is scheduled from the fixed-step
// simulation instead, never from `handleInput` itself) once a real frame has run,
// and every mechanic this file drives (`fire`, a shot, a bump, a touch) is posed
// through control ops that never wait on one. The trailing `settle` is a genuine
// wall-clock pause (unlike `advance`, which is instant in the validate pass) that
// gives the build's own render loop the frame it needs to notice the gesture and
// unlock audio BEFORE a check drives the event whose cue depends on it.
export async function armAudio(api) {
  await api.userKey("KeyZ");
  await api.userClick(4, 4);
  await api.settle(50);
}

/** The number of Web Audio sources the build has started so far. */
async function audioCount(api) {
  return (await api.audio()).length;
}

/**
 * ACT: the number of Web Audio sources the build has started, read after a real
 * paint pause.
 *
 * The pause is the whole point, and it is not optional. Scheduling a Web Audio
 * source is not required to happen inside the call that causes the cue: a build may
 * legitimately QUEUE the sound events its fixed-step simulation emits and play them
 * from its render loop, which is a frame away. Nothing in specs/ui.md says
 * otherwise, so a check that reads the probe with no wall clock between the event
 * and the read is racing that frame — and `advance` cannot settle it, because in the
 * validate pass `advance` is an instant `step` that produces no frame at all. Only
 * `settle` is real time in BOTH passes (see `api.settle` in validation.mjs).
 *
 * So both the before and after reads go through here: the leading pause also flushes
 * any cue queued during `arrange` into the BEFORE count, where it cannot be mistaken
 * for the one the item drives.
 *
 * (That race is not hypothetical. The items whose cue follows a bolt across the
 * board passed on the incidental latency of their `until` sweep's round trips, while
 * `audio.fire`, `audio.life`, and `audio.game-over` — which drive their event and
 * read straight back — reported no cue at all from a build that plays all nine
 * perfectly for a real player.)
 */
export async function actAudioCount(api, { settleMs = 120 } = {}) {
  await api.settle(settleMs);
  return audioCount(api);
}
