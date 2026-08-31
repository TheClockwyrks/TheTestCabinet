// Meltdown — movers/sink-stacks: Sinks stack.
//
// `specs/heat.md` sums the Sink term over every Sink the emitter touches and says
// so outright: "Both stack: two Forges or two Sinks on one emitter add both
// flows." So a gun with a Sink on two of its faces loses the sum of the two, not
// the larger of them and not one of them twice.
//
// THE TWO SINKS ARE AT DIFFERENT LEVELS, and that is the whole design of this
// point. `specs/towers.md` puts the per-edge output at `16` at level I and `24` at
// level II, so on a gun at `70` the two drains are `16 * 2 * 0.70` and
// `24 * 2 * 0.70` — `0.1867` and `0.28` of a heat point over one frame. A build
// that adds both reads `0.4667`; a build that takes only the first Sink it finds
// reads `0.1867` or `0.28`; a build that finds one and doubles it reads `0.3733`
// or `0.56`. Two Sinks at the SAME level would leave the last of those
// indistinguishable from the right answer, which is why they differ here.
//
// AND THE SUM IS TAKEN OVER WHAT THE BUILD ITSELF READ. The two single-Sink legs
// are measured, not assumed, and the stacked leg is compared against their sum —
// so this point decides ADDITIVITY alone. A build whose output table is wrong
// fails `movers/sink-cools` and `movers/sink-output-scales` for that, and passes
// this one as long as it adds.
//
// THREE LEGS, ONE FLOOR, ONE FRAME: the same Arc at the same `70` three times
// over, differing only in which of its faces carry a Sink. Every other face
// carries a plain wall at that heat, which takes the air term to zero and leaves
// conduction at a gradient of zero, and one frame is short enough that no wall's
// own cooling reaches a subject (`movers/contact.ts`).

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import { type TowerType } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseBoxed, readHeat } from "./contact";

/** The gun read on all three legs, and the heat all three open at. */
const GUN: TowerType = "arc";
const HEAT = 70;

/** The two Sinks: different levels, so the total is a sum and not a doubling. */
const NORTH_LEVEL = 1;
const SOUTH_LEVEL = 2;

/**
 * How close the total must come to the sum of the parts, as decimal places.
 *
 * Three places is `0.0005`, half of one percent of the `0.0933` that separates
 * the right answer from the nearest wrong one — a build that finds the northern
 * Sink and doubles it. All three readings come out of one frame of the same
 * build's own arithmetic, so a build that adds lands on the sum to within float
 * slack.
 */
const HEAT_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("Sinks stack", async () => {
  await startRun(h);
  const north = await poseBoxed(
    h,
    { type: GUN, heat: HEAT },
    [{ type: "sink", side: "N", level: NORTH_LEVEL }],
    0,
  );
  const south = await poseBoxed(
    h,
    { type: GUN, heat: HEAT },
    [{ type: "sink", side: "S", level: SOUTH_LEVEL }],
    1,
  );
  const both = await poseBoxed(
    h,
    { type: GUN, heat: HEAT },
    [
      { type: "sink", side: "N", level: NORTH_LEVEL },
      { type: "sink", side: "S", level: SOUTH_LEVEL },
    ],
    2,
  );

  const openedNorth = await readHeat(h, north.id, "the northern Sink alone");
  const openedSouth = await readHeat(h, south.id, "the southern Sink alone");
  const openedBoth = await readHeat(h, both.id, "both Sinks");
  await h.advance(1);
  await captureStill(h, "stacked");
  const northLoss =
    openedNorth -
    (await readHeat(h, north.id, "the northern Sink alone, a frame on"));
  const southLoss =
    openedSouth -
    (await readHeat(h, south.id, "the southern Sink alone, a frame on"));
  const bothLoss =
    openedBoth - (await readHeat(h, both.id, "both Sinks, a frame on"));

  assertGreaterThan(
    northLoss,
    0,
    `the level-${NORTH_LEVEL} Sink alone really drains a ${GUN} at ${HEAT}`,
  );
  assertGreaterThan(
    southLoss,
    0,
    `the level-${SOUTH_LEVEL} Sink alone really drains a ${GUN} at ${HEAT}`,
  );
  assertCloseTo(
    bothLoss,
    northLoss + southLoss,
    HEAT_DIGITS,
    `the heat two Sinks take off one ${GUN} over a frame, against the ` +
      `${northLoss.toFixed(4)} and ${southLoss.toFixed(4)} each takes alone`,
  );
});
