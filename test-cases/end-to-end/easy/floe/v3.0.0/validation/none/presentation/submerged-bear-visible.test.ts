// presentation/submerged-bear-visible — where a swimming bear is, the build drew
// something.
//
// specs/overview.md's visual-design table: "A submerged bear stays trackable:
// something distinct from the water is drawn where it is, so it is never
// invisible." specs/assets.md says the same of the art — "The swim frames
// already carry the submerged silhouette and its wake, so a bear over the water
// stays trackable" — and specs/hunter.md fixes when a bear is swimming: the tile
// it is travelling into is on the water band and no floe covers it.
//
// THIS IS THE ONE PLACE A DRAW CALL CANNOT ANSWER FOR THE PICTURE. A submerged
// bear is drawn as something other than a full sprite and the water layer goes
// over it, so `presentation/sprite-bear-swim` deciding that the swim frame was
// submitted leaves open that nothing of it reached the canvas.
// `presentation/sprite-bear-swim` decides WHICH FRAMES are reached for; this
// decides that something landed where the bear is.
//
// SO THE READING IS PRESENCE, AND NOTHING ELSE. The bear's own tile is read with
// the bear on it, and read again with the bear taken off the strait through
// `clearBears` (specs/instrumentation.md), and the two readings must differ. No
// colour, no distance, no channel and no share of the tile enters into it: what
// a submerged bear LOOKS like against the water is appearance, which the
// reviewer's `presentation` rating judges.
//
// THE TWO READINGS DIFFER IN THE BEAR AND IN NOTHING ELSE. The strait is the
// empty one `startCrossing` poses, which is what makes the bear's tile open
// water: the floes are cleared, so the "no floe covers it" half of the swimming
// rule is the world rather than a bystander. Nothing else is on the tile, the
// bear holds its place — its routing and its travel are off — and the critter
// `startCrossing` leaves on the near shore is thirteen rows away with the catch
// test shut.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { TILE, tileCX, tileCY } from "../constants";
import {
  captureReplay,
  createHarness,
  type Harness,
  poseBear,
  requireBear,
  startCrossing,
  ticksFor,
} from "../harness";
import { differingPixels, readRaster } from "./raster";

/** A tile inside the water band, far from either side edge. */
const BEAR_COL = 20;
const ROW = 6;

/** The seconds of swimming kept as the item's evidence. */
const REPLAY_SECONDS = 0.4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The tile a body's frame is drawn over: `TILE` units square, centred on the
 * tile's own centre (specs/assets.md, specs/strait.md).
 */
function tileRect(col: number, row: number): [number, number, number, number] {
  return [tileCX(col) - TILE / 2, tileCY(row) - TILE / 2, TILE, TILE];
}

it("draws something where a submerged bear swims", async () => {
  await startCrossing(h);
  const id = await poseBear(h, BEAR_COL, ROW, {
    routing: false,
    travel: false,
  });

  // The evidence, and the frame the first reading is taken off. Taken before the
  // readings, so a failing verdict still leaves the picture that shows why.
  await captureReplay(h, "swim", () => h.advance(ticksFor(REPLAY_SECONDS)));

  // The situation: the tile it holds really is open water, so what the two
  // readings differ in is the bear.
  const bear = requireBear(await h.snapshot(), id, "the submerged bear");
  assertEqual(
    bear.swimming,
    true,
    "the bear on an uncovered water tile reports swimming (specs/hunter.md)",
  );

  const rect = tileRect(BEAR_COL, ROW);
  const swimming = await readRaster(h, ...rect);

  // The same tile with the hunt taken off the strait, and nothing else changed.
  await h.debug.clearBears();
  await h.step();
  const bare = await readRaster(h, ...rect);

  assertGreaterThan(
    differingPixels(swimming, bare, 0).length,
    0,
    `the device pixels of the tile (${BEAR_COL}, ${ROW}) drawn differently ` +
      `with the swimming bear on it than with the hunt cleared off it — a ` +
      `submerged bear stays trackable, so something is drawn where it is ` +
      `(specs/overview.md)`,
  );

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(h.pageErrors, []);
});
