// Case-specific helpers for Deepcore's automated-validation items.
//
// Every helper here drives the real, deterministic simulation through window.__deepcore
// (see specs/instrumentation.md): control ops only ARRANGE preconditions, then time runs
// the real systems forward and `snapshot`/`tileAt`/`pixel` read the outcome back. Nothing
// fabricates a result.
//
// The helpers are split along the runtime's arrange/act seam (see
// `packages/browser-driver/validation.mjs`). An item runs TWICE — once with time instant
// to decide the verdict, once in real time to record the media — and the runtime enforces
// the split by throwing if `arrange` consumes time:
//
//   * `arrangeX(api, ...)` / the unpaired state-only helpers — control ops and instant
//     reads only. Callable from `arrange`, and they run in BOTH passes, so the record pass
//     reaches `act` in exactly the state the check saw.
//   * `actX(api, ...)` — consumes time via `api.advance` / `api.until` and returns the
//     outcome the assertions read. Callable from `act`, and the only part filmed.
//
// A helper that only poses state (`newRun`, `cleanTitle`, `solid`, `openColumn`,
// `standAt`, `bothNodes`) is unpaired: it is arrange-callable on its own. Everything that
// consumes time comes in an `arrangeX` / `actX` PAIR named for the same scenario, and the
// two halves must be used together — the act half assumes its arrange half posed the
// world.
//
// UNITS ARE TICKS. Deepcore is a 60 Hz fixed timestep (specs/controls.md) and the debug
// API's `step` takes whole ticks, so every duration below is a tick count: 1 tick = 1/60 s,
// so 60 ticks = 1 second (the runtime converts to wall-clock for the record pass). The
// seconds these replace are noted inline.
//
// The assertion primitives are NOT here — they are the reporter-side `ttc` kit the driver
// hands every item (packages/browser-driver/ttc.mjs), shared by every case. This file holds
// only what is specific to Deepcore.

// ---- Geometry & constants (specs/overview.md, specs/world.md, specs/controls.md) ----
export const TILE = 80;
export const STAGE_W = 1280;
export const STAGE_H = 720;
export const VIEWPORT_Y = 56; // status bar height; the mine viewport starts here
export const MINER_W = 57;
export const MINER_H = 73;
export const SPAWN_COL = 15;

// The simulation rate, and the finest granularity a sweep can poll at. One tick is one
// fixed logic step (this replaces the old `TICK = 1/60` seconds constant); pass
// `poll: TICK` to `api.until` when the exact instant of an event matters. `TICK_HZ` doubles
// as the seconds->ticks factor: N seconds is `N * TICK_HZ` ticks.
export const TICK_HZ = 60;
export const TICK = 1;

// Representative interior rows of each band in the STANDARD mine (coreRow 500, quarters of
// 125 rows each: topsoil 1..125, rockbed 126..250, deepstone 251..375, coreshell 376..499).
export const TOPSOIL_ROW = 60;
export const ROCKBED_ROW = 190;
export const DEEPSTONE_ROW = 310;
export const CORESHELL_ROW = 440;

// Held-key codes for the four movement intents (specs/controls.md — arrows or WASD).
export const K = {
  down: "ArrowDown",
  thrust: "ArrowUp",
  left: "ArrowLeft",
  right: "ArrowRight",
};

// ---- Run setup (arrange) ---------------------------------------------------
//
// These pose the world with control ops and consume no time, so they are callable straight
// from `arrange` and need no act half.

/** Reset to a fixed seed and start a fresh expedition; returns the opening snapshot. The seed
 *  fixes the generated mine so a scenario replays identically (specs/instrumentation.md). */
export async function newRun(
  api,
  { mode = "standard", size = "standard", seed = 1 } = {},
) {
  await api.reset({ seed });
  await api.call("startExpedition", mode, size);
  return api.snapshot();
}

/** Return to a clean title with NO save present (startExpedition clears any save, then reset
 *  re-arms the title), so the main-menu order is deterministic (no stray CONTINUE entry). Pass the
 *  world SIZE explicitly: `startExpedition(mode, size)` documents both arguments
 *  (specs/instrumentation.md), so a caller must supply size rather than rely on a default the
 *  contract never promises. */
