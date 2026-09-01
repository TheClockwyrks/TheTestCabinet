// Wick — pin/row-6: `PIN_LEVELS` row 6 is in force at level 6.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Pin"), row 6 of
// `PIN_LEVELS`, read as `pin/stage.ts` states: "row `i` is level `i + 1`"
// ("Targeting summary"), so at level 6 the firing tick creates 4 projectiles
// of radius `6` with damage `10`, speed `600`, pierce `2`, and ttl `1.5`, and
// the timer reads `0.4` after the firing.
//
// THE POSE. An isolated night with Pin alone at level 6, due at once, and one
// tick with `weaponFire` on; `pin/stage.ts` says why nothing else runs.
//
// TOLERANCE. As `pin/stage.ts` states: `FLOAT_TOL` on radius, damage, and
// speed, `TIMER_TOL` on the timer and the ttl, none on the count and the
// pierce.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { assertRowFiring, firePin } from "./stage";

/** The level this row is in force at. */
const LEVEL = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires row 6 of PIN_LEVELS at level 6", async () => {
  await isolate(h);
  const fired = await firePin(h, LEVEL);
  await captureStill(h, "row");
  assertRowFiring(fired, LEVEL);
});
