// Floe — presentation/submerged-bear-visible: where a swimming bear is, something
// is drawn that a player can tell from the water around it.
//
// specs/overview.md's visual-design table: "A submerged bear stays trackable:
// something distinct from the water is drawn where it is, so it is never
// invisible." specs/assets.md says the same of the art — "The swim frames already
// carry the submerged silhouette and its wake, so a bear over the water stays
// trackable" — and specs/hunter.md fixes when a bear is swimming: the tile it is
// travelling into is on the water band and no floe covers it.
//
// THIS IS THE LEGIBILITY POINT THAT MATTERS MOST. A submerged bear is drawn as
// something other than a full sprite, and a build that draws nothing at all for
// it leaves the hunt invisible exactly where the critter is most exposed — out
// over the water, with no safe tile within a hop. `sprite-bear-swim` decides
// WHICH FRAMES are reached for; this decides that what lands on the canvas can be
// seen.
//
// SO WHAT IS READ IS A DISTANCE, NEVER A COLOUR. Floe fixes no palette
// (specs/overview.md: "The palette, the type, and every other aspect of the look
// are yours"), so the reading is between two things the build itself drew: the
// pixels over the bear's tile, and the open water of the same lane away from it.
// Both are taken on the SAME ROW, so the two differ in the bear and in nothing
// else — not in the band, not in the lane's own shading, not in the distance down
// the strait.
//
// The strait is the empty one `startCrossing` poses, which is what makes the
// bear's tile open water: the floes are cleared, so the "no floe covers it" half
// of the swimming rule is the world rather than a bystander. The bear holds its
// tile — its routing and its travel are off — because where it STANDS is what
// this point reads, and the critter `startCrossing` leaves on the near shore is
// thirteen rows away with the catch test shut.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  bearById,
  captureReplay,
  createHarness,
  poseBear,
  sampleTile,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { bodyDistances, farthest, fractionAtLeast } from "./body";
import { stageRaster } from "./raster";

/** A tile inside the water band, far from either side edge. */
const BEAR_COL = 20;
const ROW = 6;

/** Open water of the same lane, eight tiles away: what it is read against. */
const WATER_COL = 28;

/**
 * How far a pixel of the bear's tile must sit from the water to count as read
 * apart, as an RGB distance.
 *
 * The RGB cube's longest diagonal is about `441`, so `60` is a seventh of the
 * whole range: comfortably more than the shading, dithering or animation a build
 * may give one lane of water, and far below what any deliberate silhouette
 * measures. It is the figure this review item states, and it is a DISTANCE — no
 * colour, no channel and no palette entry is asserted anywhere here.
 */
const DISTINCT_MIN = 60;

/**
 * How much of the bear's tile must read that far apart.
 *
 * A tenth. specs/assets.md seeds every frame with a transparent background, so
 * part of a body's tile is always the water showing through and no honest reading
 * can ask for the whole of it; measured on the seeded frames this case ships, the
 * bear's swim frames are about three tenths opaque. A tenth is therefore well
 * inside what the seeded silhouette itself covers, and far above the stray pixel
 * a build could leave behind while drawing nothing a player could see.
 */
const READS_APART_COVERAGE = 0.1;

/** The seconds of swimming kept as the item's evidence. */
const REPLAY_SECONDS = 0.4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a swimming bear apart from the water around it", async () => {
  startCrossing(h);
  const id = poseBear(h, BEAR_COL, ROW, { routing: false, travel: false });

  // The evidence, and the frame the samples below are taken off. Taken before
  // the readings, so a failing verdict still leaves the picture that shows why.
  await captureReplay(h, "swim", () => h.advance(ticksFor(REPLAY_SECONDS)));

  const bear = bearById(h.snapshot(), id);
  const water = sampleTile(h, WATER_COL, ROW);
  const over = bodyDistances(stageRaster(h), BEAR_COL, ROW, water);

  // The situation: the tile it holds really is open water, so what the samples
  // differ in is the bear.
  assertEqual(
    bear?.swimming,
    true,
    "the bear on an uncovered water tile reports swimming (specs/hunter.md)",
  );

  assertGreaterThanOrEqual(
    fractionAtLeast(over, DISTINCT_MIN),
    READS_APART_COVERAGE,
    `the share of the swimming bear's tile (${BEAR_COL}, ${ROW}) drawn at ` +
      `least ${DISTINCT_MIN} of 441 from the open water of the same lane ` +
      `(tile ${WATER_COL}, ${ROW}) — a submerged bear stays trackable, so ` +
      `something distinct from the water is drawn where it is ` +
      `(specs/overview.md); the tile's farthest pixel measured ` +
      `${farthest(over).toFixed(0)}`,
  );
});
