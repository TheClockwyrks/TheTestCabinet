// generation/ore-density — ore veins occupy their stated share, at every depth.
//
// `specs/world.md`: "Ore veins occupy `ORE_DENSITY` (`0.14`) of the minable
// cells, the same share at every depth, so the share of rock that is ore never
// spikes in one stratum", and "Every measurable share above holds within
// `DENSITY_TOLERANCE` (`0.25`) of the stated value, measured relative to that
// value over a whole band."
//
// THE DENOMINATOR. The share is measured over the field generation had to fill:
// every cell of the playable columns `1`–`30` across the band's rows. A build
// that instead takes its share of the cells left after the boulders and hazards
// are placed reads a few percent higher here, which the stated tolerance covers
// several times over.
//
// THE TOPSOIL IS THE ONE BAND WITH A SECOND RULE ON IT: no ore appears above
// `ORE_MIN_ROW`, so three of its rows are plain rock by construction and its
// share sits about two percent under the others. That too is well inside the
// tolerance, so the same bound is held over all four bands — which is what "the
// same share at every depth" means.
//
// The reading is pooled over a few mines so that one unlucky scatter cannot
// decide the point; at this share a single band already carries four thousand
// draws, so the pooled figure is a measurement rather than a sample.

import { afterEach, beforeEach, it } from "vitest";
import { DENSITY_TOLERANCE, ORE_DENSITY } from "../constants";
import { assertBetween } from "../assert";
import {
  BAND_ORDER,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";
import { generatedMine, look, poolTallies, tallyBand } from "./mine-scan";

/** The mines the share is pooled over. */
const SEEDS = [1, 2, 3, 4] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fills 0.14 of every band's cells with ore veins", async () => {
  const scans = SEEDS.map((seed) => generatedMine(h, seed));

  const low = ORE_DENSITY * (1 - DENSITY_TOLERANCE);
  const high = ORE_DENSITY * (1 + DENSITY_TOLERANCE);
  for (const band of BAND_ORDER) {
    const pooled = poolTallies(scans.map((scan) => tallyBand(scan, band)));
    assertBetween(
      pooled.kinds.ore / pooled.cells,
      low,
      high,
      `${band}: ${pooled.kinds.ore} ore veins in ${pooled.cells} cells`,
    );
  }

  // The picture: the ore scattered through one band of the last mine read.
  const rockbed = tallyBand(scans[scans.length - 1], "rockbed");
  await look(h, 16, Math.round((rockbed.from + rockbed.to) / 2));
  captureStill(h, "veins");
});
