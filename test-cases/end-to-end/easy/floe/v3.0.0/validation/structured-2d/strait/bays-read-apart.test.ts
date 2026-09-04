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
import { assertGreaterThanOrEqual } from "../assert";
import { BAYS, ROW_BAYS } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  sampleTile,
  startCrossing,
  type Harness,
  type Rgb,
} from "../harness";

/**
 * The separation the item requires between an open bay and the shore beside it,
 * of the 441 an RGB distance runs to.
 */
const BAY_MIN = 60;

let open: Harness;

beforeEach(async () => {
  open = await createHarness();
});

afterEach(() => {
  open.dispose();
});

/** An emptied strait with nothing standing on it, one frame drawn. */
async function drawEmptyStrait(h: Harness): Promise<void> {
  startCrossing(h);
  h.debug.removeCritter();
  await h.advance(1);
}

/** The mean rendered colour over the tiles of row 1 at `cols`. */
function shoreTint(h: Harness, cols: readonly number[]): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const col of cols) {
    const sample = sampleTile(h, col, ROW_BAYS);
    r += sample.r;
    g += sample.g;
    b += sample.b;
  }
  return { r: r / cols.length, g: g / cols.length, b: b / cols.length };
}

it.each(BAYS.map((pair, index) => ({ index, pair })))(
  "renders bay $index apart from the solid shore either side of it",
  async ({ index, pair }) => {
    await drawEmptyStrait(open);
    // Before the assertion, so a failing verdict leaves the picture of the
    // open mouth it was taken from.
    captureStill(open, "scene");

    const mouth = shoreTint(open, pair);
    const beside = shoreTint(open, [pair[0] - 1, pair[1] + 1]);

    assertGreaterThanOrEqual(
      colorDistance(mouth, beside),
      BAY_MIN,
      `bay ${index}, columns ${pair[0]} and ${pair[1]}: how far its open ` +
        `mouth sits from the solid shore at columns ${pair[0] - 1} and ` +
        `${pair[1] + 1}, of 441 (specs/overview.md)`,
    );
  },
);
