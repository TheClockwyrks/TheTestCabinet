// strait/bays-read-apart — an open bay reads as an opening in the far shore,
// distinct from the solid shore beside it.
//
// specs/overview.md's legibility table: "An open bay reads as an opening in the
// far shore, distinct from the solid shore beside it". specs/strait.md fixes
// where the openings are — five exact column pairs cut into row `1`, every other
// column of that row solid far shore — and specs/bays.md makes a bay open until
// a crossing ends in it.
//
// THE OTHER HALF OF THAT SENTENCE IS ITS OWN POINT. "a filled bay reads as
// filled" is `strait/filled-bay-reads-filled`, because the two fail separately:
// a build can draw a bay that does not read as an opening, and a build can draw
// a filled bay exactly like an open one, and a single point over both could only
// fail once.
//
// SIXTY OF 441, which is the item's own figure and a stronger one than the forty
// `strait/bands-read-apart` asks between two bands — deliberately, because a bay
// and the shore it is cut into sit tile against tile on the same row, with no
// distance to soften the comparison. It is read on every one of the five,
// against the solid column on either side of that bay's pair, because a build
// that opened one mouth and forgot another fails on the one it forgot.
//
// WHAT IS READ IS A DISTANCE, NEVER A COLOUR. Floe fixes no palette; every
// reading is between two things the build itself drew.
//
// THE STRAIT IS EMPTIED AND THE CRITTER TAKEN OFF IT, so what is sampled on row
// `1` is the far shore and the bays cut into it, and nothing standing on them.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThanOrEqual } from "../assert";
import { BAYS, ROW_BAYS, tileCX, tileCY } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  sampleColor,
  startCrossing,
  type Harness,
} from "../harness";
import { bayMouthX } from "./harness";

/**
 * How far an open bay must read from the solid shore beside it, as an RGB
 * distance out of about `441`.
 *
 * The item's own figure, and the same one the bodies are held to
 * (`presentation/critter-reads-apart`): `60` is about a seventh of the cube's
 * longest diagonal. It is higher than the `40` the five BANDS are held to
 * because a bay is a two-tile notch cut into the band beside it rather than a
 * band-sized expanse — a player has to pick it out of the shore at a glance
 * while aiming a hop at it, and a separation that reads between two large
 * expanses does not read between a small one and its surround.
 */
const BAY_APART_MIN = 60;

/** The two columns of solid far shore either side of a bay's mouth. */
function shoreColumns(
  pair: readonly [number, number],
): readonly { col: number; side: string }[] {
  return [
    { col: pair[0] - 1, side: "to its left" },
    { col: pair[1] + 1, side: "to its right" },
  ];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every open bay apart from the solid shore beside it", async () => {
  // An emptied, live strait with nothing on it at all, and all five bays open
  // (specs/bays.md: a level opens with every bay open).
  await startCrossing(h);
  await h.debug.removeCritter();
  await h.step();
  // Before the assertions, so a failing verdict leaves the picture of the five
  // open mouths the readings were taken from.
  await captureStill(h, "scene");

  const mouthY = tileCY(ROW_BAYS);
  for (const [bay, pair] of BAYS.entries()) {
    const mouth = await sampleColor(h, bayMouthX(pair), mouthY);
    for (const { col, side } of shoreColumns(pair)) {
      const shore = await sampleColor(h, tileCX(col), mouthY);
      assertGreaterThanOrEqual(
        colorDistance(mouth, shore),
        BAY_APART_MIN,
        `the mouth of bay ${bay} (columns ${pair[0]} and ${pair[1]}), open, ` +
          `read against the solid far shore at column ${col} ${side} — an open ` +
          `bay reads as an opening in the far shore, distinct from the solid ` +
          `shore beside it (specs/overview.md)`,
      );
    }
  }

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(h.pageErrors, []);
});
