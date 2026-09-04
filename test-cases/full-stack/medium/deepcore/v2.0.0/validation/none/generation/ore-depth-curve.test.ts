// generation/ore-depth-curve — an ore is only ever found where its curve is open.
//
// `specs/mining.md` fixes which ore a vein holds: it is drawn at the cell's depth
// fraction `f`, each ore weighted by
// `weightAt(f) = pick * max(0, 1 - abs(f - peak) / spread)`, and the draw is taken
// over those weights in proportion. An ore whose weight at `f` is `0` therefore
// cannot be drawn there, and the weight is `0` exactly when `abs(f - peak)`
// reaches `spread`. So every ore cell in a generated mine holds an ore whose
// curve is open at that cell's depth: Ferron (`peak 0.01`, `spread 0.34`) is never
// found below `f = 0.35`, and Cindrite (`peak 0.94`) never above `f = 0.6`.
//
// WHAT IS NOT ASSERTED HERE. Not the proportions the draw takes — that is a
// distribution, and a mine holds a few thousand veins across thirteen ores, so
// the shape of the mix is not measurable from one grid. What is measurable, and
// what the rule actually forbids, is an ore appearing where its weight is zero.
//
// THE TOLERANCE. `f` is `(row - 1) / (coreRow - 1)`, so one row is worth
// `1 / (coreRow - 1)` of it. The bound is widened by two rows of depth fraction,
// which is the difference a build that reads the fraction at the cell's centre or
// at the row below makes, and is far narrower than the gap between one ore's
// curve and the next.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { depthFraction, ORES, type Ore } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { generatedMine, look } from "./mine-scan";

const SEEDS = [1, 2, 3, 4] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds every vein to an ore whose curve is open at its depth", async () => {
  for (const seed of SEEDS) {
    const scan = await generatedMine(h, seed);
    const slack = 2 / (scan.coreRow - 1);
    const wrong: string[] = [];
    for (const cell of scan.ores) {
      const def = ORES[cell.ore as Ore];
      if (def === undefined) {
        wrong.push(`(${cell.col}, ${cell.row}) holds "${cell.ore}"`);
        continue;
      }
      const f = depthFraction(cell.row, scan.coreRow);
      if (Math.abs(f - def.peak) > def.spread + slack) {
        wrong.push(
          `${cell.ore} at row ${cell.row}, f ${f.toFixed(3)}, peak ${def.peak}, spread ${def.spread}`,
        );
      }
    }
    assertDeepEqual(wrong.slice(0, 5), [], `seed ${seed}`);
  }

  // The picture: the mix at one depth, halfway down the mine.
  await look(h, 16, 250);
  await captureStill(h, "mix");
});
