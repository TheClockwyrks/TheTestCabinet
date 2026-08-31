// presentation/critter-reads-apart — the critter can be picked out from whatever
// it is standing on, on every footing it can stand on.
//
// specs/overview.md's visual-design table: "The critter reads apart from every
// band it can stand on, and from a floe under it." specs/strait.md names those
// footings — the near shore (row `19`), the ice band (rows `11`–`18`), the
// median shelf (row `10`), and a floe on the water band — and this point stands
// the critter on one of each in turn.
//
// FOUR FOOTINGS, EACH READ ON ITS OWN, because a build that separates its
// critter from the ice and loses it against the floes is exactly the build this
// point exists to catch, and a failure has to name which footing went wrong.
//
// WHAT IS READ IS A DISTANCE, NEVER A COLOUR. Floe fixes no palette
// (specs/overview.md: "The palette, the type, and every other aspect of the look
// are yours"), so each reading is between two things the build itself drew: the
// pixels over the critter's tile, and the same footing away from it. Both
// samples of a pair are taken on the SAME ROW — and, for the floe, on the SAME
// FLOE — so the two differ in the critter and in nothing else. The reading is
// per pixel rather than averaged, for the reason `./body.ts` gives.
//
// THE FLOE IS THE FOOTING, NOT A BYSTANDER. specs/strait.md makes a critter's
// footing on the water band `floe` only where a floe covers its centre, so
// reading "apart from a floe under it" requires one under it. It is a `raft4`,
// the longest floe the game has, so the critter's tile and the tile the floe is
// read on are both squarely on the same slab; `poseLane` stops the lane, so
// neither drifts while the samples are taken. Everything else stays as
// `startCrossing` left it: no bear, no vehicle, no bonus catch, no drain.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { ROW_MEDIAN, ROW_NEAR } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  poseLane,
  sampleTile,
  startCrossing,
} from "../harness";
import { bodyDistances, fractionAtLeast } from "./body";

/** The column the critter is read on, and the one its footing is read on. */
const AT_COL = 20;
const BARE_COL = 28;

/** A row inside the ice band, and a row inside the water band. */
const ICE_ROW = 15;
const WATER_ROW = 6;

/** Where the raft's left edge goes, so it covers both columns read on it. */
const RAFT_COL = 18;

/** The column of that raft the bare floe is read on: covered, and critter-free. */
const RAFT_BARE_COL = 21;

/**
 * How far a pixel of the critter's tile must sit from its footing to count as
 * read apart, as an RGB distance.
 *
 * The RGB cube's longest diagonal is about `441`, so `60` is a seventh of the
 * whole range: comfortably more than the shading, texture or drift a build may
 * give one band, and well below what a body a player must track at a glance
 * measures against it. It is the figure this review item states, and it is a
 * DISTANCE — no colour, no channel and no palette entry is asserted here.
 */
const DISTINCT_MIN = 60;

/**
 * How much of the critter's tile must read that far apart.
 *
 * A tenth. specs/assets.md seeds every frame with a transparent background, so
 * part of a body's tile is always the footing showing through and no honest
 * reading can ask for the whole of it; measured on the seeded frames this case
 * ships, the critter's are about a sixth opaque — the smallest body in the game.
 * A tenth is therefore inside what the seeded art itself covers, and far above
 * the stray pixel a build could leave behind while drawing nothing a player
 * could see.
 */
const READS_APART_COVERAGE = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the critter apart from every footing it can stand on", async () => {
  await startCrossing(h);

  const read = async (
    row: number,
    bareCol: number,
  ): Promise<{ footing: string; over: number[] }> => {
    await h.debug.setCritterTile(AT_COL, row);
    await h.step(1);
    const footing = (await h.snapshot()).critter.footing;
    const band = await sampleTile(h, bareCol, row);
    return { footing, over: await bodyDistances(h, AT_COL, row, band) };
  };

  const near = await read(ROW_NEAR, BARE_COL);
  const ice = await read(ICE_ROW, BARE_COL);
  const median = await read(ROW_MEDIAN, BARE_COL);

  await poseLane(h, WATER_ROW, "raft4", [RAFT_COL]);
  const floe = await read(WATER_ROW, RAFT_BARE_COL);
  // Before the assertions, so a failing verdict still leaves the last footing.
  await captureStill(h, "scene");

  const apart = (
    what: string,
    sample: { footing: string; over: number[] },
    expected: string,
  ): void => {
    // The situation: the critter really is standing on the footing named.
    assertEqual(
      sample.footing,
      expected,
      `the critter on ${what} reports ${expected} footing (specs/strait.md)`,
    );
    assertGreaterThanOrEqual(
      fractionAtLeast(sample.over, DISTINCT_MIN),
      READS_APART_COVERAGE,
      `the share of the critter's tile on ${what} drawn at least ` +
        `${DISTINCT_MIN} of 441 from the same footing beside it — the critter ` +
        `reads apart from every band it can stand on, and from a floe under it ` +
        `(specs/overview.md); its farthest pixel measured ` +
        `${(sample.over[sample.over.length - 1] ?? 0).toFixed(0)}`,
    );
  };

  apart("the near shore", near, "solid");
  apart("the ice band", ice, "solid");
  apart("the median shelf", median, "solid");
  apart("a floe", floe, "floe");
});
