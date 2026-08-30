// world-size/size-scales-depth-alone — the size changes the distance and nothing
// else.
//
// specs/world.md: "The size scales only how deep the mine goes. The bands, the
// hazards, the ore mix, the economy, the upgrades, and the rocket are identical
// at every size", and "everything else in this specification that varies with
// depth is expressed as a depth fraction rather than a row, so it is identical in
// shape at every size". This check reads that claim on the two halves it can be
// read on: the PRICES, which are plain figures, and the ORE MIX, which is the one
// depth-varying quantity the size could plausibly drag along with it.
//
// THE PRICES. Fuel at `FUEL_PRICE` an unit and repair at `REPAIR_PRICE` a point
// in `FUEL_BUY_INCREMENT` and `REPAIR_BUY_INCREMENT` lots (specs/gameplay.md),
// the first rung of an upgrade track at `UPGRADE_PRICES[2]` (specs/upgrades.md),
// and the first rocket component at its own price (specs/rocket.md). Each is
// bought through the control that stands for the on-screen one, and what is read
// is the Credits it actually took, at every size.
//
// THE ORE MIX. specs/mining.md draws a vein's ore at the CELL'S DEPTH FRACTION,
// weighted by `pick * max(0, 1 - abs(f - peak) / spread)`. So over one band of
// depth fractions the mix must be the same however many rows that band spans. Two
// bounds hold it, and both are computed from the fraction alone:
//
//   - every ore found is one the curves make available at ITS OWN cell's
//     fraction, so nothing outside the mix appears at any size; and
//   - every ore the curves make COMMON over the sampled fractions is present at
//     every size, so nothing inside the mix goes missing at any size.
//
// "Common" is an ore the specification's own weights and `ORE_DENSITY` predict at
// least `MIN_EXPECTED` cells of in the SMALLEST mine's window, which is far
// enough above zero that a build placing the stated mix cannot miss one by
// chance. The rare ores are left to the first bound alone, because a curve with a
// `pick` of `0.03` legitimately produces none of them in a window this size.
//
// ISOLATION. One expedition per size: a generated mine for the ore reading, and
// posed Credits with the miner's body and drill both gated for the prices, so
// nothing walks, falls or cuts while the controls are run.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  FUEL_BUY_INCREMENT,
  FUEL_PRICE,
  ORES,
  ORE_DENSITY,
  ORE_IDS,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
  REPAIR_BUY_INCREMENT,
  REPAIR_PRICE,
  ROCKET_COMPONENTS,
  UPGRADE_PRICES,
  WORLD_SIZES,
  coreRowFor,
  depthFraction,
  oreWeightAt,
  rowAtFraction,
  type Ore,
  type WorldSize,
} from "../constants";
import {
  captureStill,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";

/** The band of depth fractions the ore mix is sampled over. */
const FROM_FRACTION = 0.45;
const TO_FRACTION = 0.75;

/** Cells of one ore the weights must predict before its absence counts. */
const MIN_EXPECTED = 15;

/** Enough Credits to run every purchase below without ever being refused. */
const BUDGET = 20000;

/** The track the upgrade price is read on: one that changes no other figure. */
const TRACK = "drill" as const;

/** The four prices, as the specification states them. */
const FUEL_LOT = FUEL_BUY_INCREMENT * FUEL_PRICE;
const REPAIR_LOT = REPAIR_BUY_INCREMENT * REPAIR_PRICE;
const FIRST_RUNG = UPGRADE_PRICES[2];
const FIRST_COMPONENT = ROCKET_COMPONENTS[0].credits;

/** The rows the sampled fractions span at a mine of `coreRow` rows. */
function sampleRows(coreRow: number): { from: number; to: number } {
  return {
    from: rowAtFraction(FROM_FRACTION, coreRow),
    to: rowAtFraction(TO_FRACTION, coreRow),
  };
}

/** An ore's share of the draw at depth fraction `f`. */
function shareAt(ore: Ore, f: number): number {
  const total = ORE_IDS.reduce((sum, id) => sum + oreWeightAt(ORES[id], f), 0);
  return total === 0 ? 0 : oreWeightAt(ORES[ore], f) / total;
}

/** The cells of `ore` the specification predicts over one size's window. */
function expectedCells(ore: Ore, size: WorldSize): number {
  const coreRow = coreRowFor(size);
  const { from, to } = sampleRows(coreRow);
  const columns = PLAYABLE_COL_MAX - PLAYABLE_COL_MIN + 1;
  let cells = 0;
  for (let row = from; row <= to; row += 1) {
    cells += columns * ORE_DENSITY * shareAt(ore, depthFraction(row, coreRow));
  }
  return cells;
}

/** Every ore the curves make available at depth fraction `f`. */
function availableAt(f: number): Ore[] {
  return ORE_IDS.filter((id) => oreWeightAt(ORES[id], f) > 0);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Every ore vein in one size's sampled window, with the row it sits in.
 *
 * The loop runs inside the page over the build's own `tileAt` rather than a trip
 * across the boundary per cell, because the window is tens of thousands of cells
 * at the Marathon size. The reading is the build's either way; only the number of
 * round trips differs.
 */
async function oresInWindow(
  h: Harness,
  from: number,
  to: number,
): Promise<{ row: number; ore: Ore }[]> {
  // Once through the harness first, so a build with no surface fails by
  // assertion here rather than as a raw page error inside the loop.
  await h.tileAt(PLAYABLE_COL_MIN, from);
  return (await h.page.evaluate(
    ([fromRow, toRow, minCol, maxCol]) => {
      const api = (
        window as unknown as Record<
          string,
          { tileAt(col: number, row: number): { kind: string; ore: string } }
        >
      ).__deepcore;
      const found: { row: number; ore: string }[] = [];
      for (let row = fromRow; row <= toRow; row += 1) {
        for (let col = minCol; col <= maxCol; col += 1) {
          const tile = api.tileAt(col, row);
          if (tile.kind === "ore" && tile.ore) {
            found.push({ row, ore: tile.ore });
          }
        }
      }
      return found;
    },
    [from, to, PLAYABLE_COL_MIN, PLAYABLE_COL_MAX] as const,
  )) as { row: number; ore: Ore }[];
}

it("keeps the prices and the ore mix at a depth fraction the same at every size", async () => {
  // The ores the specification's own weights make common in the SMALLEST mine's
  // window, which is the set every size must show.
  const common = ORE_IDS.filter(
    (ore) => expectedCells(ore, "quick") >= MIN_EXPECTED,
  );
  assertGreaterThanOrEqual(
    common.length,
    3,
    "the sampled window covers several ores' curves",
  );

  for (const size of WORLD_SIZES) {
    await openScene(h, { size });
    await pinMiner(h);
    await pinDrill(h);
    await h.debug.generateMine();

    const coreRow = coreRowFor(size);
    const { from, to } = sampleRows(coreRow);
    const veins = await oresInWindow(h, from, to);

    for (const vein of veins) {
      assertContains(
        availableAt(depthFraction(vein.row, coreRow)),
        vein.ore,
        `specs/mining.md: ${vein.ore} is on a curve that reaches row ${vein.row} of ${coreRow} at ${size}`,
      );
    }
    const found = new Set(veins.map((vein) => vein.ore));
    for (const ore of common) {
      assertContains(
        [...found],
        ore,
        `specs/world.md: the ore mix at a depth fraction is the same at ${size}`,
      );
    }

    // The prices, each read as the Credits its own control actually took.
    await h.debug.setCredits(BUDGET);
    await h.debug.setFuel(0);
    await h.debug.buyFuel();
    const afterFuel = (await h.snapshot()).credits;
    assertEqual(
      BUDGET - afterFuel,
      FUEL_LOT,
      `specs/gameplay.md: a lot of fuel costs the same at ${size}`,
    );

    await h.debug.setHull(1);
    await h.debug.buyRepair();
    const afterRepair = (await h.snapshot()).credits;
    assertEqual(
      afterFuel - afterRepair,
      REPAIR_LOT,
      `specs/gameplay.md: a lot of repair costs the same at ${size}`,
    );

    await h.debug.buyUpgrade(TRACK);
    const afterUpgrade = (await h.snapshot()).credits;
    assertEqual(
      afterRepair - afterUpgrade,
      FIRST_RUNG,
      `specs/upgrades.md: the first rung costs the same at ${size}`,
    );

    await h.debug.fabricate();
    const afterFabricate = await h.snapshot();
    assertEqual(
      afterUpgrade - afterFabricate.credits,
      FIRST_COMPONENT,
      `specs/rocket.md: the first rocket component costs the same at ${size}`,
    );
    assertEqual(
      afterFabricate.tiers[TRACK],
      2,
      `specs/upgrades.md: the rung that was paid for was installed at ${size}`,
    );

    await h.debug.setPanel("upgrade-shop");
    await h.advance(1);
    await captureStill(h, "same");
  }
});
