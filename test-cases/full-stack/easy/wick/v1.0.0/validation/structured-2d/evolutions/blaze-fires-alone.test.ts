// evolutions/blaze-fires-alone — Blaze fires with no enemy alive.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Blaze"): "Blaze
// fires whether or not any enemy exists." `specs/weapons.md` ("Cooldown
// timers"): "the weapon fires again on the tick the timer is due", and only "A
// weapon that needs a target and finds no eligible target does not fire on that
// tick". So on the tick Blaze's timer is due, with `enemies` empty, the tick
// creates its puddles.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run — `clearEnemies` among the
// clears, read back as an empty `enemies` before the firing, so the field is
// provably empty rather than assumed so — with Blaze armed, `weaponFire` the
// one switch on and `spawning` and `events` off, so no director spawn can put
// an enemy in the world between the read and the firing. The verdict is one
// direction: puddles were created on the due tick with nothing to burn. How
// many and where is `blaze-row`'s and `blaze-scatter`'s point.
//
// THE TOLERANCE. None: a count of zones on a fixed tick.

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

it("creates puddles on Blaze's due tick with no enemy alive", async () => {
  const firing = await fireEvolved(h, "blaze");
  captureStill(h, "alone");

  assertEqual(
    firing.before.run.enemies.length,
    0,
    "enemies alive when Blaze's timer came due (specs/instrumentation.md, clearEnemies)",
  );
  assertEqual(
    firing.after.run.enemies.length,
    0,
    "enemies alive after the firing tick",
  );
  assertGreaterThan(
    firing.zones.length,
    0,
    "the puddles the due tick created with no enemy alive (specs/evolutions.md, Blaze)",
  );
});
