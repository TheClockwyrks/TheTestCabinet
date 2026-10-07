// Wick — halo/row-6: row 6 of `HALO_LEVELS` is in force at level 6.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Halo"), row 6 of
// `HALO_LEVELS`: damage `5`, cooldown `0.80`, radius `110`. The aura
// is "a circle of `radius`" whose "`radius` and `damage` are recomputed on
// every tick from the level, `areaMul`, and `damageMul` in force on that
// tick", and on a pulse "every enemy whose circle overlaps the aura takes
// `damage`, and the timer is set to the current cooldown". ("Derived stats")
// the radius and the damage are the table value times `areaMul` and
// `damageMul`, both `1` with no passive held, and ("Cooldown timers") the
// current cooldown is "the table cooldown times `cooldownMul`, floored at
// `MIN_COOLDOWN`", `1` again. A rat spawns with `15` hp at a run clock of `0`
// (`specs/enemies.md`). So the first tick Halo is held at level 6 leaves
// one aura of radius `110` and damage `5`, the overlapping rat at `10`, and
// the timer at `0.80`.
//
// THE POSE. An isolated night with one rat `40` along `+x` from the
// lamplighter, inside the `110 + 12` at which its circle and the aura
// overlap, then Halo held at level 6 and its first tick run through the
// shared `fireWeapon` (`halo/stage.ts`): every switch but `weaponFire` is
// held, so the rat stands where it was posed and hits nothing back, and the
// one tick creates the aura, pulses once, and sets the timer.
//
// TOLERANCE. `FLOAT_TOL` on the radius, the damage, and the rat's hp;
// `TIMER_TOL` on the timer; the aura count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import { checkHaloRow } from "./stage";

/** The level whose row is asserted. */
const LEVEL = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds Halo at level 6 with row 6's figures: radius 110, damage 5, a rat at 10, timer 0.80", async () => {
  await checkHaloRow(h, LEVEL);
});
