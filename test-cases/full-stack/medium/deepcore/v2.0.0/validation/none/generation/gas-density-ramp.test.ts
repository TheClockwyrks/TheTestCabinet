// generation/gas-density-ramp — gas pockets grow denser with depth.
//
// `specs/world.md`: "Gas pockets occupy a share rising linearly from
// `GAS_DENSITY_MIN` (`0.004`) at the top of the rockbed to `GAS_DENSITY_MAX`
// (`0.012`) at the bottom of the coreshell, and none appears in the topsoil",
// within `DENSITY_TOLERANCE` (`0.25`) of the stated value measured over a whole
// band. A band spans a range of the ramp, and the value at its midpoint is the
// mean across it: `0.00533` in the rockbed, `0.008` in the deepstone, `0.01067`
// in the coreshell.
//
// WHY THE SHARE IS POOLED OVER MANY MINES, AND WHY THAT IS THE HONEST READING.
// Gas is the thinnest of the four scatters: a rockbed band is four thousand
// cells and about twenty of them are pockets. Twenty draws carry sampling noise
// of roughly a fifth of themselves, which is the whole of the stated tolerance,
// so one band of one mine cannot tell a build whose density is right from one
// whose density is wrong — a build that scatters gas by an independent draw per
// cell, at exactly the stated share, would fail a single-band reading about a
// quarter of the time. Pooling sixteen mines is what turns the reading into a
// measurement of the density the build uses. The rule the specification states
// is about that density; what it costs is that a build with the right mean and a
// wild spread from mine to mine passes, which is the lesser error.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertGreaterThan } from "../assert";
import { DENSITY_TOLERANCE, gasDensityAt, type Band } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { generatedMine, look, poolTallies, tallyBand } from "./mine-scan";

/** Sixteen mines: enough draws that the pooled share is the build's density. */
const MINES = 16;

const MIDPOINTS: readonly { band: Band; fraction: number }[] = [
  { band: "rockbed", fraction: 0.375 },
  { band: "deepstone", fraction: 0.625 },
  { band: "coreshell", fraction: 0.875 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the gas share from 0.00533 in the rockbed to 0.01067 in the coreshell", async () => {
  const scans = [];
  for (let mine = 1; mine <= MINES; mine += 1)
    scans.push(await generatedMine(h));

  const shares: number[] = [];
  for (const { band, fraction } of MIDPOINTS) {
    const pooled = poolTallies(scans.map((scan) => tallyBand(scan, band)));
    const share = pooled.kinds.gas / pooled.cells;
    shares.push(share);
    const stated = gasDensityAt(fraction);
    assertBetween(
      share,
      stated * (1 - DENSITY_TOLERANCE),
      stated * (1 + DENSITY_TOLERANCE),
      `${band}: ${pooled.kinds.gas} pockets in ${pooled.cells} cells`,
    );
  }

  assertGreaterThan(shares[1], shares[0], "deepstone over rockbed");
  assertGreaterThan(shares[2], shares[1], "coreshell over deepstone");

  // The picture: the deepest band, where the pockets are thickest.
  await look(h, 16, 440);
  await captureStill(h, "pockets");
});
