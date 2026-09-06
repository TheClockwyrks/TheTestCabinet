// generation/lava-density-ramp — lava grows denser with depth.
//
// `specs/world.md`: "Lava occupies a share rising linearly from
// `LAVA_DENSITY_MIN` (`0.03`) at the top of the deepstone to `LAVA_DENSITY_MAX`
// (`0.10`) at the bottom of the coreshell, and none appears above the
// deepstone", within `DENSITY_TOLERANCE` (`0.25`) of the stated value measured
// over a whole band. The ramp opens at the deepstone rather than the rockbed, so
// the two bands it covers are held against the value at their midpoints:
// `0.0475` in the deepstone and `0.0825` in the coreshell. That lava appears
// nowhere above them is `lava-none-above-the-deepstone`.
//
// WHY THE SHARE IS POOLED OVER SEVERAL MINES. `specs/world.md` also has lava
// "cluster into pools rather than scattering as single cells", and a scatter made
// of pools carries the sampling noise of the number of POOLS rather than of the
// number of cells — a few dozen draws per band rather than a few thousand.
// Pooling several mines is what makes the reading a measurement of the density
// the build uses rather than of which pools one mine happened to place.

import { afterEach, beforeEach, it } from "vitest";
import { DENSITY_TOLERANCE } from "../constants";
import { assertBetween, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  type Band,
  type Harness,
} from "../harness";
import {
  generatedMine,
  lavaDensityAt,
  look,
  poolTallies,
  tallyBand,
} from "./mine-scan";

const MINES = 8;

const MIDPOINTS: readonly { band: Band; fraction: number }[] = [
  { band: "deepstone", fraction: 0.625 },
  { band: "coreshell", fraction: 0.875 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises the lava share from 0.0475 in the deepstone to 0.0825 in the coreshell", async () => {
  const scans = Array.from({ length: MINES }, () => generatedMine(h));

  const shares: number[] = [];
  for (const { band, fraction } of MIDPOINTS) {
    const pooled = poolTallies(scans.map((scan) => tallyBand(scan, band)));
    const share = pooled.kinds.lava / pooled.cells;
    shares.push(share);
    const stated = lavaDensityAt(fraction);
    assertBetween(
      share,
      stated * (1 - DENSITY_TOLERANCE),
      stated * (1 + DENSITY_TOLERANCE),
      `${band}: ${pooled.kinds.lava} lava cells in ${pooled.cells} cells`,
    );
  }

  assertGreaterThan(shares[1], shares[0], "coreshell over deepstone");

  // The picture: lava in the coreshell.
  await look(h, 16, 440);
  captureStill(h, "pools");
});
