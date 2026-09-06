// Wireworm — instrumentation/render-free-core: the simulation advances on the
// elapsed time it is handed, and on nothing else.
//
// specs/instrumentation.md "A render-free core": every rate is integrated
// against the delta time the game is given, so an interval of game time reaches
// the same state however it was divided into frames — and the dependency runs one
// way, the simulation reading nothing from the renderer. specs/worm.md states the
// one clocked quantity, the worm's tile step, under the accumulate-and-carry rule
// that makes it obey the same property: a frame covering several intervals runs
// several steps in order and the remainder carries into the next frame.
//
// ONE SECOND, TWO DIVISIONS. The same second of game time is covered as a single
// 1000 ms frame and as sixty 1000/60 ms frames, over the same posed board, and the
// two must agree on both readings the item names:
//
//   - `simTime`, which specs/instrumentation.md accumulates from every update's
//     delta, gains 1.0 in each;
//   - the worm's head is on the same tile in each.
//
// WHY A WORM. It is the one thing in this game that does not move continuously,
// so it is the reading that separates a genuine accumulate-and-carry clock from a
// step taken once per frame: a per-frame stepper would move once under the single
// frame and sixty times under the sixty, and a clock that dropped its remainder
// would drift between the two. The worm is posed with its body gated off, so one
// tile moves and the reading is the head alone, on an empty board where nothing
// can block it.
//
// WHICH tile the two agree on is `worm.winds-horizontal`'s point and is not
// asserted here. What is asserted is that they agree, and that the worm moved at
// all — two runs that both stood still would agree vacuously.

import { ConstantClock } from "@clockwyrks/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  headOf,
  poseWorm,
  sameTile,
  startPlaying,
  wormOf,
  type Harness,
  type TileSnapshot,
} from "../harness";

/** The second of game time both runs cover, and the two ways it is divided. */
const SPAN_S = 1;
const ONE_FRAME_MS = SPAN_S * 1000;
const SIXTY_FRAMES = 60;
const SIXTY_FRAME_MS = ONE_FRAME_MS / SIXTY_FRAMES;

/**
 * Where the worm is posed: a clear row, far enough from the right edge that a
 * second of level-1 stepping (`0.14` s each, so seven steps) cannot reach it and
 * turn the run into a reading of the board's edge instead.
 */
const WORM_C = 5;
const WORM_R = 5;

/**
 * The tolerance on the second `simTime` gained.
 *
 * Six decimal places. Each run is handed exactly `SPAN_S` seconds by its own
 * constant clock, so anything past float noise is a build accumulating something
 * other than the delta it was given.
 */
const EXACT = 6;

let one: Harness;
let sixty: Harness;

beforeEach(async () => {
  one = await createHarness({ clock: new ConstantClock(ONE_FRAME_MS) });
  sixty = await createHarness({ clock: new ConstantClock(SIXTY_FRAME_MS) });
});

afterEach(() => {
  one?.dispose();
  sixty?.dispose();
});

it("reaches the same simTime and the same tile however the second is divided", async () => {
  /** Pose the board, cover one second, and answer what the run reached. */
  const cover = async (
    h: Harness,
    frames: number,
  ): Promise<{ gained: number; posed: TileSnapshot; head: TileSnapshot }> => {
    startPlaying(h);
    const id = poseWorm(h, WORM_C, WORM_R);
    h.debug.setWormBody(id, false);

    const opened = h.snapshot();
    const posed = headOf(wormOf(opened, id));
    await h.advance(frames);
    const closed = h.snapshot();
    return {
      gained: closed.simTime - opened.simTime,
      posed,
      head: headOf(wormOf(closed, id)),
    };
  };

  const asOne = await cover(one, 1);
  const asSixty = await cover(sixty, SIXTY_FRAMES);
  // The board after one second of game time, as the sixty-frame run drew it.
  captureStill(sixty, "stepped");

  assertCloseTo(
    asOne.gained,
    SPAN_S,
    EXACT,
    "one second covered as a single frame adds 1.0 to simTime",
  );
  assertCloseTo(
    asSixty.gained,
    SPAN_S,
    EXACT,
    "one second covered as sixty frames adds 1.0 to simTime",
  );

  // Neither run stood still, so the agreement below is an agreement about
  // something that happened.
  assertEqual(
    sameTile(asOne.head, asOne.posed),
    false,
    "a second of game time covered as one frame steps the worm (specs/worm.md)",
  );
  assertEqual(
    sameTile(asSixty.head, asSixty.posed),
    false,
    "a second of game time covered as sixty frames steps the worm " +
      "(specs/worm.md)",
  );

  assertDeepEqual(
    asSixty.head,
    asOne.head,
    "one second of game time leaves the worm on the same tile whether it was " +
      "covered as one frame or as sixty (specs/instrumentation.md)",
  );
});
