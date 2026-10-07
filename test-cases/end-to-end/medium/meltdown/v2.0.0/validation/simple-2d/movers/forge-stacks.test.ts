// Meltdown — movers/forge-stacks: two Forges on one gun add both flows.
//
// specs/heat.md sums the Forge term over every Forge an emitter touches —
// "`forgeGain(T) = FORGE_K * sharedEdges(T, F) * max(0, setpoint(F) - H_T)`,
// summed over every Forge `F` that `T` touches" — and says it again in words:
// "Both stack: two Forges or two Sinks on one emitter add both flows."
//
// THE ARRANGEMENT. One Arc with a Forge flush against its north face and another
// flush against its south face. Each abuts it along two edge-tiles, so the two
// contacts are identical and the second Forge must be worth exactly what the first
// is: a cold Arc between them gains `0.9 * 4 * 72` a second, which is `259.2`,
// where one Forge alone gains `129.6`.
//
// OPPOSITE FACES RATHER THAN ADJACENT ONES, so the two Forges do not touch each
// other. Movers "neither conduct with an emitter nor exchange with each other"
// (specs/heat.md), so a pair that met would change nothing in a conformant build —
// but it would put a contact in the scenario that nobody asked about, and a build
// that got that wrong would fail this item rather than the one that owns it.
//
// THE READING IS THE SECOND FORGE'S WORTH, NOT THE PAIR'S TOTAL, so what it decides
// is stacking alone: the single-Forge leg is measured on the same build in the same
// arrangement, and the pair is held against twice it. A build whose Forge is
// altogether wrong fails `movers/forge-warms` on the figure and is graded here only
// on whether its second Forge counted. What this bound excludes is the two models a
// build reaches for instead — taking the STRONGEST flow rather than the sum, and
// applying the first Forge found and stopping, both of which read `129.6` where
// `259.2` is required.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  type Face,
  type Harness,
} from "../harness";
import { faceAnchor, moverFlow, type Neighbour } from "./bench";

/** The emitter read, cold, and the two faces the Forges stand against. */
const SUBJECT = "arc";
const COLD = 0;
const FACES: readonly Face[] = ["N", "S"];

/** What a second identical contact must add: exactly as much again. */
const STACKED = 2;

/**
 * How close the stacked reading must come to twice the single one, as decimal
 * places of heat per second.
 *
 * One place is `0.05` of a heat point per second against a required `259.2`, two
 * hundredths of one percent. Both legs are one frame of the same build's own
 * arithmetic in the same arrangement, so a conformant build's pair is exact to
 * floating point; the bound is thousands of times smaller than the `129.6` that
 * separates the sum from either of the wrong models named above.
 */
const RATE_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Forges stack", async () => {
  const forges: Neighbour[] = FACES.map((face) => ({
    type: "forge",
    ...faceAnchor(SUBJECT, face),
  }));

  const one = await moverFlow(h, { type: SUBJECT, heat: COLD }, [forges[0]]);
  const both = await moverFlow(h, { type: SUBJECT, heat: COLD }, forges);
  captureStill(h, "stacked");

  assertGreaterThan(
    one,
    0,
    `precondition: heat per second one Forge drives into a cold ${SUBJECT}`,
  );
  assertCloseTo(
    both,
    STACKED * one,
    RATE_DIGITS,
    `heat per second two Forges on opposite faces drive into one cold ` +
      `${SUBJECT}, against ${STACKED} times the ${one} one of them drives`,
  );
});
