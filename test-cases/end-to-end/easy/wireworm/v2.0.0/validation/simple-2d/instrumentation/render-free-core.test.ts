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
// ONE SECOND, TWO DIVISIONS, ONE FIGURE. The same second of game time is covered
// as a single 1000 ms frame and as sixty 1000/60 ms frames, over the same posed
// board, and each run is held to what the specs fix for that second:
//
//   - `simTime`, which specs/instrumentation.md accumulates from every update's
//     delta, gains 1.0;
//   - the worm's head stands `floor(1 / WORM_STEP_L1)` tiles along its row: at
//     level 1 a step is `0.14` s, so seven whole steps with `0.02` s carried.
//
// The two runs are never compared with each other; the figure is the spec's.
//
// WHY A WORM. It is the one thing in this game that does not move continuously,
// so it is the reading that separates a genuine accumulate-and-carry clock from a
// step taken once per frame: a per-frame stepper would move one tile under the
// single frame and sixty under the sixty, and a clock that dropped its remainder
// would fall short under the sixty. The worm is posed with its body gated off, so
// one tile moves and the reading is the head alone, on an empty row far from the
// right edge, where nothing can block it and no turn is reached.

import { ConstantClock } from "@clockwyrks/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../constants";
import { assertCloseTo, assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  headOf,
  poseWorm,
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
 * second of level-1 stepping cannot reach it and turn the run into a reading of
 * the board's edge instead.
 */
const WORM_C = 5;
const WORM_R = 5;

/**
 * The whole steps a level-1 worm takes inside the span: seven, at WORM_STEP_L1
 * (0.14 s) each, with the remainder carried (specs/worm.md).
 */
const STEPS_IN_SPAN = Math.floor(SPAN_S / WORM_STEP_L1);

/** Where the head stands after the span: STEPS_IN_SPAN tiles along its row. */
const EXPECTED_HEAD: TileSnapshot = { c: WORM_C + STEPS_IN_SPAN, r: WORM_R };

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

it("reaches the simTime and the tile the specs fix however the second is divided", async () => {
  /** Pose the board, cover one second, and answer what the run reached. */
  const cover = async (
    h: Harness,
    frames: number,
  ): Promise<{ gained: number; head: TileSnapshot }> => {
    startPlaying(h);
    const id = poseWorm(h, WORM_C, WORM_R);
    h.debug.setWormBody(id, false);

    const opened = h.snapshot();
    await h.advance(frames);
    const closed = h.snapshot();
    return {
      gained: closed.simTime - opened.simTime,
      head: headOf(wormOf(closed, id)),
    };
  };

  /** Hold one run to the second it was given and the tile the specs fix. */
  const check = (
    run: { gained: number; head: TileSnapshot },
    frames: number,
  ) => {
    const division = `${frames} frame${frames === 1 ? "" : "s"}`;
    assertCloseTo(
      run.gained,
      SPAN_S,
      EXACT,
      `one second covered as ${division} adds 1.0 to simTime ` +
        `(specs/instrumentation.md)`,
    );
    assertDeepEqual(
      run.head,
      EXPECTED_HEAD,
      `one second covered as ${division} carries a level-1 worm's head ` +
        `${STEPS_IN_SPAN} tiles along its row from (${WORM_C}, ${WORM_R}) — a ` +
        `step is WORM_STEP_L1 (${WORM_STEP_L1} s) and the step clock carries ` +
        `its remainder (specs/worm.md)`,
    );
  };

  const asOne = await cover(one, 1);
  const asSixty = await cover(sixty, SIXTY_FRAMES);
  // The board after one second of game time, as the sixty-frame run drew it.
  captureStill(sixty, "stepped");

  check(asOne, 1);
  check(asSixty, SIXTY_FRAMES);
});