export async function cleanTitle(api) {
  await api.reset({ seed: 1 });
  await api.call("startExpedition", "standard", "standard");
  await api.reset({ seed: 1 });
}

// ---- Terrain arrangement (preconditions only) -----------------------------

/** Make one cell solid rock (its band is kept, so it drills at that band's hardness). */
export async function solid(api, col, row) {
  await api.call("setTile", col, row, { kind: "rock" });
}

/** Open one cell to empty tunnel (its band is kept). setTile is the terrain tool — teleport moves
 *  the miner only and never alters the world (specs/instrumentation.md) — so clearing a cell to
 *  standable space is the caller's job, done here. */
export async function clear(api, col, row) {
  await api.call("setTile", col, row, { kind: "tunnel" });
}

/** Carve a vertical run of open tunnel over rows [rowFrom, rowTo] in a column, so the miner can
 *  climb or fall a long way through open space (a precondition for climb/fall measurements). */
export async function openColumn(api, col, rowFrom, rowTo) {
  const lo = Math.min(rowFrom, rowTo);
  const hi = Math.max(rowFrom, rowTo);
  for (let r = lo; r <= hi; r += 1)
    await api.call("setTile", col, r, { kind: "tunnel" });
}

/** Drop the miner into (col, row) with the cell first cleared to open tunnel so it lands in
 *  traversable space. teleport only positions the miner and leaves terrain untouched
 *  (specs/instrumentation.md), so a scenario that needs the destination open must open it — that
 *  clearing is the validator's responsibility, not teleport's. Use this everywhere a scenario
 *  teleports the miner somewhere it should stand, fall, or drill from. */
export async function teleportInto(api, col, row) {
  await clear(api, col, row);
  await api.call("teleport", col, row);
}

/** Place the miner on a guaranteed solid floor at (col, row): clear the cell to tunnel and drop in,
 *  then lay a rock tile directly beneath so it stands grounded rather than on whatever the seed
 *  happened to put there. A second teleport re-settles it onto the fresh floor. */
export async function standAt(api, col, row) {
  await teleportInto(api, col, row);
  await solid(api, col, row + 1);
  await api.call("teleport", col, row); // re-settle onto the fresh floor (already cleared above)
}

// ---- Key input -------------------------------------------------------------

/** Tap a key as a one-shot edge (menu move / confirm / activate), applied immediately. A press
 *  consumes no simulation time, so it is callable from either phase — from `arrange` to walk the
 *  menus into position, from `act` when the press itself is the behavior under test. */
export async function press(api, code) {
  await api.call("press", code);
}

// ---- Timed drives (act) ----------------------------------------------------

/**
 * ACT: advance the real sim by `ticks` and return the fresh snapshot. In the validate pass this
 * is an exact `step` on the manual clock, so the scenario advances by EXACTLY that many ticks;
 * in the record pass it is a real pause of the same duration while the build drives itself.
 *
 * Replaces the old seconds-based `step(api, seconds)` helper: `step(api, 0.25)` becomes
 * `actAdvance(api, 15)`.
 */
export async function actAdvance(api, ticks) {
  await api.advance(ticks);
  return api.snapshot();
}

/**
 * ACT: hold `code` down, advance the real sim `ticks` (the miner moves/drills under its own
 * update), and return the snapshot. Leaves the key held unless `release`.
 *
 * Replaces the old `holdFor(api, code, seconds, opts)`.
 */
export async function actHoldFor(api, code, ticks, { release = true } = {}) {
  await api.call("keyDown", code);
  await api.advance(ticks);
  const snap = await api.snapshot();
  if (release) await api.call("keyUp", code);
  return snap;
}

// The old `stepUntil(api, predicate, maxSeconds, chunk)` is GONE — the runtime provides it as
// `api.until(predicate, { max, poll })`, which returns `{ snap, hit, spent }` and works in both
// passes (stepping in validate, sampling the running game in record). Convert the bounds to
// ticks: the common `stepUntil(..., 3, 0.05)` becomes `api.until(..., { max: 180, poll: 3 })`.
//
// The old `liveClip(api, ms)` is GONE too. It re-armed live running with `setAutoStep(true)` and
// waited so a video showed motion; `act` IS the clip now, filmed in real time by the record pass,
// so an item must never touch `setAutoStep` and needs no clip tail.

