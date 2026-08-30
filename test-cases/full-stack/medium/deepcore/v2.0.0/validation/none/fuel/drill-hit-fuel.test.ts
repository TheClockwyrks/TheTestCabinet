// fuel/drill-hit-fuel — each drill hit spends fuel.
//
// specs/character.md: each drill hit spends `DRILL_HIT_FUEL` (`0.25`) fuel, so
// the fuel to break a cell is `ceil(BAND_HEALTH / damagePerHit)` times that — one
// fuel for a topsoil cell at drill tier 1, four for a coreshell one.
//
// One cell is cut through in each of the four bands, at the tier a fresh
// expedition opens at, and the spend is read against the hits that band takes
// plus the `LIFE_SUPPORT_BURN` the miner pays underground over the same span. The
// miner's body is held still, so each cut runs from the same pose and no walk,
// fall or thrust reaches the meter.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import {
  BAND_HEALTH,
  BAND_ORDER,
  DRILL_DAMAGE,
  DRILL_HIT_FUEL,
  LIFE_SUPPORT_BURN,
  drillHitsFor,
} from "../constants";
import {
  captureReplay,
  createHarness,
  driveCut,
  openScene,
  pinMiner,
  rowInBand,
  standOn,
  TICK_HZ,
  type Harness,
} from "../harness";

/** A column well clear of the camp, the cave mouth, and the Core. */
const COL = 8;

/** The band the replay is taken of: the deepest, and so the dearest. */
const SHOWN_BAND = "coreshell";

/** How far a spend may sit from the sum of the two drains, in fuel. */
const TOLERANCE = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spends DRILL_HIT_FUEL a hit, band by band", async () => {
  await openScene(h);
  await pinMiner(h);
  const { coreRow } = await h.snapshot();

  for (const band of BAND_ORDER) {
    const where = `a ${band} cell at drill tier 1 (specs/character.md)`;
    const row = rowInBand(band, coreRow);
    await h.debug.setTile(COL, row, "rock");
    await standOn(h, COL, row);
    await h.debug.setFuel((await h.snapshot()).miner.maxFuel);

    const before = await h.snapshot();
    const cut =
      band === SHOWN_BAND
        ? await captureReplay(h, "cost", () =>
            driveCut(h, "down", { col: COL, row }),
          )
        : await driveCut(h, "down", { col: COL, row });

    assertEqual(cut.broke, true, where);
    const hits = drillHitsFor(BAND_HEALTH[band], DRILL_DAMAGE[0]);
    const support = (LIFE_SUPPORT_BURN * cut.frames) / TICK_HZ;
    const expected = hits * DRILL_HIT_FUEL + support;
    assertBetween(
      before.miner.fuel - cut.snapshot.miner.fuel,
      expected - TOLERANCE,
      expected + TOLERANCE,
      where,
    );
  }
});
