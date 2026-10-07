// Wick — lantern/row-7: row 7 of LANTERN_LEVELS is in force at level 7.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Lantern"), the level table: row 7 is damage
//     `20`, cooldown `2.5`, orbit `110`, radius `18`, duration `4.0`,
//     amount `3`; "Every level table has `MAX_WEAPON_LEVEL` (`8`) rows;
//     row `i` is level `i + 1`".
//   - `specs/weapons.md` ("Lantern"): "On firing, `amount` lanterns appear on
//     a circle of radius `orbit` around the player's center ... Each lantern
//     is a circle of `radius`, and each is a zone with `ttl` set to
//     `duration`", and "On firing, Lantern's cooldown timer is set to
//     `duration` plus the current cooldown, both read on that tick", so the
//     timer reads 4.0 + 2.5 = 6.5 after the firing tick.
//   - The derived-stat, tick-order, and timer rules the reading rests on are
//     quoted in `row.ts`, which every row point of this category shares.
//
// WHAT IS READ. After the firing tick: 3 Lantern lanterns, each of radius
// 18, damage 20, and `ttl` 4.0, 110 units from the lamplighter's center; and
// Lantern's timer, 6.5.
//
// WHY THE NIGHT IS POSED AS IT IS. Lantern alone at level 7, no passive held,
// nothing on the field, every switch off but `weaponFire`, as `row.ts` states.
//
// TOLERANCE. `FIGURE_TOLERANCE` on every figure but the count, as `row.ts`
// states.

import { afterEach, beforeEach, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import { assertRowInForce } from "./row";

/** The level this point holds Lantern at. */
const LEVEL = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates 3 lanterns of row 7 at level 7 and sets the timer to 6.5", async () => {
  await assertRowInForce(h, LEVEL);
});