// ---- Death (arrange + act pair) -------------------------------------------

/**
 * ARRANGE half of a hull death underground: stand the miner on a solid floor at (col, row) over a
 * gas pocket, with the hull set to a sliver so the pocket's detonation finishes it.
 *
 * Why a hazard and not `setHull(0)`. This used to pose the death outright by emptying the hull and
 * then wait for the screen to turn over. That reads as arranging a precondition, but it is not one:
 * it asks the build to treat a DEBUG WRITE as the death event itself. `specs/instrumentation.md`
 * says the opposite about every control op — they "set up a specific situation ... arranging the
 * world rather than faking outcomes; the outcome is then produced by running the real simulation
 * forward" — and the one hull example it gives is posing "a near-death hull", not a destroyed one.
 * A build is therefore free to run its death check where damage is DEALT (the only place hull
 * reaches 0 in real play) rather than polling the field every tick, and such a build never dies
 * from the poke: it sits underground at 0 hull, and every item that only wanted "a death to have
 * happened" fails on `screen === "game-over"` for a reason that has nothing to do with what it
 * claims to check. Two independent builds did exactly that.
 *
 * So the death is produced the way the game produces it: a real hit. The pocket is a gas pocket
 * because a detonation is the case's most unambiguous single lethal hit (`specs/hazards.md` puts
 * the raw rockbed hit at `~60` hull), and the hull is set to a sliver first, which IS the posed
 * near-death precondition the spec sanctions — so the item does not depend on how hard a given
 * build's gas hits, only on its dealing damage at all. The resulting death is a hull death
 * (`deathCause: "hull-destroyed"`), the same one the old pose intended.
 *
 * Pair with `actKillByHull`.
 */
export async function arrangeKillByHull(api, col, row) {
  await standAt(api, col, row);
  await api.call("setTile", col, row + 1, { kind: "gas" });
  await api.call("setTile", col, row + 2, { kind: "rock" });
  await teleportInto(api, col, row);
  // A sliver, so ANY damage the detonation deals is lethal — the item under test is what survives
  // the death, never how hard this build's gas hits.
  await api.call("setHull", 1);
}

/**
 * ACT half of a hull death: drill into the posed pocket, let the real detonation kill the miner,
 * and hold on the Game Over screen for a beat before returning its snapshot.
 *
 * `max` is deliberately generous (600 ticks = 10 s). The cut has to break a band tile before the
 * pocket goes off, and `specs/character.md` fixes neither a drill duration nor a death-animation
 * length, so a tighter cap would pin a build to the reference's own pace rather than to the rule.
 * The validate pass is instant regardless of the cap; only a build that never dies pays the wait.
 *
 * The closing beat is what a reviewer needs: without it the clip cuts on the very frame the screen
 * turns over, so the Game Over screen — and the run summary that is the actual evidence for
 * several of these items — is never on screen long enough to read.
 *
 * Pair with `arrangeKillByHull`. Returns the snapshot (what the old `killByHull` returned).
 */
export async function actKillByHull(api, { max = 600, poll = 6 } = {}) {
  await api.call("keyDown", K.down); // cut into the pocket
  const r = await api.until((s) => s.screen === "game-over", { max, poll });
  await api.call("keyUp", K.down);
  await api.advance(90); // 90 ticks = 1.5 s resting on the Game Over screen
  return r.snap;
}

// ---- Material-node discovery (arrange) ------------------------------------

/**
 * Discover BOTH guaranteed buried material nodes of a freshly-generated mine and report each
 * one's material and band. findTile only locates the NEAREST material tile, so we read the
 * nearest, then clear that cell to tunnel (retiring the node) so the second findTile returns the
 * other node. Clearing is an explicit setTile — teleport no longer alters terrain
 * (specs/instrumentation.md). Consumes no time (reset, setTile, and the reads are all instant), so
 * it is arrange-callable. Returns `[{ material, band, col, row }, ...]` (0, 1, or 2 entries).
 */
