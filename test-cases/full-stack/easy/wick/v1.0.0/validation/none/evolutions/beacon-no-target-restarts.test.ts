// Wick — evolutions/beacon-no-target-restarts: with no enemy alive, Beacon's
// due tick fires nothing and restarts its cooldown.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Beacon"): "Beacon
// needs at least one enemy to fire." `specs/weapons.md` ("Cooldown timers"): "A
// weapon that needs a target and finds no eligible target does not fire on that
// tick, and its timer is set to its current cooldown as though it had. ... The
// current cooldown is the table cooldown times `cooldownMul`, floored at
// `MIN_COOLDOWN` (`0.2`)", and an evolved weapon "reads every common rule of
// that file unchanged" (`specs/evolutions.md`). `BEACON_STATS` gives cooldown
// `0.25`, and `cooldownMul` is `1` with no Oil held (`specs/passives.md`), so
// the current cooldown is `0.25`, above the floor. So on the tick Beacon's timer
// is due over an empty night, no projectile is created and the timer reads
// `0.25` after that tick.
//
// THE POSE. An isolated night with nothing alive — no spawn, no event, no
// motion — then Beacon held at level 1 and its due tick run through the shared
// `fireWeapon`. The projectiles created on the tick are the entries whose id is
// at least the `nextId` the tick started from.
//
// TOLERANCE. None on the count, which is exact; `TIMER_TOL` on the timer read
// straight after the tick, which a build sets from the fixed figure rather than
// integrating.

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

/** Beacon's fixed cooldown, `0.25` seconds. */
const COOLDOWN = weaponRow("beacon").cooldown as number;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates no projectile on Beacon's due tick with no enemy alive and sets its timer to 0.25", async () => {
  await isolate(h);
  const opened = await h.snapshot();
  assertEqual(
    opened.run.enemies.length,
    0,
    "enemies alive on the isolated night",
  );

  const firing = await fireWeapon(h, "beacon", 1);
  await captureStill(h, "restart");

  assertDeepEqual(
    firing.projectiles.map((shape) => shape.id),
    [],
    "projectiles the due tick created with no enemy alive",
  );
  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, "beacon", "the weapon in the slot that was due");
  assertNear(
    slot?.cooldown ?? NaN,
    COOLDOWN,
    TIMER_TOL,
    "Beacon's timer after the due tick with no target",
  );
});
