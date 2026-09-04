// pin/fires-alone — Pin fires with no enemy alive.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Pin"): "Pin fires
// whether or not any enemy exists." ("Cooldown timers"): "On acquisition the
// timer is `0`, so a weapon fires on the first `playing` tick it is held;
// Taper, Lantern, Halo, Oil Splash, Pin, Shard, and Flare need no target and
// fire the same way." And the targeting summary lists Pin as needing a target:
// "no". So on the tick Pin's timer is due, with `enemies` empty, the tick
// creates its darts.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run — `clearEnemies` among the
// clears, and read back as an empty `enemies` before the firing, so the field
// is provably empty rather than assumed so — with Pin at level 1 armed,
// `weaponFire` on and every other switch off, so no director spawn can put an
// enemy in the world between the read and the firing. The verdict is one
// direction: darts were created on the due tick with nothing to aim at. How
// many, where, and how fast are the row and direction checks' points.
//
// THE TOLERANCE. None: the requirement is a count of projectiles on a fixed
// tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { firePin } from "./firing";

/** Level 1 of Pin. Any row would do; the requirement is that darts are created. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates darts on Pin's due tick with no enemy alive", async () => {
  const firing = await firePin(h, LEVEL);
  captureStill(h, "alone");

  assertEqual(
    firing.before.run.enemies.length,
    0,
    "enemies alive when Pin's timer came due (specs/instrumentation.md, clearEnemies)",
  );
  assertEqual(
    firing.after.run.enemies.length,
    0,
    "enemies alive after the firing tick",
  );
  assertGreaterThan(
    firing.darts.length,
    0,
    "the darts the due tick created with no enemy alive (specs/weapons.md, Pin)",
  );
});
