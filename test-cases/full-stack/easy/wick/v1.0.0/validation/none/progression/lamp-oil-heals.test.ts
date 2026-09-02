// progression/lamp-oil-heals — accepting lamp-oil heals LAMP_OIL_HEAL.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("Choosing"), the offer
// table: "`lamp-oil` | `hp` rises by `LAMP_OIL_HEAL`, capped at `maxHp`", with
// "Health it restores | `LAMP_OIL_HEAL` | `30`". `maxHp` is `BASE_MAX_HP`
// (`100`) with no Tallow held, as specs/passives.md gives it, so from `hp` `50`
// the heal lands whole and reads `80`. specs/instrumentation.md's `choose(index)`
// "accepts the offer at `index` ... exactly as moving the highlight there and
// pressing `confirm` would: the item is applied".
//
// WHY THE WORLD IS POSED AS IT IS. The empty-pool loadout, which is the only
// arrangement lamp-oil is offered under, and none of its six passives touches
// `maxHp`, so the ceiling is `BASE_MAX_HP` and the posed `50` is far enough
// under it that the heal is not clipped: the cap is
// `contact/heal-caps-at-max-hp`'s point, not this one. `hp` is posed with
// `setHp`, "a real number at most `maxHp`", and the acceptance goes through
// `choose` rather than a key press, so a build with a broken menu fails the menu
// points instead of this one.
//
// THE TOLERANCE. `hp` is a real number, so it is read within `FLOAT_TOL`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import {
  BASE_MAX_HP,
  FLOAT_TOL,
  LAMP_OIL_HEAL,
  LAMP_OIL_ID,
} from "../constants";
import {
  captureStill,
  createHarness,
  openLevelUp,
  player,
  type Harness,
} from "../harness";
import { poseEmptyPool } from "./stage";

/** The health posed: far enough under `BASE_MAX_HP` that the whole heal lands. */
const POSED_HP = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises hp by LAMP_OIL_HEAL when the fallback offer is accepted", async () => {
  await poseEmptyPool(h);
  await h.debug.setHp(POSED_HP);

  const overlay = await openLevelUp(h);
  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertDeepEqual(
    overlay.run.offers,
    [LAMP_OIL_ID],
    "the offers over an empty pool",
  );
  assertEqual(
    overlay.run.maxHp,
    BASE_MAX_HP,
    "the ceiling the heal is capped at",
  );
  assertNear(
    player(overlay).hp,
    POSED_HP,
    FLOAT_TOL,
    "the health before the heal",
  );

  await h.debug.choose(0);
  const after = await h.snapshot();
  await captureStill(h, "healed");

  assertNear(
    player(after).hp,
    POSED_HP + LAMP_OIL_HEAL,
    FLOAT_TOL,
    "the health after accepting lamp-oil",
  );
});
