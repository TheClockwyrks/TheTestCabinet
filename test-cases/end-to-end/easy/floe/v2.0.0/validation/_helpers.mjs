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

// The column each of the five goal bays is entered at (specs/playfield.md).
//
// THE NAMED COLUMN, NOT A CHOSEN PAIR. specs/playfield.md fixes the bays as five
// TWO-TILE openings along row 1, "centered near columns 4, 12, 20, 28, and 36",
// and a two-tile opening centered near column 4 is `[3, 4]` to one reader and
// `[4, 5]` to another. Both are the same sentence read correctly — the openings
// straddle the named column either way — and builds audited against this case have
// shipped each of them. A check that picks one pair and hops at its left column
// therefore decides a bay item on a one-tile reading the specification never made:
// against a build that read it the other way the hop lands on solid shore, is
// correctly refused, and every point that needed a bay — the fill, the level clear,
// the scoring, the respawn, the hunter's fair reset — fails for a reason that has
// nothing to do with what it was checking.
//
// What the two readings AGREE on is the named column itself: 4 lies in `[3, 4]` and
// in `[4, 5]`, and likewise for 12, 20, 28, and 36. So every check that needs to get
// INTO a bay enters at the named column and is right under either reading. WHERE a
// build put its openings is `bays.layout`'s own item, and the only one that should
// turn on it.
export const BAY_COL = [4, 12, 20, 28, 36];

// A far-shore column that is solid shore BETWEEN two bays under either reading
// above: column 8 sits three tiles clear of bay 0's opening (`[3, 4]` or `[4, 5]`)
// and three clear of bay 1's (`[11, 12]` or `[12, 13]`).
export const SHORE_COL = 8;

// The critter's hop cooldown (specs/controls.md: about 0.12 s), in ticks. 0.12 s is
// 14.4 ticks, which is not a whole tick count, so a scenario that needs to be PAST
// the cooldown rounds up: `HOP_COOLDOWN_TICKS` is the first whole tick at or past it
// and `HOP_TICKS` adds a margin on top, so a press always lands its hop.
export const HOP_COOLDOWN_TICKS = 15; // 0.125 s — the first whole tick past 0.12 s
export const HOP_TICKS = 18; // 0.15 s — a comfortable margin past the cooldown

// A beat either side of a single hop, so the clip of it is watchable.
//
// `act` IS the recording, so an item that opens on the press and closes 0.15 s later
// films 0.15 s: about nine frames, in which the critter is already where it ended up.
// The hop is correct and the reviewer cannot see it. These two spans put the posed
// tile on camera before the press and hold on the landing after it, which costs the
// verdict nothing — the reading either side of the press is unchanged, and the pocket
// is solid, hazard-free ice that nothing moves across.
export const HOP_LEAD_TICKS = 72; // 0.6 s of the posed tile before the press
export const HOP_TAIL_TICKS = 108; // 0.9 s holding on the landing

// ---- Preconditions (arrange; route through the real systems) ----------------
//
// These pose the world with control ops and consume no time, so they are callable
// straight from `arrange` and need no act half.

/** Reset to the title and begin a fresh run, as choosing CROSS from the menu. */
export async function startCrossing(api, seed) {
  await api.reset(seed === undefined ? undefined : { seed });
  await api.call("startGame");
}

/**
 * ARRANGE half of an item that has to begin on a particular level: reset to a known
 * state, pose `level`, and confirm the build did what posing a level is specified to
 * do. Returns `{ began }` for the item to assert, and leaves a LIVE crossing behind
 * either way.
 *
 * POSING A LEVEL IS SPECIFIED TO START ONE. specs/instrumentation.md: `setLevel(level)`
 * "sets the current level and rebuilds the strait for it …, beginning a fresh crossing
 * at that level". A build can do every part of that except the last — rebuild the
 * lanes, reset the bays, spawn the critter — and leave the game sitting on the title
 * screen, and one audited against this case does exactly that. Nothing then advances
 * (a menu screen does not step), so the whole scenario plays out behind the main menu:
 * every later assertion fails, and the clip a reviewer opens is a picture of the menu
 * with no hint of why.
 *
 * So the pose is checked rather than assumed, and recovered from rather than abandoned:
 * a build that did not start the crossing is started explicitly and the level posed
 * again, which puts the item back on its own subject. The `began` flag is what carries
 * the contract breach, as one named assertion, instead of it surfacing as an unrelated
 * item reporting `screen: "title"`.
 */
