// Wireworm — instrumentation/worm-stepping-gate: `setWormStepping(id, false)`
// holds a worm still, and holds nothing else.
//
// specs/instrumentation.md: "Gates the worm's step alone: the block test on the
// tile ahead, the charge it deals, the heading change, the dive it enters, and
// the head's advance. Off, the worm takes no step and the rest of the board runs
// on."
//
// WHY THE SUITE RESTS ON IT. This is the gate that lets a worm be posed as an
// OBSTACLE — a blocker for another worm's block test, or a target for a bolt —
// without it wandering into the scenario it was posed for. A build whose gate
// does nothing turns every one of those scenarios into a moving target, so the
// gate is proved here before anything leans on it.
//
// TWO WORMS, EACH ON A CLEAR ROW OF ITS OWN. The gated worm is the requirement;
// the second is the control that says the interval really elapsed, so a build
// that froze every worm cannot pass by freezing the one under test. Each is a
// single segment, so the body faculty has nothing to do and the reading is the
// head alone, and each row is empty for the whole sweep, so nothing but the gate
// can decide whether a head moves.
//
// A STEP IS COUNTED AS A CHANGE OF TILE, sampled every frame, rather than as a
// displacement in a direction. Which way the control worm winds is
// `worm.winds-horizontal`'s point; what this one counts is how many times a head
// moved at all, so a build with a correct gate and a crooked wind fails that
// point and passes this one.

import { afterEach, beforeEach, it } from "vitest";
import { wormStepInterval } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  headOf,
  poseWorm,
  sameTile,
  startPlaying,
  ticksFor,
  wormOf,
  type Harness,
  type TileSnapshot,
} from "../harness";

/** The two worms: the gated one, and the control that proves time passed. */
const GATED_C = 5;
const GATED_R = 5;
const FREE_C = 5;
const FREE_R = 12;

/** The intervals the item names, and how many steps that is. */
const INTERVALS = 10;

/**
 * Frames covering ten and a half of level 1's step intervals.
 *
 * specs/worm.md steps a worm each time its own clock reaches
 * `wormStepInterval(level)`, `0.14` s at level 1. Ten and a half intervals is
 * past the tenth step and half an interval short of the eleventh, so a clock that
 * carries its remainder honestly lands on exactly ten and the half-interval
 * margin absorbs the accumulated float of a hundred and seventy-odd frames.
 */
const SWEEP_TICKS = ticksFor(wormStepInterval(1) * (INTERVALS + 0.5));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes no step with stepping off while a worm with it on steps ten times", async () => {
  startPlaying(h);

  const gated = poseWorm(h, GATED_C, GATED_R);
  h.debug.setWormStepping(gated, false);
  const free = poseWorm(h, FREE_C, FREE_R);

  let gatedAt: TileSnapshot = headOf(wormOf(h.snapshot(), gated));
  let freeAt: TileSnapshot = headOf(wormOf(h.snapshot(), free));
  let gatedSteps = 0;
  let freeSteps = 0;

  for (let frame = 0; frame < SWEEP_TICKS; frame += 1) {
    await h.advance(1);
    const snapshot = h.snapshot();

    const gatedHead = headOf(wormOf(snapshot, gated));
    if (!sameTile(gatedHead, gatedAt)) {
      gatedSteps += 1;
      gatedAt = gatedHead;
    }

    const freeHead = headOf(wormOf(snapshot, free));
    if (!sameTile(freeHead, freeAt)) {
      freeSteps += 1;
      freeAt = freeHead;
    }
  }

  // The held worm beside the stepping one.
  captureStill(h, "gated");

  assertEqual(
    gatedSteps,
    0,
    `a worm with setWormStepping(id, false) takes no step over ` +
      `${String(INTERVALS)} step intervals (specs/instrumentation.md)`,
  );
  assertEqual(
    freeSteps,
    INTERVALS,
    `a worm with stepping on steps once per wormStepInterval, which is ` +
      `${String(INTERVALS)} steps over the same span (specs/worm.md)`,
  );
});
