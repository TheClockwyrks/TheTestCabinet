// Wick — ember/no-target-restarts: with no enemy alive, Ember's due tick fires
// nothing and restarts its cooldown.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Ember"): "Ember needs
// at least one enemy to fire"; ("Cooldown timers"): "A weapon that needs a
// target and finds no eligible target does not fire on that tick, and its
// timer is set to its current cooldown as though it had. ... The current
// cooldown is the table cooldown times `cooldownMul`, floored at
// `MIN_COOLDOWN` (`0.2`)." Row 1 of `EMBER_LEVELS` gives cooldown `1.2`, and
// with no Oil held `cooldownMul` is `1` (`specs/passives.md`). So on the tick
// Ember's timer is due over an empty night, no projectile is created and the
// timer reads `1.2` after that tick.
//
// THE POSE. An isolated night with nothing alive, then Ember held at level 1
// and its due tick run through the shared `fireWeapon` (held, due,
// `weaponFire` on, one tick). Nothing else runs: no spawns, so nothing arrives
// to be aimed at, and no motion. The projectiles created on the tick are the
// entries whose id is at least the `nextId` the tick started from.
//
// TOLERANCE. None on the count, which is exact; `TIMER_TOL` on the timer read
// straight after the tick, which a build sets from the table figure rather
// than integrating.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { TIMER_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  type Harness,
} from "../harness";
import { EMBER } from "./stage";

/** The level whose row is held: cooldown `1.2`. */
const LEVEL = 1;

/** Ember's level-1 cooldown, `1.2` seconds. */
const COOLDOWN = weaponRow(EMBER, LEVEL).cooldown!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates no projectile on Ember's due tick with no enemy alive and sets its timer to 1.2", async () => {
  await isolate(h);
  const opened = await h.snapshot();
  assertEqual(
    opened.run.enemies.length,
    0,
    "enemies alive on the isolated night",
  );

  const firing = await fireWeapon(h, EMBER, LEVEL);
  await captureStill(h, "restart");

  assertDeepEqual(
    firing.projectiles.map((shape) => shape.id),
    [],
    "projectiles the due tick created with no enemy alive",
  );
  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, EMBER, "the weapon in the slot that was due");
  assertNear(
    slot?.cooldown ?? NaN,
    COOLDOWN,
    TIMER_TOL,
    "Ember's timer after the due tick with no target",
  );
});