export async function arrangeLevel(api, level) {
  await api.reset();
  await api.call("setLevel", level);
  const began = (await api.snapshot()).screen === "playing";
  if (!began) {
    await api.call("startGame");
    await api.call("setLevel", level);
  }
  return { began };
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
 * The bear is taken off the board as part of the pose, which delays the hunt but does
 * NOT hold it off for the whole clip: the critter is posed well up the board, so it
 * counts as having advanced and the bear re-emerges from the near shore partway through
 * (measured at 0.6 s on the reference implementation, and almost at once on one of the
 * builds this was audited against). What actually keeps a controls item from being
 * decided by a hunter is the DISTANCE: the pocket sits eight rows above the near shore
 * and the bear closes at about 3 tiles/second (specs/hunter.md), so it cannot reach the
 * critter inside the ~1.65 s this item films. Lengthen `HOP_LEAD_TICKS` /
 * `HOP_TAIL_TICKS` much beyond that and this stops being true — that margin, not the
 * removal, is the thing to check against.
 *
 * ARRANGE half of a single-direction controls check; pair with `actHopOnce`.
 */
export async function hopPocket(api) {
  await startCrossing(api);
  await api.call("setBear", 0, null);
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
 * WHICH IS WHY IT LINGERS. The reading is over in `ticks` — one press and the cooldown
 * — but a recording that is only `ticks` long shows the critter already landed. So the
 * run opens on the posed tile for `lead` and holds on the landing for `tail`, with the
 * measured press in between. The two spans are pure camera time: `before` is still read
 * on the tick of the press and `after` still on the tick the hop completed, so the four
 * assertions see exactly what they saw when the clip was 0.15 s long. The pocket is
 * cleared, solid ice with the bear off the board (`hopPocket`), so nothing can reach the
 * critter while the camera waits.
 *
 * Pair with `arrangeHop` / `hopPocket`. Returns `{ before, after }` — `before` is the
 * critter before the press, `after` is the WHOLE snapshot afterwards (the assertions
 * read `screen` and `phase` off it as well as the critter's tile).
 */
export async function actHopOnce(
  api,
  code,
  { ticks = HOP_TICKS, lead = HOP_LEAD_TICKS, tail = HOP_TAIL_TICKS } = {},
) {
  await api.advance(lead); // camera only: the posed tile, before anything is pressed
  const before = (await api.snapshot()).critter;
  await api.call("press", code);
  await api.advance(ticks); // 18 ticks = the old 0.15 s, just past the hop cooldown
  const after = await api.snapshot();
  await api.advance(tail); // camera only: hold on where the hop landed
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

// ---- Lanes (reading what a lane is carrying, and where) ---------------------

/** The ice lane at strait row `row`, from a snapshot. */
export function iceLaneAt(snap, row) {
  return ((snap.lanes && snap.lanes.ice) || []).find((l) => l.row === row);
}

/**
 * Whether anything in `lane` currently covers the tile at column `col`.
 *
 * A lane item is reported by its left edge in strait-local pixels and its length in
 * tiles (specs/instrumentation.md), and it slides continuously — so it overlaps a
 * tile whenever the two spans intersect at all, which is the same span a build has to
 * test to decide whether the tile is occupied.
 */
export function laneCovers(lane, col) {
  const left = col * TILE;
  return ((lane && lane.items) || []).some(
    (item) => item.x < left + TILE && left < item.x + item.len * TILE,
  );
}

/**
 * Whether something in `lane` covers the WHOLE tile at column `col` — its span
 * contains the tile's span outright, with nothing of the tile left over.
 *
 * WHICH IS WHAT A CHECK POSING AN OCCUPIED TILE MUST WAIT FOR. Nothing in
 * specs/hazards.md fixes how much of a tile a sliding vehicle has to be over before
 * the tile counts as occupied, and builds reasonably differ: one takes any overlap at
 * all, another insets the tile by a few pixels so a vehicle grazing the edge does not
 * count, another asks about the tile's centre. A scenario that fires the moment
 * {@link laneCovers} first turns true is therefore posed on the one reading where the
 * answer is contested — the vehicle is a pixel onto the tile — and a build that
 * (legitimately) does not count that as occupied lets the hop through and fails an
 * item about refusing it. Waiting for the whole tile puts the scenario where every
 * reading agrees, which is the only place a verdict about the RULE can be read.
 */
export function laneCoversWhole(lane, col) {
  const left = col * TILE;
  return ((lane && lane.items) || []).some(
    (item) => item.x <= left && item.x + item.len * TILE >= left + TILE,
  );
}

// ---- Refused hops (the blocking rules, on camera) ---------------------------
//
// A REFUSED HOP IS A NON-EVENT ON CAMERA. Every Movement item ends with the critter
// exactly where it started, so a clip that opens on the press and closes a tenth of
// a second later is a still of a critter that never moved: nothing shows that a hop
// was attempted, nothing shows what blocked it, and a reviewer cannot tell the check
// from a build that ignored the key. The three spans below put the posed tile on
// camera first, hold the direction down long enough that the attempt reads as a
// deliberate, repeated shove against the block, and then hold on the critter still
// standing where it was. None of it touches a verdict: the reading is taken on the
// tick the key comes back up, exactly as it was when the clip was 0.15 s long.
export const REFUSE_LEAD_TICKS = 60; // 0.5 s of the posed tile before the key goes down
export const REFUSE_HOLD_TICKS = 72; // 0.6 s held: attempted, and refused, throughout
export const REFUSE_TAIL_TICKS = 72; // 0.6 s holding on the critter that did not move

/**
 * ACT half of a refusal check: hold `code` down across the posed block so the hop is
 * attempted (and, on a build that auto-repeats a held key, re-attempted) rather than
 * tapped once, and return the snapshot taken as the key comes back up.
 *
 * The hold is camera time and margin, not a second assertion: one press is all the
 * rule needs, and a build that auto-repeats simply refuses the same hop several times
 * over. Pair the returned snapshot with whatever the item asserts about it.
 */
export async function actRefusedHop(
  api,
  code,
  {
    lead = REFUSE_LEAD_TICKS,
    hold = REFUSE_HOLD_TICKS,
    tail = REFUSE_TAIL_TICKS,
  } = {},
) {
  await api.advance(lead); // camera only: the posed tile, before anything is pressed
  await api.call("keyDown", code);
  await api.advance(hold);
  await api.call("keyUp", code);
  const after = await api.snapshot();
  await api.advance(tail); // camera only: the critter still standing where it was
  return after;
}

// ---- Re-posing mid-clip (control ops that may take the clock) ---------------

/**
 * ACT-phase control op that leaves the build on the clock it was already on.
 *
 * SOME BUILDS TAKE THE CLOCK WHEN THEY ARE RE-POSED. specs/instrumentation.md gives
 * exactly two operations that switch the game to manual stepping — `reset` and `step` —
 * and `setAutoStep(true)` is the only way back. But a build can wire the flag into more
 * than that: one audited against this case clears it inside `setLevel` and `startGame`
 * too. In the VALIDATE pass that is harmless, since the runtime is stepping the
 * simulation itself. In the RECORD pass it is not: `act` is filmed with the build
 * driving itself from the wall clock, so an op that quietly switches it back to manual
 * stops the game dead and everything after it films a still frame. The verdict is
 * unaffected (it was decided in the other pass), which is what makes it insidious — the
 * item passes and hands a reviewer a clip of a frozen strait.
 *
 * `api.skip` already hands the clock back after itself, in the record pass and only
 * there (see `packages/browser-driver/validation.mjs`), so a zero-tick skip is a
 * no-op that restores whichever clock the pass is supposed to be on. Use this for any
 * control op driven from `act` that re-poses the run itself; the ops that merely place
 * things (`setLane`, `placeCritter`, `setBear`, …) need nothing.
 *
 * Whether a build should be taking the clock at all is
 * `controls.advances-in-real-time`'s item, and it fails the build that does.
 */
export async function actPose(api, name, ...args) {
  await api.call(name, ...args);
  await api.skip(0);
}

// ---- Footing (read after the simulation has run the tile) -------------------

/**
 * ACT half of a footing read: the ground under the critter, read after the simulation
 * has run `ticks` on the tile it is standing on. Returns `null` if the build has no
 * critter on the board to read.
 *
 * FOOTING IS A STEPPED READING, NOT A PLACEMENT'S RETURN VALUE. The tempting read is
 * `snapshot()` straight after `placeCritter`, and it races the contract.
 * specs/instrumentation.md describes `placeCritter` as positioning the critter "through
 * the same placement normal respawns use. From THERE `step` runs the real footing,
 * drift, and collision on that tile" — so a build is free to derive footing in the
 * simulation step that follows the placement, which is exactly where the rest of that
 * tile's consequences (the drift, the drowning, the crush) are decided too. Read
 * before any step, such a build reports the footing of wherever the critter was
 * standing a moment ago, and an item that gates on it fails a build whose footing is
 * correct on every step a player could ever observe — while the rule the item exists
 * to check (that open water drowns, that a floe carries) passes right beside it.
 *
 * One tick is enough: it is the smallest amount of simulation there is, and after it
 * the reading means the same thing on every build.
 */
export async function actFooting(api, { ticks = 1 } = {}) {
  await api.advance(ticks);
  const s = await api.snapshot();
  return s.critter ? s.critter.footing : null;
}

// ---- Death (read as the life the spec says it costs) ------------------------

/**
 * ACT half of every death check: advance until the critter has died, and return the
 * same `{ snap, hit, spent }` as `api.until`. `livesBefore` is the life count read
 * before the act began (instantly, from `arrange` or the top of `act`).
 *
 * A DEATH IS READ AS THE LIFE IT COSTS, NOT AS A `dying` PHASE. The tempting sweep is
 * `until((s) => s.phase === "dying")`, and it is wrong. Nothing in the specs says when
 * `phase` is `dying`: specs/instrumentation.md lists it among the values `phase` can
 * take and stops there, and specs/gameplay.md defines a death only by what it COSTS —
 * "the current crossing ends, the bear is removed, and a fresh critter respawns on the
 * near shore with the timer reset". The one pause it mandates is the spawn-in pause
 * before the BEAR re-emerges, not a window in which the game holds the dead critter on
 * screen. A build that resolves the death the instant it happens — decrement, reset the
 * crossing, carry on — meets every word of that and simply never reports `dying`. Sweep
 * for the phase against such a build and the sweep spends its whole budget looking for a
 * state that came and went inside one tick (or never existed), so a death that plainly
 * happened reads as no death at all, and it does it to a build that plays correctly.
 *
 * `lives` decrementing is the fact the spec actually mandates, it is in the snapshot
 * contract, and it means the same thing whatever a build does with its sub-phases. The
 * `gameover` clause covers the last life — at zero the run ends (specs/gameplay.md) and
 * a build may report that rather than a decrement — so this reads "the critter died",
 * not "the critter died and lived".
 *
 * The tell that a check has this backwards is a verdict where the `dying` assertion
 * fails and the `lives` assertion beside it passes: the death happened, the reading
 * of it did not.
 */
export async function actUntilDeath(
  api,
  livesBefore,
  { max = 240, poll = TICK } = {},
) {
  return api.until((s) => s.lives < livesBefore || s.screen === "gameover", {
    max,
    poll,
  });
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
