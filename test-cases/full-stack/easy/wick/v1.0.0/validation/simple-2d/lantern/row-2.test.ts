// Wick — lantern/row-2: row 2 of LANTERN_LEVELS is in force at level 2.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Lantern"), the level table: row 2 is damage
//     `10`, cooldown `3.0`, orbit `90`, radius `14`, duration `3.0`,
//     amount `2`; "Every level table has `MAX_WEAPON_LEVEL` (`8`) rows;
//     row `i` is level `i + 1`".
//   - `specs/weapons.md` ("Lantern"): "On firing, `amount` lanterns appear on
//     a circle of radius `orbit` around the player's center ... Each lantern
//     is a circle of `radius`, and each is a zone with `ttl` set to
//     `duration`", and "On firing, Lantern's cooldown timer is set to
//     `duration` plus the current cooldown, both read on that tick", so the
//     timer reads 3.0 + 3.0 = 6.0 after the firing tick.
//   - The derived-stat, tick-order, and timer rules the reading rests on are
//     quoted in `row.ts`, which every row point of this category shares.
//
// WHAT IS READ. After the firing tick: 2 Lantern lanterns, each of radius
// 14, damage 10, and `ttl` 3.0, 90 units from the lamplighter's center; and
// Lantern's timer, 6.0.
//
// WHY THE NIGHT IS POSED AS IT IS. Lantern alone at level 2, no passive held,
// nothing on the field, every switch off but `weaponFire`, as `row.ts` states.
//
// TOLERANCE. `FIGURE_TOLERANCE` on every figure but the count, as `row.ts`
// states.

import { afterEach, beforeEach, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import { assertRowInForce } from "./row";

/** The level this point holds Lantern at. */
const LEVEL = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates 2 lanterns of row 2 at level 2 and sets the timer to 6.0", async () => {
  await assertRowInForce(h, LEVEL);
});
