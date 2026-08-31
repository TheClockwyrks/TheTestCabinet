// Meltdown — movers/sink-stacks: two Sinks on one gun draw both flows.
//
// specs/heat.md sums the Sink term over every Sink an emitter touches —
// "`sinkLoss(T) = output(S) * sharedEdges(T, S) * (H_T / 100)`, summed over every
// Sink `S` that `T` touches" — and says it again in words: "Both stack: two Forges
// or two Sinks on one emitter add both flows."
//
// THE ARRANGEMENT. One Arc at `80` with a Sink flush against its north face and
// another flush against its south face. Each abuts it along two edge-tiles, so the
// two contacts are identical and the second Sink must be worth exactly what the
// first is: the pair draws `16 * 4 * 0.80` a second, which is `51.2`, where one
// Sink alone draws `25.6`.
//
// OPPOSITE FACES RATHER THAN ADJACENT ONES, so the two Sinks do not touch each
// other. Movers "neither conduct with an emitter nor exchange with each other"
// (specs/heat.md), so a pair that met would change nothing in a conformant build —
// but it would put a contact in the scenario nobody asked about, and a build that
// got that wrong would fail this item rather than the one that owns it.
//
// THE READING IS THE SECOND SINK'S WORTH, NOT THE PAIR'S TOTAL, so what it decides
// is stacking alone: the single-Sink leg is measured on the same build in the same
// arrangement, and the pair is held against twice it. A build whose Sink is
// altogether wrong fails `movers/sink-cools` on the figure and is graded here only
// on whether its second Sink counted. What this bound excludes is the two models a
// build reaches for instead — taking the STRONGEST drain rather than the sum, and
// applying the first Sink found and stopping, both of which read `25.6` where
// `51.2` is required.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  type Face,
  type Harness,
} from "../harness";
import { faceAnchor, moverFlow, type Neighbour } from "./bench";

/** The emitter read, its heat, and the two faces the Sinks stand against. */
const SUBJECT = "arc";
const HEAT = 80;
const FACES: readonly Face[] = ["N", "S"];

/** What a second identical contact must add: exactly as much again. */
const STACKED = 2;

/**
 * How close the stacked reading must come to twice the single one, as decimal
 * places of heat per second.
 *
 * One place is `0.05` of a heat point per second against a required `51.2`, a
 * tenth of one percent. Both legs are one frame of the same build's own arithmetic
 * in the same arrangement, so a conformant build's pair is exact to floating point;
 * the bound is five hundred times smaller than the `25.6` that separates the sum
 * from either of the wrong models named above.
 */
const RATE_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Sinks stack", async () => {
  const sinks: Neighbour[] = FACES.map((face) => ({
    type: "sink",
    ...faceAnchor(SUBJECT, face),
  }));

  const one = await moverFlow(h, { type: SUBJECT, heat: HEAT }, [sinks[0]]);
  const both = await moverFlow(h, { type: SUBJECT, heat: HEAT }, sinks);
  captureStill(h, "stacked");

  assertLessThan(
    one,
    0,
    `precondition: heat per second one Sink draws out of an ${SUBJECT} at ${HEAT}`,
  );
  assertCloseTo(
    both,
    STACKED * one,
    RATE_DIGITS,
    `heat per second two Sinks on opposite faces draw out of one ${SUBJECT} ` +
      `at ${HEAT}, against ${STACKED} times the ${one} one of them draws`,
  );
});
