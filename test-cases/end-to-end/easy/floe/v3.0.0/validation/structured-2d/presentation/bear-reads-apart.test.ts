// Floe — presentation/bear-reads-apart: a bear can be picked out from whatever
// band it is travelling on, on every band it can travel on.
//
// specs/overview.md's visual-design table: "A bear reads apart from every band it
// can travel on." specs/strait.md names the solid bands a bear crosses on ice
// footing — the near shore (row `19`), the ice band (rows `11`–`18`) and the
// median shelf (row `10`) — and this point settles a bear on one of each in turn.
// The water band is its sibling point's, `submerged-bear-visible`, because a
// submerged bear is drawn as a silhouette rather than as its full sprite and a
// build can get one right and the other wrong.
//
// THREE BANDS, EACH READ ON ITS OWN, so a failure names which band the bear
// vanished on. A bear that cannot be seen on the median is a bear the critter
// cannot dodge on one of the two strips specs/strait.md makes safe from traffic.
//
// WHAT IS READ IS A DISTANCE, NEVER A COLOUR. Floe fixes no palette
// (specs/overview.md: "The palette, the type, and every other aspect of the look
// are yours"), so each reading is between two things the build itself drew: the
// pixels over the bear's tile, and the same band away from it. Both samples of a
// pair are taken on the SAME ROW, so the two differ in the bear and in nothing
// else. The reading is per pixel rather than averaged, for the reason `./body.ts`
// gives.
//
// THE BEAR IS POSED WITH NEITHER OF THE FACULTIES THIS POINT IGNORES: its routing
// and its travel are off, so it holds the tile it was settled on for as long as
// the samples take and the pixels read are the pixels of a bear at that tile. It
// is settled ten columns from the critter `startCrossing` leaves on the near
// shore, which with the catch test shut is a bystander it cannot reach.

import { afterEach, beforeEach, it } from "vitest";
import { ROW_MEDIAN, ROW_NEAR } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  bearById,
  captureStill,
  createHarness,
  poseBear,
  sampleTile,
  startCrossing,
  type Harness,
} from "../harness";
import { bodyDistances, farthest, fractionAtLeast } from "./body";
import { renderFrame } from "./frame";
import { stageRaster } from "./raster";

/** The column the bear is read on, and the one its band is read on. */
const AT_COL = 10;
const BARE_COL = 30;

/** A row inside the ice band. */
const ICE_ROW = 15;

/**
 * How far a pixel of the bear's tile must sit from its band to count as read
 * apart, as an RGB distance.
 *
 * The RGB cube's longest diagonal is about `441`, so `60` is a seventh of the
 * whole range: comfortably more than the shading or texture a build may give one
 * band, and well below what a pursuer a player must track at a glance measures
 * against it. It is the figure this review item states, and it is a DISTANCE — no
 * colour, no channel and no palette entry is asserted here.
 */
const DISTINCT_MIN = 60;

/**
 * How much of the bear's tile must read that far apart.
 *
 * A tenth. specs/assets.md seeds every frame with a transparent background, so
 * part of a body's tile is always the band showing through and no honest reading
 * can ask for the whole of it; measured on the seeded frames this case ships, the
 * bear's run frames are about a third opaque. A tenth is therefore well inside
 * what the seeded art itself covers, and far above the stray pixel a build could
 * leave behind while drawing nothing a player could see.
 */
const READS_APART_COVERAGE = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a bear apart from every band it can travel on", async () => {
  startCrossing(h);
  const id = poseBear(h, AT_COL, ROW_NEAR, { routing: false, travel: false });

  const read = async (row: number): Promise<number[]> => {
    h.debug.setBearTile(id, AT_COL, row);
    await renderFrame(h);
    const bear = bearById(h.snapshot(), id);
    // The situation: a bear on a solid band is not swimming, so what is read is
    // its full sprite rather than the silhouette its sibling point decides.
    assertEqual(
      bear?.swimming,
      false,
      `the bear on row ${row} travelling on ice footing (specs/hunter.md)`,
    );
    const ground = sampleTile(h, BARE_COL, row);
    return bodyDistances(stageRaster(h), AT_COL, row, ground);
  };

  const near = await read(ROW_NEAR);
  const ice = await read(ICE_ROW);
  const median = await read(ROW_MEDIAN);
  // Before the assertions, so a failing verdict still leaves the last band.
  captureStill(h, "scene");

  const apart = (what: string, over: number[]): void => {
    assertGreaterThanOrEqual(
      fractionAtLeast(over, DISTINCT_MIN),
      READS_APART_COVERAGE,
      `the share of the bear's tile on ${what} drawn at least ${DISTINCT_MIN} ` +
        `of 441 from the same band beside it — a bear reads apart from every ` +
        `band it can travel on (specs/overview.md); its farthest pixel ` +
        `measured ${farthest(over).toFixed(0)}`,
    );
  };

  apart("the near shore", near);
  apart("the ice band", ice);
  apart("the median shelf", median);
});
