// lantern/fires-alone — Lantern fires with no enemy alive.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Cooldown timers"): "On
// acquisition the timer is `0`, so a weapon fires on the first `playing` tick
// it is held; Taper, Lantern, Halo, Oil Splash, Pin, Shard, and Flare need no
// target and fire the same way." The targeting summary lists Lantern's "Needs
// a target" as "no", and its "Fires" as "around the player for a duration". So
// on the tick Lantern's timer is due, with `enemies` empty, the tick creates
// its set.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run — `clearEnemies` among the
// clears, and read back as an empty `enemies` before the firing, so the field
// is provably empty rather than assumed so — with Lantern at level 1 armed,
// `weaponFire` on and every other switch off, so no director spawn can put an
// enemy in the world between the read and the firing. The verdict is one
// direction: a set was created on the due tick with nothing to hit. How many
// lanterns, where on the circle, and with what figures are the row and
// placement checks' points.
//
// THE TOLERANCE. None: the requirement is a count of zones on a fixed tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireLantern } from "./set";

/** Level 1 of Lantern. Any row would do; the requirement is that a set appears. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates a lantern set on Lantern's due tick with no enemy alive", async () => {
  const firing = await fireLantern(h, LEVEL);
  captureStill(h, "alone");

  assertEqual(
    firing.before.run.enemies.length,
    0,
    "enemies alive when Lantern's timer came due (specs/instrumentation.md, clearEnemies)",
  );
  assertEqual(
    firing.after.run.enemies.length,
    0,
    "enemies alive after the firing tick",
  );
  assertGreaterThan(
    firing.lanterns.length,
    0,
    "the lanterns the due tick created with no enemy alive (specs/weapons.md, Lantern)",
  );
});
