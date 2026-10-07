// passives/cooldown-mul-on-evolved — cooldownMul reads an evolved weapon's
// fixed row exactly as it reads a base weapon's table row.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("The derived stats"): "An
// evolved weapon's single stat row passes through damageMul, cooldownMul,
// areaMul, and amountBonus exactly as a base weapon's table row does", with
// cooldownMul = 1 − OIL_COOLDOWN_PER_LEVEL × oil and OIL_COOLDOWN_PER_LEVEL
// 0.08, so Oil 2 gives 0.84; and ("Cooldown") the current cooldown is
// "max(MIN_COOLDOWN, table cooldown × cooldownMul)" with MIN_COOLDOWN 0.2.
// specs/evolutions.md ("Passives still apply") says the same: "cooldown is the
// fixed cooldown times `cooldownMul`, floored at MIN_COOLDOWN (0.2)".
// PYRE_STATS gives cooldown 1.2 (specs/evolutions.md, "Pyre"), so the timer
// reads 1.2 × 0.84 = 1.008, above the floor.
//
// THE WORLD. An isolated playing run: nothing on the field, Oil at level 2 in
// the first passive slot, Pyre alone with its timer at 0, and every driver
// switch off but weaponFire. Pyre is Taper's slash and needs no target, so no
// enemy is posed and nothing can be hit.
//
// WHAT IS READ. Pyre's timer after the firing tick, beside the slashes it left,
// so the timer is read after a real firing rather than off an untouched pose.
// specs/world.md ("One tick"), phase 5, has the timer count down and the due
// weapon fire within the same tick, so the reading is the freshly set figure.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9), a product of two stated figures read back
// as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  PYRE_STATS,
  cooldownFor,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";
import { armAll, holdPassives, slotOf, timerOf } from "./night";

/** The passives held: Oil at level 2. */
const HELD: HeldPassives = { oil: 2 };

/** max(0.2, 1.2 × 0.84) = 1.008. */
const COOLDOWN = cooldownFor(PYRE_STATS.cooldown, HELD);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets Pyre's timer to 1.008 with Oil 2 held", async () => {
  isolate(h);
  holdPassives(h, HELD);
  const slots = armAll(h, [["pyre", 1]]);

  const after = await h.tick(1);
  captureStill(h, "evolved");

  assertLength(
    zonesOfKind(after, "slash"),
    PYRE_STATS.amount,
    "Pyre slashes after the firing tick",
  );
  assertWithin(
    timerOf(after, slotOf(slots, "pyre")),
    COOLDOWN,
    FIGURE_TOLERANCE,
    "Pyre's timer after the firing tick with Oil 2 held",
  );
});
