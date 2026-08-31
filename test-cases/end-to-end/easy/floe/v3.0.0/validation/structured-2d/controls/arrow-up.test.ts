// Floe — controls/arrow-up: `ArrowUp` alone hops the critter one row up.
//
// `specs/controls.md` binds `ArrowUp` to the `up` action, and fixes what that
// action does on the `playing` screen: hop the critter one tile that way.
// `specs/hopping.md` fixes what an accepted hop leaves behind — the critter's
// centre on the target tile's centre exactly, one absolute tile of the strait
// from where it stood.
//
// ONE BINDING OF ONE DIRECTION, AND NOTHING ELSE. `ArrowUp` and `KeyW` are two
// keys bound to the same action, and each carries its own point, so a build that
// wired the arrows and left WASD dead is graded differently from one that wired
// neither, and a build that got three directions right keeps their three points.
// The cadence a held direction repeats at, the facing a hop takes, the row it
// scores and the five refusals are `hopping`'s items, not this one's: this point
// asks only which way `ArrowUp` moves the critter.
//
// THE KEY IS A REAL KEY, AND THE WHOLE BINDING IS ON THE ROUTE. Under this engine
// the game never reads a `KeyboardEvent`: `specs/controls.md` has it register the
// eight named actions with the keys bound to them and read the actions back
// through its own controller, and `specs/instrumentation.md` gives the surface no
// keyboard operation at all. So this check dispatches the physical key at the
// event target the engine listens on and nothing else — the engine's binding of
// `ArrowUp` to `up`, its edge and hold detection, and the build's reading of
// that action are every step between the key and the moved critter, and all of
// them are exercised here. A build that registered `up` without `ArrowUp`
// among its keys fails exactly this point.
//
// THE PRESS IS DOWN, ONE WHOLE FRAME, UP. `specs/controls.md` reads the four
// movement actions as HELD on the `playing` screen and `specs/hopping.md` fixes
// that a press released before the cooldown reaches `0` produces exactly one hop,
// so a key genuinely down while a frame runs is the one press both readings of a
// direction agree on: a build reading the action's held value and a build reading
// its press edge each see exactly one request, because the engine closes the
// input frame once that frame has rendered. `HOP_COOLDOWN` is `0.12` s — `14.4`
// ticks — and the harness's clock puts one tick in a frame, so no second hop can
// follow inside the frame the key was down for.
//
// THE WORLD IS POSED DOWN TO THE ONE HOP. `startCrossing` clears every vehicle,
// floe and bear and shuts the four world gates, and the critter is then posed on
// the ice band, which `specs/strait.md` makes solid ice the critter may stand on
// anywhere. With no vehicle on the strait none of `specs/hopping.md`'s refusals
// can bind on any of the four neighbours, so the hop's outcome is decided by the
// binding alone. The tile is off-centre in both axes on purpose: the four
// candidate targets are four DISTINCT tiles, so a build that read this key as one
// of the other three directions reads as that direction's tile rather than merely
// as "not the one expected".

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { tileCX, tileCY } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  holdFor,
  startCrossing,
  type Harness,
} from "../harness";

/** The key this point decides, named literally: it is the whole of the point. */
const KEY = "ArrowUp";

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
const TARGET_ROW = POSE_ROW - 1;

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
 * Neither is measured. Every reading below is taken on the frame the key was held
 * for, before the trailing stretch runs; that stretch is past `HOP_COOLDOWN`
 * (`0.12` s, 14.4 ticks at `TICK_HZ`) with nothing held, so the clip also shows
 * the critter staying put once the key is up.
 */
const REST_TICKS = 24; // 0.2 s of a still crossing before the key goes down
const SETTLE_TICKS = 24; // 0.2 s after it comes up, past HOP_COOLDOWN's 14.4

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("hops the critter one row up when ArrowUp is pressed", async () => {
  startCrossing(h);
  h.debug.addCritter(POSE_COL, POSE_ROW);

  const posed = h.snapshot().critter;
  assertEqual(posed.col, POSE_COL, "the pose put the critter on column 22");
  assertEqual(posed.row, POSE_ROW, "the pose put the critter on row 15");

  const landed = await captureReplay(h, "hop", async () => {
    await h.advance(REST_TICKS);
    await holdFor(h, KEY, 1);
    const at = h.snapshot().critter;
    await h.advance(SETTLE_TICKS);
    return at;
  });

  assertEqual(
    landed.row,
    TARGET_ROW,
    "ArrowUp hops the critter one row up (specs/controls.md)",
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
