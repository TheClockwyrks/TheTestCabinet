// Meltdown — movers/forge-stacks: Forges stack.
//
// `specs/heat.md` sums the Forge term over every Forge the emitter touches and
// says so outright: "Both stack: two Forges or two Sinks on one emitter add both
// flows." So a gun with a Forge on two of its faces takes the sum of the two, not
// the larger of them and not one of them twice.
//
// THE TWO FORGES ARE AT DIFFERENT LEVELS, and that is the whole design of this
// point. `specs/towers.md` puts the setpoint at `72` at level I and `84` at level
// II, so on a gun at `20` the two flows are `0.9 * 2 * 52` and `0.9 * 2 * 64` —
// `0.78` and `0.96` of a heat point over one frame. A build that adds both reads
// `1.74`; a build that takes only the first Forge it finds reads `0.78` or
// `0.96`; a build that finds one and doubles it reads `1.56` or `1.92`. Two
// Forges at the SAME level would leave the last of those indistinguishable from
// the right answer, which is why they differ here.
//
// AND THE SUM IS TAKEN OVER WHAT THE BUILD ITSELF READ. The two single-Forge
// legs are measured, not assumed, and the stacked leg is compared against their
// sum — so this point decides ADDITIVITY alone. A build whose `FORGE_K` or whose
// setpoint table is wrong fails `movers/forge-warms` and
// `movers/forge-setpoint-scales` for that, and passes this one as long as it
// adds.
//
// THREE LEGS, ONE FLOOR, ONE FRAME: the same Arc at the same `20` three times
// over, differing only in which of its faces carry a Forge. Every other face
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
const HEAT = 20;

/** The two Forges: different levels, so the total is a sum and not a doubling. */
const NORTH_LEVEL = 1;
const SOUTH_LEVEL = 2;

/**
 * How close the total must come to the sum of the parts, as decimal places.
 *
 * Two places is `0.005`, under three percent of the `0.18` that separates the
 * right answer from the nearest wrong one — a build that finds the northern
 * Forge and doubles it. All three readings come out of one frame of the same
 * build's own arithmetic, so a build that adds lands on the sum to within float
 * slack.
 */
const HEAT_DIGITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("Forges stack", async () => {
  await startRun(h);
  const north = await poseBoxed(
    h,
    { type: GUN, heat: HEAT },
    [{ type: "forge", side: "N", level: NORTH_LEVEL }],
    0,
  );
  const south = await poseBoxed(
    h,
    { type: GUN, heat: HEAT },
    [{ type: "forge", side: "S", level: SOUTH_LEVEL }],
    1,
  );
  const both = await poseBoxed(
    h,
    { type: GUN, heat: HEAT },
    [
      { type: "forge", side: "N", level: NORTH_LEVEL },
      { type: "forge", side: "S", level: SOUTH_LEVEL },
    ],
    2,
  );

  const openedNorth = await readHeat(h, north.id, "the northern Forge alone");
  const openedSouth = await readHeat(h, south.id, "the southern Forge alone");
  const openedBoth = await readHeat(h, both.id, "both Forges");
  await h.advance(1);
  await captureStill(h, "stacked");
  const northGain =
    (await readHeat(h, north.id, "the northern Forge alone, a frame on")) -
    openedNorth;
  const southGain =
    (await readHeat(h, south.id, "the southern Forge alone, a frame on")) -
    openedSouth;
  const bothGain =
    (await readHeat(h, both.id, "both Forges, a frame on")) - openedBoth;

  assertGreaterThan(
    northGain,
    0,
    `the level-${NORTH_LEVEL} Forge alone really warms a ${GUN} at ${HEAT}`,
  );
  assertGreaterThan(
    southGain,
    0,
    `the level-${SOUTH_LEVEL} Forge alone really warms a ${GUN} at ${HEAT}`,
  );
  assertCloseTo(
    bothGain,
    northGain + southGain,
    HEAT_DIGITS,
    `the heat two Forges add to one ${GUN} over a frame, against the ` +
      `${northGain.toFixed(4)} and ${southGain.toFixed(4)} each adds alone`,
  );
});
