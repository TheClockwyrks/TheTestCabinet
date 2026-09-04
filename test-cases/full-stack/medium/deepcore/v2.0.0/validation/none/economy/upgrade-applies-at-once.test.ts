// economy/upgrade-applies-at-once — a bought tier is live on the next cut.
//
// `specs/upgrades.md` fixes the rule: a purchase deducts its price immediately
// and applies at once, and it names the drill as the case in point — "a stronger
// drill takes effect on the next cut". So the reading is the drill's damage per
// hit, taken off the cell rather than off the shop: `specs/character.md` fixes a
// hit as removing the drill tier's damage from the target cell's health, so the
// health a posed cell has lost after exactly one hit IS the tier's damage.
//
// Two identical cells in the same band are cut, one on either side of the
// purchase, so what is read is the change the purchase made. The miner's travel
// is gated because this point is about the drill alone; the drill still starts
// and holds its cut with the body pinned.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, fail } from "../assert";
import { BAND_HEALTH, DRILL_DAMAGE, UPGRADE_PRICES } from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  openScene,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";

/** A topsoil row, so a cell breaks in few hits and the two cuts are cheap. */
const ROW = 12;

/** The two cells cut, one before the purchase and one after. */
const COL_BEFORE = 8;
const COL_AFTER = 12;

/** Frames to wait for the first hit: one interval at the harness clock is 15. */
const MAX_FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Pose a plain rock cell, stand on it, hold `down` until the first hit lands,
 * and report the health that hit removed.
 *
 * The cell it stands ON is the cell a down cut bites, so the pose and the target
 * are the same cell. The key is released before this returns.
 */
async function firstHitDamage(h: Harness, col: number): Promise<number> {
  await h.debug.setTile(col, ROW, "rock");
  await standOn(h, col, ROW);
  const posed = await h.tileAt(col, ROW);
  if (posed.maxHealth === null) {
    fail(
      "a posed rock cell reporting its maxHealth (specs/instrumentation.md)",
      posed,
    );
  }
  const full = posed.maxHealth;

  await h.hold(ACTION_KEY.down);
  try {
    for (let frame = 0; frame < MAX_FRAMES; frame += 1) {
      await h.advance(1);
      const tile = await h.tileAt(col, ROW);
      if (tile.health === null) {
        fail(
          "a cell still minable one hit into the cut (specs/character.md)",
          tile,
        );
      }
      if (tile.health < full) return full - tile.health;
    }
  } finally {
    await h.release(ACTION_KEY.down);
  }
  fail(
    "a held down cut landing a hit within " +
      `${MAX_FRAMES} frames (specs/character.md)`,
    "the cell's health never fell",
  );
}

it("cuts with the new drill damage on the very next cut", async () => {
  await openScene(h);
  await pinMiner(h);

  const before = await firstHitDamage(h, COL_BEFORE);
  assertCloseTo(before, DRILL_DAMAGE[0], 6, "specs/upgrades.md, drill tier 1");
  assertEqual(
    (await h.snapshot()).tiers.drill,
    1,
    "specs/gameplay.md, the starting tier",
  );

  await h.debug.setCredits(UPGRADE_PRICES[2]);
  await h.debug.setPanel("upgrade-shop");
  await h.debug.buyUpgrade("drill");

  const bought = await h.snapshot();
  assertEqual(bought.tiers.drill, 2, "specs/upgrades.md");
  assertEqual(bought.credits, 0, "specs/upgrades.md, the price deducted");

  await h.debug.setPanel(null);
  const after = await captureReplay(h, "drill", () =>
    firstHitDamage(h, COL_AFTER),
  );
  assertCloseTo(after, DRILL_DAMAGE[1], 6, "specs/upgrades.md, drill tier 2");
  // Both cells were the same band, so the two readings are comparable.
  assertEqual(
    (await h.tileAt(COL_AFTER, ROW)).band,
    (await h.tileAt(COL_BEFORE, ROW)).band,
    "specs/world.md",
  );
  assertEqual(
    (await h.tileAt(COL_AFTER, ROW)).maxHealth,
    BAND_HEALTH.topsoil,
    "specs/world.md",
  );
});
