// generation/stone-density-ramp — unbreakable stone grows denser with depth.
//
// `specs/world.md`: "Unbreakable stone occupies a share of the minable cells that
// rises linearly with `depthFraction` from `STONE_DENSITY_MIN` (`0.02`) at the
// top of the rockbed to `STONE_DENSITY_MAX` (`0.08`) at the bottom of the
// coreshell, and none appears in the topsoil", within `DENSITY_TOLERANCE`
// (`0.25`) of the stated value measured over a whole band.
//
// A band spans a range of the ramp rather than a point of it, and the value the
// ramp gives its midpoint is the mean over the band, so that is what each band's
// share is held against: `0.03` in the rockbed, `0.05` in the deepstone, `0.07`
// in the coreshell. The topsoil belongs to `topsoil-clear`, which reads it as
// exactly none rather than as a share.
//
// WHY THE SHARE IS POOLED OVER SEVERAL MINES. The bound is on the share, and a
// build free to place its boulders by an independent draw per cell carries real
// sampling noise: a rockbed band is four thousand cells, so a hundred-odd
// boulders, whose count wanders by about a tenth of itself from mine to mine for
// reasons that are not the build's density being wrong. Pooling several mines
// measures the density the build actually uses, which is what the rule is about,
// and leaves a build that scatters correctly passing every time.

import { afterEach, beforeEach, it } from "vitest";
import { DENSITY_TOLERANCE } from "../../src/constants";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import {
  bandAtFraction,
  captureStill,
  createHarness,
  type Band,
  type Harness,
} from "../harness";
import {
  generatedMine,
  look,
  poolTallies,
  stoneDensityAt,
  tallyBand,
} from "./mine-scan";

const SEEDS = [1, 2, 3, 4, 5, 6] as const;

/** The three bands the ramp runs across, and the fraction each one's midpoint is. */
const MIDPOINTS: readonly { band: Band; fraction: number }[] = [
  { band: "rockbed", fraction: 0.375 },
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

it("raises the boulder share from 0.03 in the rockbed to 0.07 in the coreshell", async () => {
  const scans = SEEDS.map((seed) => generatedMine(h, seed));

  const shares: number[] = [];
  for (const { band, fraction } of MIDPOINTS) {
    // The pairing of a midpoint with a band is the specification's own division
    // rather than this file's arithmetic.
    assertEqual(bandAtFraction(fraction), band, `the band at f ${fraction}`);
    const pooled = poolTallies(scans.map((scan) => tallyBand(scan, band)));
    const share = pooled.kinds.stone / pooled.cells;
    shares.push(share);
    const stated = stoneDensityAt(fraction);
    assertBetween(
      share,
      stated * (1 - DENSITY_TOLERANCE),
      stated * (1 + DENSITY_TOLERANCE),
      `${band}: ${pooled.kinds.stone} boulders in ${pooled.cells} cells`,
    );
  }

  // And the ramp rises rather than merely landing in three windows: each band
  // carries more boulders than the one above it.
  assertGreaterThan(shares[1], shares[0], "deepstone over rockbed");
  assertGreaterThan(shares[2], shares[1], "coreshell over deepstone");

  // The picture: boulders in the deepest band.
  await look(h, 16, 440);
  captureStill(h, "boulders");
});
