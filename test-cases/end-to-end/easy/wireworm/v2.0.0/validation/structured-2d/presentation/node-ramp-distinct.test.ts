// Wireworm — presentation/node-ramp-distinct: the four charge states are told
// apart.
//
// specs/overview.md's legibility table: "The four charge states of a node are
// told apart at a glance, and they read as a ramp." specs/nodes.md fixes the
// four states themselves — `0` inert up to `CHARGE_MAX` (`3`) critical — and
// the specification deliberately fixes NO palette ("The palette, the type, the
// glow, and every other aspect of the look are yours"). So nothing here asserts
// a colour. What it asserts is DISTANCE: whatever four colours the build paints
// the four states in, no two of them may be the same colour.
//
// THE FOUR NODES ARE THE ONLY THINGS ON THE BOARD. `startPlaying` poses an
// empty, quiet board — no worm, no foe, no bolt, and the three world gates off —
// and the four nodes are then set one charge at a time, six tiles apart along
// one row. Six tiles is `192` logical units, so whatever light a build lays
// around a node cannot reach the node beside it and lift its reading.
//
// The row is well clear of the player band, so the cursor — the one entity no
// scenario can remove — is nowhere near any sample.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  chargeAt,
  colorDistance,
  createHarness,
  resetTo,
  sampleTile,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * How far apart two of the four states must read, as a Euclidean RGB distance.
 *
 * The specification states the rule and leaves the palette to the build, so the
 * CASE fixes the figure this reading holds it to: `40` of the `441` an RGB cube
 * is across (`sqrt(3) * 255`), which is about a tenth of the space. Two colours
 * inside that of each other are the same colour to a player glancing at a board
 * — and four states that far apart span the cube four times over, which is what
 * "told apart at a glance" asks for.
 */
const DISTINCT_MIN = 40;

/** The row the four nodes are posed on: mid-board, clear of the player band. */
const RAMP_ROW = 8;

/** The column each charge is posed in, six tiles apart so no glow overlaps. */
const RAMP_COLUMN = [6, 12, 18, 24] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints the four charge states in four colours a player tells apart", async () => {
  resetTo(h);
  startPlaying(h);
  for (let charge = 0; charge <= CHARGE_MAX; charge += 1) {
    h.debug.setNode(RAMP_COLUMN[charge], RAMP_ROW, charge);
  }
  await h.advance(1);
  // The four states side by side, as the build drew them.
  captureStill(h, "ramp");

  const snapshot = h.snapshot();
  const sampled = RAMP_COLUMN.map((column, charge) => {
    assertEqual(
      chargeAt(snapshot, column, RAMP_ROW),
      charge,
      `the node posed at (${column}, ${RAMP_ROW}) holds charge ${charge}`,
    );
    return sampleTile(h, column, RAMP_ROW);
  });

  for (let low = 0; low <= CHARGE_MAX; low += 1) {
    for (let high = low + 1; high <= CHARGE_MAX; high += 1) {
      assertGreaterThan(
        colorDistance(sampled[low], sampled[high]),
        DISTINCT_MIN,
        `charge ${low} and charge ${high} to differ by more than ` +
          `${DISTINCT_MIN} of 441 (specs/overview.md: the four charge states ` +
          `are told apart at a glance); charge ${low} sampled rgb(` +
          `${sampled[low].r.toFixed(0)}, ${sampled[low].g.toFixed(0)}, ` +
          `${sampled[low].b.toFixed(0)}) and charge ${high} sampled rgb(` +
          `${sampled[high].r.toFixed(0)}, ${sampled[high].g.toFixed(0)}, ` +
          `${sampled[high].b.toFixed(0)})`,
      );
    }
  }
});