export async function bothNodes(api, seed = 1) {
  await api.reset({ seed });
  await api.call("startExpedition", "standard", "standard");
  const out = [];
  const p1 = await api.call("findTile", "material");
  if (!p1) return out;
  const t1 = await api.call("tileAt", p1.col, p1.row);
  out.push({ material: t1.material, band: t1.band, col: p1.col, row: p1.row });
  await clear(api, p1.col, p1.row); // retire the first node so findTile returns the other
  const p2 = await api.call("findTile", "material");
  if (p2) {
    const t2 = await api.call("tileAt", p2.col, p2.row);
    out.push({
      material: t2.material,
      band: t2.band,
      col: p2.col,
      row: p2.row,
    });
  }
  return out;
}

// ---- Pixel / color sampling (reads the rendered canvas) --------------------
//
// pixel(u, v) samples the ACTUAL rendered largest canvas at a normalized point (see
// packages/browser-driver/driver.mjs). The mine is drawn with the camera offset
// (render.ts): a world point (wx, wy) lands at screen (wx - cameraX, VIEWPORT_Y + wy -
// cameraY) in the fixed 1280x720 logical stage, so a logical stage point maps to a canvas
// fraction by dividing by the stage size. Reading the drawn pixel (not a value the game
// reports) means a build cannot pass a color check by claiming a color it never paints.
//
// PHASE: the sampling helpers below (`sampleAt`, `sampleTile`, `tileMaxDistFrom`) consume no
// simulation time, but they must run in `act` — they need the posed scene to have PAINTED, and
// in the validate pass advancing time is instant and produces no frame at all. Call
// `await api.settle(120)` (a REAL pause in both passes, see `api.settle` in validation.mjs)
// once after the scene is posed, before the first sample. That settle replaces the old
// `api.wait(120)` these scripts used. `tileScreen`, `minerScreen`, and `colorDistance` are pure
// arithmetic and are callable from any phase.

/** Logical-stage coords of a tile's center for the given camera. */
export function tileScreen(col, row, cam) {
  return {
    x: col * TILE - cam.x + TILE / 2,
    y: VIEWPORT_Y + row * TILE - cam.y + TILE / 2,
  };
}

/** Logical-stage coords of the miner's center for the given camera. */
export function minerScreen(m, cam) {
  return {
    x: m.x + MINER_W / 2 - cam.x,
    y: VIEWPORT_Y + m.y + MINER_H / 2 - cam.y,
  };
}

/**
 * Throw unless a logical-stage point is actually ON the 1280x720 stage.
 *
 * `api.pixel(u, v)` CLAMPS its normalized coordinate into range (driver.mjs), so sampling a
 * point that is off the stage does not fail — it quietly returns whatever pixel sits on the
 * nearest EDGE. Two different off-stage points therefore read the SAME edge pixel and compare
 * as identical, which a color check reads as "the build painted these two things the same
 * color" when in truth neither was ever sampled. That turns a mis-framed camera into a
 * confident, wrong verdict — and, worse, silently PASSES a check that asserts two things look
 * alike. Failing loudly here says what actually went wrong.
 *
 * A conformant build never trips this: `teleport` recenters the camera on the miner
 * (specs/instrumentation.md), so a cell a couple of tiles from the miner is always in view.
 */
export function assertOnStage(x, y, what) {
  if (x >= 0 && x <= STAGE_W && y >= 0 && y <= STAGE_H) return;
  throw new Error(
    `${what} is off the ${STAGE_W}x${STAGE_H} stage at (${x.toFixed(1)}, ${y.toFixed(1)}) — ` +
      `the camera is not framing it, so its rendered color cannot be read. ` +
      `teleport(col, row) must recenter the camera on the miner (specs/instrumentation.md).`,
  );
}

/** Whether two lists of sampled pixels are identical. */
function samePixels(a, b) {
  return a.every((c, i) => c.r === b[i].r && c.g === b[i].g && c.b === b[i].b);
}

