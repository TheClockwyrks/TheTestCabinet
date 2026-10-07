// passives/amount-bonus-on-evolved — `amountBonus` applies to an evolved
// weapon's single stat row.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`: "An evolved weapon's
// single stat row passes through damageMul, cooldownMul, areaMul, and
// amountBonus exactly as a base weapon's table row does", over the Amount rule
// "A weapon's amount is its table `amount` plus `amountBonus`" and its list of
// takers, "Beacon, Hail, Chandelier, and Blaze included".
// `amountBonus = MIRROR_AMOUNT_PER_LEVEL × mirror` is `1` at Mirror 1, and
// `BLAZE_STATS` gives `amount` `5` (`specs/evolutions.md`, Blaze), so one
// firing creates six puddles.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Mirror 1 and Blaze
// alone. Blaze replaces Oil Splash, so Oil Splash is never held beside it, and
// Blaze "fires whether or not any enemy exists", so the world holds no enemy
// and the puddles' pulses hit nothing. Where each puddle lands is a draw of
// the game's generator and is not read here. Every driver switch but
// `weaponFire` stays off.
//
// THE TOLERANCE. A count of puddles, a whole number compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BLAZE_STATS, amountBonus } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireUnder } from "./firing";

/** The Mirror level held: `amountBonus` `1`. */
const MIRROR = 1;

/** The amount Blaze's fixed `5` becomes under Mirror 1: `6`. */
const AMOUNT = BLAZE_STATS.amount + amountBonus(MIRROR);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates six Blaze puddles on one firing under Mirror 1", async () => {
  const firing = await fireUnder(h, {
    passives: [["mirror", MIRROR]],
    weapons: [["blaze", 1]],
  });
  captureStill(h, "evolved");

  assertEqual(
    firing.zones.filter((zone) => zone.kind === "puddle").length,
    AMOUNT,
    "the puddles one Blaze firing created under Mirror 1 (specs/passives.md, Amount)",
  );
});
