// Wireworm — presentation/node-ramp-brightens: the ramp climbs toward critical.
//
// specs/overview.md's legibility table: the four charge states "read as a ramp:
// each state is visibly brighter or more energetic than the one below it, with
// critical the most so". That is a rule about ORDER rather than about any
// colour, which is what makes it checkable while the palette stays the build's:
// whatever four colours the build chose, the brightness of the tile a node
// paints must climb at every step from inert to critical.
//
// BRIGHTNESS IS THE MEAN OF THE THREE CHANNELS, so the reading favours no hue.
// A build whose ramp climbs in green and a build whose ramp climbs in white are
// both read as climbing; a build that paints charge `2` darker than charge `1`
// is not, whatever hues it used.
//
// The pose is the one presentation/node-ramp-distinct uses — four nodes six
// tiles apart on one row of an otherwise empty, quiet board — because the two
// points read the same picture and differ only in what they ask of it: that one
// asks the four colours be different, this one asks them to be ordered.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  resetTo,
  sampleTile,
  startPlaying,
  type Harness,
  type Rgb,
} from "../harness";

/** The row the four nodes are posed on: mid-board, clear of the player band. */
const RAMP_ROW = 8;

/** The column each charge is posed in, six tiles apart so no glow overlaps. */
const RAMP_COLUMN = [6, 12, 18, 24] as const;

/** A sampled colour's brightness: the mean of its channels, 0 to 255. */
function brightness(colour: Rgb): number {
  return (colour.r + colour.g + colour.b) / 3;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("brightens the node's tile at every step of the charge ramp", async () => {
  resetTo(h);
  startPlaying(h);
  for (let charge = 0; charge <= CHARGE_MAX; charge += 1) {
    h.debug.setNode(RAMP_COLUMN[charge], RAMP_ROW, charge);
  }
  await h.advance(1);
  // The four states side by side, as the build drew them.
  captureStill(h, "ramp");

  const snapshot = h.snapshot();
  const lit = RAMP_COLUMN.map((column, charge) => {
    assertEqual(
      chargeAt(snapshot, column, RAMP_ROW),
      charge,
      `the node posed at (${column}, ${RAMP_ROW}) holds charge ${charge}`,
    );
    return brightness(sampleTile(h, column, RAMP_ROW));
  });

  for (let charge = 1; charge <= CHARGE_MAX; charge += 1) {
    assertGreaterThan(
      lit[charge],
      lit[charge - 1],
      `charge ${charge} to read brighter than charge ${charge - 1} ` +
        `(specs/overview.md: each state is visibly brighter or more energetic ` +
        `than the one below it, with critical the most so); charge ` +
        `${charge - 1} sampled a brightness of ${lit[charge - 1].toFixed(1)} ` +
        `of 255`,
    );
  }
});
