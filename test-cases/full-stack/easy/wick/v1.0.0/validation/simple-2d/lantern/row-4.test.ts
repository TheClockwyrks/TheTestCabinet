// Wick — lantern/row-4: row 4 of LANTERN_LEVELS is in force at level 4.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Lantern"), the level table: row 4 is damage
//     `15`, cooldown `3.0`, orbit `100`, radius `16`, duration `3.5`,
//     amount `2`; "Every level table has `MAX_WEAPON_LEVEL` (`8`) rows;
//     row `i` is level `i + 1`".
//   - `specs/weapons.md` ("Lantern"): "On firing, `amount` lanterns appear on
//     a circle of radius `orbit` around the player's center ... Each lantern
//     is a circle of `radius`, and each is a zone with `ttl` set to
//     `duration`", and "On firing, Lantern's cooldown timer is set to
//     `duration` plus the current cooldown, both read on that tick", so the
//     timer reads 3.5 + 3.0 = 6.5 after the firing tick.
//   - The derived-stat, tick-order, and timer rules the reading rests on are
//     quoted in `row.ts`, which every row point of this category shares.
//
// WHAT IS READ. After the firing tick: 2 Lantern lanterns, each of radius
// 16, damage 15, and `ttl` 3.5, 100 units from the lamplighter's center; and
// Lantern's timer, 6.5.
//
// WHY THE NIGHT IS POSED AS IT IS. Lantern alone at level 4, no passive held,
// nothing on the field, every switch off but `weaponFire`, as `row.ts` states.
//
// TOLERANCE. `FIGURE_TOLERANCE` on every figure but the count, as `row.ts`
// states.

import { afterEach, beforeEach, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import { assertRowInForce } from "./row";

/** The level this point holds Lantern at. */
const LEVEL = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates 2 lanterns of row 4 at level 4 and sets the timer to 6.5", async () => {
  await assertRowInForce(h, LEVEL);
});
