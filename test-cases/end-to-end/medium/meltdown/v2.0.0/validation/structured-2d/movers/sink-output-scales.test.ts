// Meltdown — movers/sink-output-scales: the Sink's output rises with the level.
//
// specs/towers.md gives the Sink's per-shared-edge cooling per level as `16`, `24`
// and `36`, and says a mover's level "moves its own output alone". specs/heat.md
// drives the drain as `output(S) * sharedEdges(T, S) * (H_T / 100)`, so the output
// is not a figure a snapshot has to report for the check to reach it: dividing the
// measured drain back through the contact and the emitter's heat reads the output
// the build actually used, and that is what this check asserts.
//
// THE FIGURES. A 2x2 Sink flush against a 2x2 Arc abuts it along two edge-tiles,
// and the Arc's mass is `1.0`, so an Arc at `80` loses `16 * 2 * 0.80`,
// `24 * 2 * 0.80` and `36 * 2 * 0.80` a second at the three levels — `25.6`, `38.4`
// and `57.6` — and each divided back by `2 * 0.80` is the rung of the table it came
// from.
//
// ALL THREE RUNGS ARE READ, not the top one alone, because a build gets a per-level
// table wrong one rung at a time. The Sink's own multiplier between rungs is `1.5`,
// and it is not one of the four an emitter's upgrade uses (specs/towers.md gives
// those as `1.6`, `1.15`, `1.3` and a flat `+1.0` tile), so a build that reached for
// an emitter's table instead reads `25.6` and `40.96` at levels II and III, or
// `20.8` and `27.04`, where `24` and `36` are required. A build that stopped
// scaling after level II reads `24` twice.
//
// WHY THE READING IS A DIFFERENCE. Air cooling at `80` is far from nothing, and the
// face the Sink stands against is a face taken out of the air term, so `bench.ts`
// poses each floor twice and subtracts a control with an inert wall in the Sink's
// place. The note at the head of that file states the whole of it.

import { afterEach, beforeEach, it } from "vitest";
import { SINK_OUTPUT, TRIP_HEAT } from "../../src/constants";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  type Face,
  type Harness,
} from "../harness";
import { faceAnchor, massOf, moverFlow, type Neighbour } from "./bench";

/** The three levels, the emitter read, its heat, and the face the Sink is on. */
const LEVELS = [1, 2, 3] as const;
const SUBJECT = "arc";
const HEAT = 80;
const FACE: Face = "N";

/** Edge-tiles the contact runs along (specs/heat.md). */
const SHARED_EDGES = 2;

/**
 * How close each implied output must come, as decimal places of the table's own
 * figure.
 *
 * One place is `0.05` on a scale whose rungs are eight and twelve apart — a bound
 * a hundred and sixty times smaller than the smallest step in the table. The
 * reading is a difference between two one-frame floors that carry the same
 * footprints on the same tiles, so a conformant build's slack is floating-point
 * noise divided by `2 * 0.80`.
 */
const OUTPUT_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The Sink's output rises with the level", async () => {
  const drains: number[] = [];
  for (const level of LEVELS) {
    const sink: Neighbour = {
      type: "sink",
      level,
      ...faceAnchor(SUBJECT, FACE),
    };
    drains.push(await moverFlow(h, { type: SUBJECT, heat: HEAT }, [sink]));
  }
  captureStill(h, "levels");

  LEVELS.forEach((level, i) => {
    assertCloseTo(
      (-drains[i] * massOf(SUBJECT)) / (SHARED_EDGES * (HEAT / TRIP_HEAT)),
      SINK_OUTPUT[level - 1],
      OUTPUT_DIGITS,
      `the per-shared-edge output a level-${level} Sink drained an ${SUBJECT} ` +
        `at ${HEAT} with, read back out of the flow it applied`,
    );
  });
});
