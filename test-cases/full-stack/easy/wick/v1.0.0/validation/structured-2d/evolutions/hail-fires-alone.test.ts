// evolutions/hail-fires-alone — Hail fires with no enemy alive.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Hail"): a dart is
// "fired horizontally in the facing direction at `speed`, removed after
// `duration` seconds, with the row's `pierce`, fired whether or not any enemy
// exists." `specs/weapons.md` ("Cooldown timers"): "the weapon fires again on
// the tick the timer is due", and only "A weapon that needs a target ... does
// not fire on that tick". So on the tick Hail's timer is due, with `enemies`
// empty, the tick creates its darts.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run — `clearEnemies` among the
// clears, read back as an empty `enemies` before the firing, so the field is
// provably empty rather than assumed so — with Hail armed, `weaponFire` the
// one switch on and `spawning` and `events` off, so no director spawn can put
// an enemy in the world between the read and the firing. The verdict is one
// direction: darts were created on the due tick with nothing to aim at. How
// many, where and how fast is `hail-row`'s and `hail-spread`'s point.
//
// THE TOLERANCE. None: a count of projectiles on a fixed tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireEvolved } from "./evolved";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates darts on Hail's due tick with no enemy alive", async () => {
  const firing = await fireEvolved(h, "hail");
  captureStill(h, "alone");

  assertEqual(
    firing.before.run.enemies.length,
    0,
    "enemies alive when Hail's timer came due (specs/instrumentation.md, clearEnemies)",
  );
  assertEqual(
    firing.after.run.enemies.length,
    0,
    "enemies alive after the firing tick",
  );
  assertGreaterThan(
    firing.projectiles.length,
    0,
    "the darts the due tick created with no enemy alive (specs/evolutions.md, Hail)",
  );
});
