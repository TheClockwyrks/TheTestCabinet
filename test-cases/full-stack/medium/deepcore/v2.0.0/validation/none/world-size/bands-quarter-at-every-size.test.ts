// world-size/bands-quarter-at-every-size — the four bands divide the minable
// rows into four equal parts at every size.
//
// specs/world.md: "The minable rows are divided into four equal bands", and the
// band index of a minable row is `min(3, floor(4 * depthFraction(row)))` where
// `depthFraction(row) = (row - 1) / (coreRow - 1)`. Nothing there is a fixed row
// number, so a Quick mine has exactly the shape of a Marathon one: a quarter of
// topsoil, a quarter of rockbed, a quarter of deepstone and a quarter of
// coreshell, whatever `coreRow` is. `BAND_HEALTH` follows the band, so the health
// a tile opens at is the second reading of the same claim.
//
// WHERE THE ROWS COME FROM. Each size is probed at the two rows either side of
// each of the three band boundaries, and at the two ends of the mine. The
// boundary row is derived from the specification's own inequality — the first row
// whose `4 * depthFraction` reaches the band index — so the pair straddles the
// step, and a build that quartered by a fixed row number rather than by the depth
// fraction lands on the wrong side of it at two sizes out of three.
//
// ISOLATION. An empty mine at each size, with each probed cell posed back to
// plain rock so it is a minable cell with a band and a health to report, and
// nothing else in the world.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  BAND_HEALTH,
  WORLD_SIZES,
  bandAtFraction,
  depthFraction,
} from "../constants";
import {
  captureStill,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";

/** The column every probe is taken in: a playable one, away from either border. */
const COL = 16;

/**
 * The rows worth probing at a mine of `coreRow` rows: the two ends, and the pair
 * either side of each of the three band steps.
 *
 * The first row of band `b` is the smallest `row` with
 * `4 * (row - 1) / (coreRow - 1) >= b`, which is `1 + ceil(b * (coreRow - 1) / 4)`.
 */
function probeRows(coreRow: number): number[] {
  const rows = new Set<number>([1, coreRow - 1]);
  for (const band of [1, 2, 3]) {
    const first = 1 + Math.ceil((band * (coreRow - 1)) / 4);
    rows.add(first - 1);
    rows.add(first);
  }
  return [...rows]
    .filter((row) => row >= 1 && row <= coreRow - 1)
    .sort((a, b) => a - b);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives every row the band its depth fraction names, at every size", async () => {
  for (const size of WORLD_SIZES) {
    await openScene(h, { size });
    await pinMiner(h);
    await pinDrill(h);

    const { coreRow } = await h.snapshot();
    for (const row of probeRows(coreRow)) {
      await h.debug.setTile(COL, row, "rock");
      const tile = await h.tileAt(COL, row);
      const band = bandAtFraction(depthFraction(row, coreRow));
      assertEqual(
        tile.band,
        band,
        `specs/world.md: the band of row ${row} of ${coreRow} at ${size}`,
      );
      assertEqual(
        tile.maxHealth,
        BAND_HEALTH[band],
        `specs/world.md: BAND_HEALTH for the ${band} at row ${row} at ${size}`,
      );
    }

    if (size === "quick") await captureStill(h, "bands");
  }
});
