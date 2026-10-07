// Wick — sconce/no-target-restarts: with no enemy alive, Sconce's due tick
// launches nothing and restarts its cooldown.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Sconce"): "Sconce needs
// at least one enemy to fire"; ("Cooldown timers"): "A weapon that needs a
// target and finds no eligible target does not fire on that tick, and its
// timer is set to its current cooldown as though it had. ... The current
// cooldown is the table cooldown times `cooldownMul`, floored at
// `MIN_COOLDOWN` (`0.2`)." Row 1 of `SCONCE_LEVELS` gives cooldown `2.0`, and
// with no Oil held `cooldownMul` is `1` (`specs/passives.md`). So on the tick
// Sconce's timer is due over an empty night, no projectile is created and the
// timer reads `2.0` after that tick.
//
// WHY THE WORLD IS POSED AS IT IS. The requirement is what an empty night does
// to the timer, so the night is emptied and left empty: an isolated night with
// nothing alive, then Sconce held at level 1 and its due tick run through the
// shared `fireWeapon` (held, due, `weaponFire` on, one tick). `spawning` and
// `events` stay held, so nothing arrives during the tick to be aimed at, and
// the projectiles created on the tick are the entries whose id is at least the
// `nextId` the tick started from.
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
import { SCONCE } from "./stage";

/** The level whose row is held: cooldown `2.0`. */
const LEVEL = 1;

/** Sconce's level-1 cooldown, `2.0` seconds. */
const COOLDOWN = weaponRow(SCONCE, LEVEL).cooldown!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates no projectile on Sconce's due tick with no enemy alive and sets its timer to 2", async () => {
  await isolate(h);
  const opened = await h.snapshot();
  assertEqual(
    opened.run.enemies.length,
    0,
    "enemies alive on the isolated night",
  );

  const firing = await fireWeapon(h, SCONCE, LEVEL);
  await captureStill(h, "restart");

  assertDeepEqual(
    firing.projectiles.map((shape) => shape.id),
    [],
    "projectiles the due tick created with no enemy alive",
  );
  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, SCONCE, "the weapon in the slot that was due");
  assertNear(
    slot?.cooldown ?? NaN,
    COOLDOWN,
    TIMER_TOL,
    "Sconce's timer after the due tick with no target",
  );
});