/**
 * Wait until what the build has PAINTED at `points` (logical stage coords) stops changing, so a
 * color read is of the scene the item posed rather than of a frame from before it.
 *
 * This replaces the fixed `api.settle(120)` the color items used to open with. A fixed pause is a
 * race: it is a wall-clock guess at how long this host takes to repaint, and when the guess comes
 * up short `api.pixel` reads the PREVIOUS frame. That stale frame is usually a uniform patch of
 * sky or of the surface camp, so every point sampled from it returns the same color and the
 * comparison collapses to a distance of 0 — which fails a build that painted correctly, and (for
 * a check like hazards.gas-hidden, which asserts two tiles look ALIKE) passes one that painted
 * nothing at all. Neither is a verdict worth recording.
 *
 * So poll instead of guessing: settle a slice at a time and watch what is painted.
 *
 * Note what the early exit requires. "The reading held still for two slices" is NOT on its own
 * evidence that the posed scene is up: a STALE frame holds perfectly still too — it is a frame,
 * it is not being redrawn, and every read of it agrees. Stability alone therefore cannot tell a
 * settled scene from one that has not arrived, which is exactly the case this needs to catch. So
 * the early exit also requires having SEEN the reading change at least once: an item settles right
 * after posing a scene somewhere new, so a repaint that lands during the wait necessarily moves
 * these points off whatever they showed before. Having watched them move and then come to rest is
 * evidence of the new frame; stillness from the first read is not.
 *
 * When the points genuinely never change — the scene was already painted before the first read —
 * no early exit fires and the wait simply runs to `max`, which is the correct reading taken a
 * little later than strictly necessary. That is the price of the guarantee, and it is small: a
 * fraction of a second per sampling item, in a pass that is otherwise instant.
 *
 * `max` also bounds a scene that never settles: animated lava cycles through its frames forever,
 * and reading it at the cap is right — that reading was always going to be of one arbitrary frame.
 */
export async function settleStable(
  api,
  points,
  { slice = 60, max = 1200 } = {},
) {
  const read = async () => {
    const out = [];
    for (const p of points)
      out.push(await api.pixel(p.x / STAGE_W, p.y / STAGE_H));
    return out;
  };
  let prev = await read();
  let stable = 0;
  let changed = false;
  for (let spent = 0; spent < max; spent += slice) {
    await api.settle(slice);
    const now = await read();
    if (samePixels(prev, now)) {
      stable += 1;
    } else {
      changed = true;
      stable = 0;
    }
    prev = now;
    if (changed && stable >= 2) return;
  }
}

/**
 * ACT: hold until the build has painted the given cells, then leave them ready to sample.
 * `cells` is a list of `[col, row]`. Each cell is checked to be on stage first, so a camera that
 * is not framing the scene fails with that as the reason instead of returning edge pixels.
 */
export async function settleTiles(api, cells, opts) {
  const cam = (await api.snapshot()).camera;
  const points = cells.map(([col, row]) => tileScreen(col, row, cam));
  points.forEach((p, i) =>
    assertOnStage(p.x, p.y, `tile (${cells[i][0]}, ${cells[i][1]})`),
  );
  await settleStable(api, points, opts);
}

/** Average the rendered color over a small 5-point cluster around a logical stage point, so a
 *  stray antialiased edge pixel cannot swing the reading. Returns { r, g, b } (0–255). */
