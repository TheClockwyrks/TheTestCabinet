// passives/cooldown-mul-on-evolved — `cooldownMul` applies to an evolved
// weapon's single stat row.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`: "An evolved weapon's
// single stat row passes through damageMul, cooldownMul, areaMul, and
// amountBonus exactly as a base weapon's table row does", over the Cooldown
// rule "cooldown = max(MIN_COOLDOWN, table cooldown × cooldownMul)".
// `specs/evolutions.md` (Passives still apply) repeats it: "cooldown is the
// fixed cooldown times `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`)".
// `cooldownMul` is `1 − 0.08 × oil`, so `0.84` at Oil 2, and `PYRE_STATS`
// gives `cooldown` `1.2` (`specs/evolutions.md`, Pyre), so the timer reads
// `1.2 × 0.84 = 1.008`, well above the floor.
//
// WHEN THE TIMER IS READ. On the tick Pyre fires, after the set: "After
// firing, the timer is set to the weapon's current cooldown"
// (`specs/weapons.md`, Cooldown timers).
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Oil 2 and Pyre
// alone. Pyre replaces Taper, so Taper is never held beside it, and Pyre
// slashes on both sides without needing a target, so the world holds no enemy
// at all and nothing but the timer is read. Every driver switch but
// `weaponFire` stays off.
//
// THE TOLERANCE. `REAL_EPS` on the timer, one fixed figure times one
// multiplier; the unscaled figure, `1.2`, is nearly a fifth of a second away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { PYRE_STATS, REAL_EPS, cooldownOf } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireUnder, timerOf } from "./firing";

/** The Oil level held: `cooldownMul` `0.84`. */
const OIL = 2;

/** The cooldown Pyre's fixed `1.2` becomes under Oil 2: `1.008`. */
const COOLDOWN = cooldownOf(PYRE_STATS.cooldown, OIL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("sets Pyre's timer to 1.008 under Oil 2", async () => {
  const firing = await fireUnder(h, {
    passives: [["oil", OIL]],
    weapons: [["pyre", 1]],
  });
  captureStill(h, "evolved");

  assertEqual(
    firing.zones.filter((zone) => zone.kind === "slash").length,
    PYRE_STATS.amount,
    "the slashes the firing tick created (specs/evolutions.md, Pyre)",
  );
  assertNear(
    timerOf(firing, "pyre"),
    COOLDOWN,
    REAL_EPS,
    "Pyre's timer after a firing under Oil 2 (specs/passives.md, Cooldown)",
  );
});
