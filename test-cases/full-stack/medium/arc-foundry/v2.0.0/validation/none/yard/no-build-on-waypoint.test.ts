// yard/no-build-on-waypoint — a waypoint platform is four tiles, and all four are
// protected.
//
// `specs/yard.md` makes a waypoint a platform rather than a bare tile for exactly
// this reason: a checkpoint the player can wall off is a checkpoint a unit can be
// stranded at. So the anchor, both arms, and the stem are Waypoint tiles, and no
// footprint may cover any of them.
//
// THE STEM IS THE ONE A BUILD GETS WRONG. It points toward the grid's vertical
// centre — below the anchor when `row` is under `16` and above it otherwise — so
// a build that always takes the tile below protects the wrong tile on every
// platform in the yard's lower half. Both halves are read here, on a platform
// above the centre line and one below it.
//
// The other direction, that a placement merely TOUCHING a platform is accepted,
// is the sibling point `build-beside-waypoint`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { mapById, platformTiles } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/**
 * The two platforms read, and the anchor taken against each tile of them.
 *
 * `WP5` sits above the grid's vertical centre and `WP6` below it, so the two
 * stems point opposite ways. Each anchor below covers the tile it names; the
 * anchor tile is the one exception, because every 2 by 2 footprint covering a
 * platform's anchor covers one of its arms as well.
 */
const PLATFORMS = [
  {
    waypoint: 5,
    attempts: [
      { tile: "the left arm", col: 34, row: 13 },
      { tile: "the right arm", col: 37, row: 13 },
      { tile: "the stem", col: 36, row: 15 },
      { tile: "the anchor", col: 36, row: 14 },
    ],
  },
  {
    waypoint: 6,
    attempts: [
      { tile: "the left arm", col: 34, row: 19 },
      { tile: "the right arm", col: 37, row: 19 },
      { tile: "the stem", col: 36, row: 18 },
      { tile: "the anchor", col: 36, row: 20 },
    ],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a placement covering any tile of a waypoint platform", async () => {
  await openYard(h);
  const map = mapById((await h.snapshot()).map);

  for (const platform of PLATFORMS) {
    const anchor = map.waypoints[platform.waypoint - 1]!;
    const covered = platformTiles(anchor.col, anchor.row);

    for (const attempt of platform.attempts) {
      const before = (await h.snapshot()).structures.length;
      await h.debug.placeBlocker(attempt.col, attempt.row);
      assertEqual(
        (await h.snapshot()).structures.length,
        before,
        `the yard to stay at ${before} structures after a placement anchored ` +
          `at (${attempt.col}, ${attempt.row}), whose footprint covers ` +
          `${attempt.tile} of the WP${platform.waypoint} platform at ` +
          `(${anchor.col}, ${anchor.row}), which covers ` +
          covered.map((tile) => `(${tile.col}, ${tile.row})`).join(", "),
      );
    }
  }

  await h.advance(1);
  await captureStill(h, "refused");
});
