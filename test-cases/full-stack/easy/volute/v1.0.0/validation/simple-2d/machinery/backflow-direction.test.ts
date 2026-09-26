// machinery/backflow-direction — backflow carries every core back toward the inlet.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("The four kinds"): "`backflow` |
// Every core moves toward the inlet at `BACKFLOW_SPEED` (`60`) units/s, and the
// inlet emits nothing | `5` s", and ("Backflow") "While backflow is active every
// core on the channel moves toward the inlet at `BACKFLOW_SPEED`, in place of
// the advance it would otherwise make, whatever segment it belongs to, whatever
// the feed speed, and whatever recoil hold it carries." Arc positions fall, so
// over 30 ticks — half a second at the 1 / 60 s tick `specs/instrumentation.md`
// fixes — every core stands 30 units lower than it was posed.
//
// WHY THE HEAD IS AT 2000. "Each core stops at the channel spacing ahead of the
// core behind it, and the tail core stops at arc position `0`." The posed
// segment's tail sits at 2000 - 3 x 28 = 1916, so nothing in the drive comes
// near the pack the spec describes and the reading is the rate alone. Every core
// of the segment is read, not just the head, because the requirement is about
// every core; `poseHall` holds the inlet so it adds none.
//
// THE TOLERANCE. One tick of backflow travel is 60 / 60 = 1 unit exactly, which
// is the +/- 1 the review item states: it covers a build that begins the motion
// on the tick after the grant and nothing looser. A build that carries the train
// the other way lands 30 units off in the other direction, and one that uses the
// feed speed instead lands 41 units away, so a tick of slack still separates
// every wrong rule from the right one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BACKFLOW_SPEED, SPACING, TICK_DT, TICK_HZ } from "../constants";
import {
  arcPositions,
  captureReplay,
  createHarness,
  poseHall,
  seconds,
  spacedRun,
  type Harness,
} from "../harness";

/** The level the drive opens on; backflow ignores the feed speed either way. */
const LEVEL = 1;

/** The posed segment's head, far enough out that the tail never reaches the inlet. */
const HEAD_S = 2000;

/** One segment of four, spaced as `specs/channel.md` spaces a segment. */
const CORES = spacedRun(HEAD_S, ["halide", "sulfur", "cobalt", "garnet"]);

/** Half a second of simulated time, the span the motion is read over. */
const MEASURE_TICKS = TICK_HZ / 2;

/** Further ticks recorded after the reading; 90 ticks is still inside the 5 s run. */
const TRAILING_TICKS = TICK_HZ;

/** How far toward the inlet {@link MEASURE_TICKS} of backflow carries a core. */
const EXPECTED_FALL = BACKFLOW_SPEED * seconds(MEASURE_TICKS);

/** One tick of backflow travel, which is the review item's +/- 1 unit. */
const FALL_TOL = BACKFLOW_SPEED * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`carries every core ${EXPECTED_FALL} units back over ${MEASURE_TICKS} ticks of backflow`, async () => {
  await poseHall(h, { level: LEVEL, cores: CORES, machinery: "backflow" });
  const before = arcPositions(await h.snapshot());

  const after = await captureReplay(h, "backflow", async () => {
    const measured = await h.step(MEASURE_TICKS);
    await h.step(TRAILING_TICKS);
    return measured;
  });

  const moved = arcPositions(after);
  assertEqual(
    moved.length,
    CORES.length,
    "the cores on the channel after backflow carried them back",
  );
  for (let i = 0; i < moved.length; i += 1) {
    assertNear(
      before[i] - moved[i],
      EXPECTED_FALL,
      FALL_TOL,
      `arc given up by the core ${i * SPACING} units behind the head`,
    );
  }
});
