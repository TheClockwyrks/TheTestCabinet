// building/upgrade-refused-when-unaffordable — an upgrade the money cannot cover
// changes nothing at all.
//
// specs/building.md, Upgrading: "An upgrade takes effect only when the tower is
// below level 3 and the current money is at least the cost. ... An upgrade that is
// unaffordable, or one asked of a level III tower, changes nothing at all."
// specs/economy.md says the same from the money's side: "a purchase the money on
// hand cannot cover does not happen at all, and nothing about the floor or the run
// changes when one is refused."
//
// THE MONEY IS THE ONLY THING WRONG. The tower is at level I, so the ceiling is
// nowhere near — `building/upgrade-stops-at-three` is what decides that refusal —
// and the purse is posed one coin below the reported cost, so the ONLY condition
// that fails is affordability.
//
// THREE READINGS, ONE PER CLAUSE OF "NOTHING AT ALL". The level is the level it
// was, the balance is the balance it was, and the stats are the stats they were.
// The stat read is `damage`, which is `baseDamage(level) * heatMultiplier(H,
// redline)` (specs/combat.md) — the figure an upgrade multiplies by 1.6 — read off
// a tower whose thermal model is held, so the heat that decides it cannot drift
// under the reading. A build that applied the upgrade and merely failed to charge
// for it is caught by the level and by the damage; a build that charged for an
// upgrade it did not apply is caught by the balance.
//
// AND THE PURSE IS READ BACK RATHER THAN ASSUMED, because a refusal that quietly
// spent what it had is exactly as wrong as one that applied the level.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";

/** The tower asked to upgrade, on a quiet anchor. */
const HELD = "arc";
const AT = FREE_SITE;

/**
 * The heat the tower is pinned at.
 *
 * Any heat above 0 would do; this one is well clear of both ends of the scale, so
 * the multiplier it gives is neither the floor of the curve nor its plateau and
 * `damage` is a figure that would visibly move if the level did.
 */
const PIN_HEAT = 40;

/**
 * How close the two damage readings must be.
 *
 * They are the same figure read twice, so any difference at all is a level that
 * moved: an upgrade applied would multiply it by 1.6 (specs/towers.md), which on
 * this tower is several whole points. `assertCloseTo(..., 6)` is a tolerance of
 * `5e-7`, which exists for float noise and nothing else.
 */
const DAMAGE_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves the level, the stats and the money alone when the upgrade is a coin short", async () => {
  await startRun(h);
  const id = await posePinnedTower(h, HELD, AT.col, AT.row, PIN_HEAT);

  const before = requireTower(await h.snapshot(), id, "at level I");
  const cost = before.upgradeCost;
  assertGreaterThan(
    cost,
    0,
    `the upgradeCost a level-I ${HELD} reports, which this check is posed one coin below`,
  );
  const purse = cost - 1;
  await h.debug.setMoney(purse);

  await h.debug.upgradeTower(id);
  const snapshot = await h.snapshot();
  const after = requireTower(snapshot, id, "after the refused upgrade");

  await h.advance(1);
  await captureStill(h, "refused");

  assertEqual(
    after.level,
    before.level,
    `the level after an upgrade asked with ${purse}, one coin below its cost of ${cost}`,
  );
  assertEqual(
    snapshot.money,
    purse,
    `the balance after an upgrade asked with ${purse}, one coin below its cost of ${cost}`,
  );
  assertCloseTo(
    after.damage,
    before.damage,
    DAMAGE_DIGITS,
    `the per-shot damage at heat ${PIN_HEAT} after the refused upgrade`,
  );
});
