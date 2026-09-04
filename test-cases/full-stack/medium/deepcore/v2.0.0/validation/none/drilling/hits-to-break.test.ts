// drilling/hits-to-break — the hits to break a cell follow the band and tier.
//
// specs/character.md: each hit removes the drill tier's damage from the target
// cell's health and the cell breaks when its health reaches `0`, so the hits to
// break it are `ceil(BAND_HEALTH / damagePerHit)`. specs/world.md fixes
// `BAND_HEALTH` per band and specs/upgrades.md the damage per drill tier, and
// the table it prints alongside them — four hits in the topsoil at tier 1, four
// in the coreshell at tier 5 — is that arithmetic written out.
//
// So all twenty pairings are driven: one rock cell posed in each band, cut at
// each of the five drill tiers, with the hits counted off the falls in the
// cell's health rather than off the clock. The miner's body is held still, so
// each cut starts from the same pose and the count is the drill's alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  BAND_HEALTH,
  BAND_ORDER,
  DRILL_DAMAGE,
  MAX_TIER,
  drillHitsFor,
} from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  openScene,
  pinMiner,
  rowInBand,
  stageTiers,
  standOn,
  type Harness,
} from "../harness";
import { countHits } from "./hits";

/** A column well clear of the camp, the cave mouth, and the Core. */
const COL = 8;

/** The pairing the replay is taken of: the deepest band at the weakest drill. */
const SHOWN_BAND = "coreshell";
const SHOWN_TIER = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes ceil(BAND_HEALTH / damage) hits in every band, at every tier", async () => {
  await openScene(h);
  await pinMiner(h);
  const { coreRow } = await h.snapshot();

  for (const band of BAND_ORDER) {
    const row = rowInBand(band, coreRow);
    for (let tier = 1; tier <= MAX_TIER.drill; tier += 1) {
      const where = `${band} at drill tier ${tier} (specs/upgrades.md)`;
      await stageTiers(h, { drill: tier });
      await h.debug.setTile(COL, row, "rock");
      await standOn(h, COL, row);
      assertEqual((await h.tileAt(COL, row)).health, BAND_HEALTH[band], where);

      const expected = drillHitsFor(BAND_HEALTH[band], DRILL_DAMAGE[tier - 1]);
      const cut =
        band === SHOWN_BAND && tier === SHOWN_TIER
          ? await captureReplay(h, "break", () =>
              countHits(h, ACTION_KEY.down, COL, row),
            )
          : await countHits(h, ACTION_KEY.down, COL, row);

      assertEqual(cut.broke, true, where);
      assertEqual(cut.hits, expected, where);
    }
  }
});
