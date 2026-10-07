// Wick — flare/row-2: row 2 of `FLARE_LEVELS` is in force at level 2.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Flare"), row 2 of
// the table: damage `100`, cooldown `55`, radius `640`; ("Targeting
// summary") "row `i` is level `i + 1`", so level 2 reads this row. "On
// firing, every enemy within `radius` of the player's center takes `damage`
// on that tick"; ("Shapes and overlap") "a burst's `radius` is its Flare
// `radius`" and "An enemy is within `d` of a point when the distance from
// that point to the enemy's center is at most `d`"; ("Derived stats") the
// radius is the "table value × `areaMul`" and the damage the "table value ×
// `damageMul`", both `1` with no passive held (`specs/passives.md`); ("Hits
// and death") "A hit removes the shape's damage per hit from the enemy's
// `hp`"; and ("Cooldown timers") "After firing, the timer is set to the
// weapon's current cooldown", the table cooldown times a `cooldownMul` of
// `1`. So the firing tick creates one burst zone of radius `640` carrying
// damage `100`, the owl's hp falls by `100`, and the slot reads `55`
// after it.
//
// THE POSE. An isolated night with one owl `100` along `+x` from the
// lamplighter's center, inside every row's `640`, and Flare held at level
// 2 through `setWeapon` with its timer at `0`, fired by one tick with
// `weaponFire` on; the check itself is `checkFlareRow` in `flare/stage.ts`,
// which every row shares, so the eight points differ in the row alone. An
// owl's `2000` hp, "unscaled" as every elite's is, outlives the `100`, so
// the removal reads exactly.
//
// TOLERANCE. `FLOAT_TOL` on the burst's radius and damage and on the owl's
// hp; `TIMER_TOL` on the timer; the burst count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import { checkFlareRow } from "./stage";

/** The level this row is read at. */
const LEVEL = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates one burst zone of radius 640 with damage 100, removes 100 from an owl inside it, and sets the timer to 55 at level 2", async () => {
  await checkFlareRow(h, LEVEL);
});
