// Meltdown — movers/sink-cools: the Sink drains a hot gun.
//
// specs/heat.md gives the Sink's drain as
// `sinkLoss(T) = output(S) * sharedEdges(T, S) * (H_T / 100)`, counted per SHARED
// EDGE-TILE and proportional to the emitter's own heat, and divided — with every
// other term — by its thermal mass. specs/towers.md puts a level-I Sink's per-edge
// output at `16` and gives the Arc a 2x2 footprint and a mass of `1.0`.
//
// THE FIGURE. A 2x2 Sink flush against a 2x2 Arc's face abuts it along two
// edge-tiles, so an Arc at `80` loses `16 * 2 * 0.80` a second, which is `25.6`,
// and the same Arc at `40` loses `16 * 2 * 0.40`, which is `12.8`.
//
// TWO HEATS, BECAUSE ONE READS ONLY HALF THE RULE. The clause that makes the Sink
// what it is in play is the proportionality: specs/heat.md pairs it with air
// cooling — "Air cooling and the Sink's drain are both proportional to `H / 100`,
// so a tower sheds most near the trip and almost nothing when cold." A build that
// drains a flat `output * sharedEdges` reads `32` at both heats; a build that
// drains toward the trip instead of away from zero, `(100 - H) / 100`, reads `6.4`
// at `80` and `19.2` at `40`. The pair of readings tells all three apart, where
// either alone would leave two of them standing.
//
// WHY THE READING IS A DIFFERENCE. Air cooling at `80` and `40` is far from
// nothing, and the face the Sink stands against is a face taken out of the air
// term, so `bench.ts` poses each floor twice and subtracts a control with an inert
// wall in the Sink's place; what survives is the Sink's own term. The note at the
// head of that file states the whole of it.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { SINK_OUTPUT, TRIP_HEAT } from "../constants";
import {
  captureStill,
  createHarness,
  type Face,
  type Harness,
} from "../harness";
import { faceAnchor, massOf, moverFlow, type Neighbour } from "./bench";

/** The emitter read, and the face the Sink stands against. */
const SUBJECT = "arc";
const FACE: Face = "N";

/** The two heats the drain is read at. */
const HOT = 80;
const MILD = 40;

/** A level-I Sink's per-shared-edge output, `16` (specs/towers.md). */
const LEVEL = 1;
const OUTPUT = SINK_OUTPUT[LEVEL - 1];

/**
 * Edge-tiles the contact runs along: a 2x2 face is two edge-tiles, and a 2x2 Sink
 * flush against a 2x2 Arc covers both of them (specs/heat.md).
 */
const SHARED_EDGES = 2;

/** What specs/heat.md requires per second at each heat, as a signed flow. */
const expectedRate = (heat: number): number =>
  -(OUTPUT * SHARED_EDGES * (heat / TRIP_HEAT)) / massOf(SUBJECT);

/**
 * How close each measured rate must come, as decimal places of heat per second.
 *
 * One place is `0.05` of a heat point per second, two tenths of one percent of the
 * `25.6` required. The measurement is one frame of a build's own arithmetic over
 * figures the specification states exactly, so a conformant build has no need of
 * the room; the bound is more than a hundred times smaller than the distance to
 * the nearest wrong reading of the rule — the flat drain at `32`, the inverted one
 * at `6.4`, and the per-face one at `12.8`.
 */
const RATE_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The Sink drains a hot gun", async () => {
  const sink: Neighbour = { type: "sink", ...faceAnchor(SUBJECT, FACE) };

  const mild = await moverFlow(h, { type: SUBJECT, heat: MILD }, [sink]);
  const hot = await moverFlow(h, { type: SUBJECT, heat: HOT }, [sink]);
  captureStill(h, "draining");

  assertCloseTo(
    hot,
    expectedRate(HOT),
    RATE_DIGITS,
    `heat per second a level-${LEVEL} Sink draws out of an ${SUBJECT} at ` +
      `${HOT} across ${SHARED_EDGES} shared edge-tiles`,
  );
  assertCloseTo(
    mild,
    expectedRate(MILD),
    RATE_DIGITS,
    `heat per second the same Sink draws out of an ${SUBJECT} at ${MILD}, ` +
      `which is half the heat and must be half the drain`,
  );
});
