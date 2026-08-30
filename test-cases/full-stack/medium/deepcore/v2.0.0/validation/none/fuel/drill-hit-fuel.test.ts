// fuel/drill-hit-fuel — each drill hit spends fuel.
//
// specs/character.md: each hit spends `DRILL_HIT_FUEL` (`0.25`) fuel, so the fuel
// to break a cell is `ceil(BAND_HEALTH / damagePerHit)` times that — one fuel for
// a topsoil cell at drill tier 1, four for a coreshell one.
//
// The trouble with reading that off the meter is that a miner underground is
// paying life support at the same time, and this point is not that one. So each
// band is measured TWICE over the same number of frames: once cutting the cell
// through, and once with the drill faculty gated, which
// `specs/instrumentation.md` fixes as spending no drill-hit fuel while everything
// else about the miner carries on. The difference between the two is the drill's
// spend and nothing else, so a build whose life support is wrong fails the point
// that owns life support rather than this one.
//
// The miner's body is held still throughout, so neither run pays for a walk, a
// fall or a thrust, and both start from a full tank on the same posed cell.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import {
  BAND_HEALTH,
  BAND_ORDER,
  DRILL_DAMAGE,
  DRILL_HIT_FUEL,
  drillHitsFor,
} from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  driveCut,
  openScene,
  pinDrill,
  pinMiner,
  rowInBand,
  standOn,
  type Harness,
} from "../harness";

/** A column well clear of the camp, the cave mouth, and the Core. */
const COL = 8;

/** The band the replay is taken of: the deepest, and so the dearest. */
const SHOWN_BAND = "coreshell";

/** How far the difference may sit from the hits' cost, in fuel. */
const TOLERANCE = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spends DRILL_HIT_FUEL a hit, over and above what standing there costs", async () => {
  await openScene(h);
  await pinMiner(h);
  const { coreRow } = await h.snapshot();

  for (const band of BAND_ORDER) {
    const where = `a ${band} cell at drill tier 1 (specs/character.md)`;
    const row = rowInBand(band, coreRow);

    // The cut, with the drill running.
    await h.debug.setMinerDrill(true);
    await h.debug.setTile(COL, row, "rock");
    await standOn(h, COL, row);
    await h.debug.setFuel((await h.snapshot()).miner.maxFuel);
    const cutFrom = (await h.snapshot()).miner.fuel;
    const cut =
      band === SHOWN_BAND
        ? await captureReplay(h, "cost", () =>
            driveCut(h, "down", { col: COL, row }),
          )
        : await driveCut(h, "down", { col: COL, row });
    assertEqual(cut.broke, true, where);
    const cutting = cutFrom - cut.snapshot.miner.fuel;

    // The same span again on the same cell, with the drill gated.
    await pinDrill(h);
    await h.debug.setTile(COL, row, "rock");
    await standOn(h, COL, row);
    await h.debug.setFuel((await h.snapshot()).miner.maxFuel);
    const idleFrom = (await h.snapshot()).miner.fuel;
    await h.hold(ACTION_KEY.down);
    try {
      await h.advance(cut.frames);
    } finally {
      await h.release(ACTION_KEY.down);
    }
    const gated = await h.snapshot();
    assertEqual((await h.tileAt(COL, row)).health, BAND_HEALTH[band], where);
    const standing = idleFrom - gated.miner.fuel;

    const hits = drillHitsFor(BAND_HEALTH[band], DRILL_DAMAGE[0]);
    assertBetween(
      cutting - standing,
      hits * DRILL_HIT_FUEL - TOLERANCE,
      hits * DRILL_HIT_FUEL + TOLERANCE,
      where,
    );
  }
});
