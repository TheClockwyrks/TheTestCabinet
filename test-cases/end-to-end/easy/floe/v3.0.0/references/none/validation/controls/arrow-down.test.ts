// Floe — controls/arrow-down: `ArrowDown` alone hops the critter one row down.
//
// `specs/controls.md` binds `ArrowDown` to Down, and fixes what that action does on
// the `playing` screen: hop the critter one tile that way. `specs/hopping.md`
// fixes what an accepted hop leaves behind — the critter's centre on the target
// tile's centre exactly, one absolute tile of the strait from where it stood.
//
// ONE BINDING OF ONE DIRECTION, AND NOTHING ELSE. `ArrowDown` and `KeyS` are two
// keys bound to the same action, and each carries its own point, so a build that
// wired the arrows and left WASD dead is graded differently from one that wired
// neither, and a build that got three directions right keeps their three points.
// The cadence a held direction repeats at, the facing a hop takes, the row it
// scores and the five refusals are `hopping`'s items, not this one's: this point
// asks only which way `ArrowDown` moves the critter.
//
// THE KEY IS A REAL KEY. `hold`/`release` press it through Chromium's own input
// pipeline, so what reaches the build is a browser-trusted DOM key event on the
// real page rather than an event posed at whatever target a runtime happens to
// listen on. Under this engine that matters more than it would under one:
// `specs/instrumentation.md` puts the keyboard in the runtime layer the build
// itself supplies and gives the surface no keyboard operation at all, so the
// whole path from a physical key to a moved critter belongs to the build and
// every step of it is exercised here.
//
// THE WORLD IS POSED DOWN TO THE ONE HOP. `startCrossing` clears every vehicle,
// floe and bear and shuts the four world gates, and the critter is then posed on
// the ice band, which `specs/strait.md` makes solid ice the critter may stand on
// anywhere. With no vehicle on the strait none of `specs/hopping.md`'s refusals
// can bind on any of the four neighbours, so the hop's outcome is decided by the
// binding alone. The tile is off-centre in both axes on purpose: the four
// candidate targets are four DISTINCT tiles, so a build that read this key as
// one of the other three directions reads as that direction's tile rather than
// merely as "not the one expected".

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { tileCX, tileCY } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";

/**
 * The tile the critter is posed on, and the tile this key must take it to.
 *
 * Row 15 is inside the ice band (`ICE_TOP` 11 to `ICE_BOTTOM` 18), which
 * `specs/strait.md` makes solid ice, and every one of its four neighbours is
 * inside the grid and inside the band or the median, so no refusal
 * `specs/hopping.md` states can bind on a strait cleared of vehicles. Column 22
 * differs from the row, so a build that swapped the axes lands somewhere this
 * check names rather than somewhere it merely rejects.
 */
const POSE_COL = 22;
const POSE_ROW = 15;
const TARGET_COL = POSE_COL;
const TARGET_ROW = POSE_ROW + 1;

/**
 * The slack allowed on the landed centre, as `assertCloseTo` digits.
 *
 * `specs/hopping.md` says an accepted hop sets the critter's centre to the target
 * tile's centre EXACTLY, so the only honest tolerance is the arithmetic's own:
 * six digits is 5e-7 of a stage unit, about a sixty-millionth of a tile.
 */
const CENTRE_DIGITS = 6;

/**
 * Ticks recorded either side of the press, so the clip reads as a control rather
 * than as a critter that was already where it ended up.
 *
 * Neither is measured. Every reading below is taken on the tick the press was
 * delivered, before the trailing stretch runs; the stretch is past
 * `HOP_COOLDOWN` (0.12 s, 14.4 ticks at `TICK_HZ`) with nothing held, so the
 * clip also shows the critter staying put once the key is up.
 */
const REST_TICKS = 24; // 0.2 s of a still crossing before the key goes down
const SETTLE_TICKS = 24; // 0.2 s after it comes up, past HOP_COOLDOWN's 14.4

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hops the critter one row down when ArrowDown is pressed", async () => {
  await startCrossing(h);
  await h.debug.addCritter(POSE_COL, POSE_ROW);

  const posed = (await h.snapshot()).critter;
  assertEqual(posed.col, POSE_COL, "the pose put the critter on column 22");
  assertEqual(posed.row, POSE_ROW, "the pose put the critter on row 15");

  const landed = await captureReplay(h, "hop", async () => {
    await h.advance(REST_TICKS);
    // Down, one tick, up: the key is genuinely held while a tick runs, which is
    // the only press both conformant readings of a keyboard agree on.
    await h.tap("ArrowDown");
    const at = (await h.snapshot()).critter;
    await h.advance(SETTLE_TICKS);
    return at;
  });

  assertEqual(
    landed.row,
    TARGET_ROW,
    "ArrowDown hops the critter one row down (specs/controls.md)",
  );
  assertEqual(
    landed.col,
    POSE_COL,
    "and leaves its column where it was: a hop is one tile in one grid direction (specs/hopping.md)",
  );
  assertCloseTo(
    landed.x,
    tileCX(TARGET_COL),
    CENTRE_DIGITS,
    "the hop lands the centre on the target tile's centre (specs/hopping.md)",
  );
  assertCloseTo(
    landed.y,
    tileCY(TARGET_ROW),
    CENTRE_DIGITS,
    "the hop lands the centre on the target tile's centre (specs/hopping.md)",
  );
});