export async function sampleAt(api, x, y, what = "the sampled point") {
  assertOnStage(x, y, what);
  const offsets = [
    [0, 0],
    [7, 0],
    [-7, 0],
    [0, 7],
    [0, -7],
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

/** Sample a tile's rendered center color; reads the live camera itself. Act-phase — settle once
 *  with `api.settle` after posing the scene so there is a painted frame to read. */
export async function sampleTile(api, col, row) {
  const cam = (await api.snapshot()).camera;
  const s = tileScreen(col, row, cam);
  return sampleAt(api, s.x, s.y, `tile (${col}, ${row})`);
}

/** The greatest color distance from `ref` found across a 3x3 grid of points inside a tile — so
 *  a payload that covers only PART of the tile (an ore smear) still registers as present.
 *  Act-phase, like `sampleTile`. */
export async function tileMaxDistFrom(api, col, row, ref) {
  const cam = (await api.snapshot()).camera;
  let max = 0;
  for (const fx of [0.28, 0.5, 0.72]) {
    for (const fy of [0.28, 0.5, 0.72]) {
      const x = col * TILE - cam.x + fx * TILE;
      const y = VIEWPORT_Y + row * TILE - cam.y + fy * TILE;
      const c = await sampleAt(api, x, y, `tile (${col}, ${row})`);
      const d = colorDistance(c, ref);
      if (d > max) max = d;
    }
  }
  return max;
}

// ---- Audio (reads the Web Audio cues the build actually schedules) ----------
//
// Deepcore's cues are produced `.wav` files (specs/assets.md) decoded and played through
// the Web Audio API (src/audio.ts), so the driver reports every source the build starts
// (see `api.audio`). The game must not autoplay: `Audio.resume()` builds the graph and
// starts decoding only on the first real user interaction (main.ts's `gesture()`), so
// before driving an event whose cue is checked, arm audio with a GENUINE browser gesture.
// A build may feed the debug API through a purely logical input path and unlock audio only
// from a real DOM event (a keydown OR a pointer), so arming uses both `api.userKey` and a
// corner `api.userClick` rather than a debug `press`/`keyDown` — those would leave a
// conformant build's AudioContext uncreated, so no cue would ever be scheduled though it
// plays fine for a real player. `KeyZ` has no game binding (src/input.ts) and (4, 4) sits in
// the top-left corner of the status bar — above `VIEWPORT_Y` so it is never part of the mine
// view, and left of every status-bar readout/button (the gauges start at x=16, the BAG/PAUSE/
// MUTE buttons at x>=1058) and every menu's centered buttons/panels — so arming never lands on
// a clickable and never disturbs game state, in the mine or on any menu.
//
// Unlike a synth cue scheduled inline, Deepcore's audio is QUEUED: play() calls land in
// `game.sndQueue`/`game.activeLoops` (the deterministic sim, which a validate-pass `step`
// advances instantly with no painted frame), and only the real, wall-clock-driven animation
// frame loop in main.ts drains that queue into actual `AudioBufferSourceNode`s. A settle after
// arming (letting the decode of the produced clips finish) and a short settle after driving a
// cue's event (letting one real frame drain the queue) are both real pauses — never simulation
// time — so they belong here rather than in `api.advance`.
export async function armAudio(api) {
  await api.userKey("KeyZ");
  await api.userClick(4, 4);
  // Let the first-gesture decode of the produced clips (Audio.resume(), an async
  // fetch + decodeAudioData per cue) finish before any cue is driven, so the very first
  // cue after arming is never dropped for landing before its buffer was ready.
  await api.settle(250);
}

/** The number of Web Audio sources the build has started so far. */
export async function audioCount(api) {
  return (await api.audio()).length;
}

/**
 * A real pause (never simulation time) long enough for one animation frame to drain a
 * just-queued cue (`game.sndQueue` / `game.activeLoops`) into an actual Web Audio source
 * (main.ts's per-frame `audio.play()` / `setLoop()` / `syncLoops()`). Call this in `act`,
 * after driving the event and before reading `audioCount` again.
 */
export async function drainAudioQueue(api) {
  await api.settle(60);
}

/**
 * ACT: wait for the build to start at least one NEW Web Audio source beyond `before`, polling in
 * real time up to `max` ms, and return the count actually reached (so an item can assert on it
 * exactly as it did on a single read).
 *
 * Use this rather than `drainAudioQueue` + one read for any cue that is not scheduled on the very
 * frame its trigger lands. A single 60 ms drain silently assumes every cue is ONE source started
 * immediately — true of a continuous looping buffer, but not of the two alarms. `specs/assets.md`
 * specifies the core-timer alarm as an "escalating countdown BEEP", i.e. a repeating one-shot
 * whose period shrinks as the timer runs down; a build that implements it that way — exactly as
 * specified — starts its next source somewhere inside that period, over a second away, and a
 * 60 ms read simply never sees it. The check then fails a conformant build for a sound that plays
 * perfectly well. Polling to a real deadline accepts BOTH shapes: a continuous loop is caught on
 * the first slice, a repeating beep within its period.
 *
 * The wait is real time in both passes, so the record pass films the alarm sounding rather than
 * cutting away before it does.
 */
export async function awaitCue(api, before, { max = 3000, slice = 60 } = {}) {
  let count = await audioCount(api);
  for (let spent = 0; spent < max && count <= before; spent += slice) {
    await api.settle(slice);
    count = await audioCount(api);
  }
  return count;
}
