// Wick — flare/fires-alone: Flare fires with nothing alive to fire at.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Flare"): "Flare fires
// whether or not any enemy exists"; ("Targeting summary") Flare's "Needs a
// target" column reads "no", and ("Cooldown timers") "Taper, Lantern, Halo,
// Oil Splash, Pin, Shard, and Flare need no target and fire the same way",
// against the rule for a weapon that does need one, which "does not fire on
// that tick, and its timer is set to its current cooldown as though it had".
// So on an empty field the due tick still creates the burst, "one zone of
// kind `burst`" (`specs/state.md`), and ("Cooldown timers") "After firing, the
// timer is set to the weapon's current cooldown", "the table cooldown times
// `cooldownMul`", `1` with no Oil held (`specs/passives.md`). Row 1 of
// `FLARE_LEVELS` gives cooldown `60`, so the slot reads `60` after the tick.
//
// THE POSE. An isolated night with no enemy alive, which is what `isolate`
// leaves, and Flare held at level 1 and its due tick run through the shared
// `fireWeapon` (held, due, `weaponFire` on, one tick). `spawning` and `events`
// are held, so nothing arrives on the field during the tick and the firing is
// read against an empty world.
//
// TOLERANCE. The burst count and the empty field are exact; `TIMER_TOL` on the
// timer read straight after the tick, which a build sets from the table figure
// rather than integrating.

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
import { FLARE, oneBurst } from "./stage";

/** The level whose row is held: cooldown `60`. */
const LEVEL = 1;

/** Flare's level-1 cooldown, `60` seconds. */
const COOLDOWN = weaponRow(FLARE, LEVEL).cooldown!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates its burst on the due tick with nothing alive and sets its timer to 60", async () => {
  await isolate(h);

  const firing = await fireWeapon(h, FLARE, LEVEL);
  await captureStill(h, "alone");

  assertDeepEqual(
    (firing.before.run.enemies ?? []).map((enemy) => enemy.id),
    [],
    "enemies alive on the tick Flare was due",
  );
  oneBurst(firing.zones, "the due tick on an empty field");
  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, FLARE, "the weapon in the slot that fired");
  assertNear(
    slot?.cooldown ?? NaN,
    COOLDOWN,
    TIMER_TOL,
    "Flare's timer after the firing tick on an empty field",
  );
});
