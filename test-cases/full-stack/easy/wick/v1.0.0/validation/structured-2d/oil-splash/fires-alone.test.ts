// oil-splash/fires-alone — Oil Splash fires with no enemy alive.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Oil Splash"): "Oil
// Splash fires whether or not any enemy exists." ("Cooldown timers"): "On
// acquisition the timer is `0`, so a weapon fires on the first `playing` tick
// it is held; Taper, Lantern, Halo, Oil Splash, Pin, Shard, and Flare need no
// target and fire the same way." And the targeting summary lists Oil Splash
// as needing a target: "no". So on the tick Oil Splash's timer is due, with
// `enemies` empty, the tick creates its puddles.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run — `clearEnemies` among the
// clears, and read back as an empty `enemies` before the firing, so the field
// is provably empty rather than assumed so — with Oil Splash at level 1
// armed, `weaponFire` on and every other switch off, so no director spawn can
// put an enemy in the world between the read and the firing. The verdict is
// one direction: puddles were created on the due tick with nothing to hit.
// How many, where, and with what figures are the row and scatter checks'
// points.
//
// THE TOLERANCE. None: the requirement is a count of zones on a fixed tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireOilSplash } from "./firing";

/** Level 1 of Oil Splash. Any row would do; the requirement is that puddles are created. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates puddles on Oil Splash's due tick with no enemy alive", async () => {
  const firing = await fireOilSplash(h, LEVEL);
  captureStill(h, "alone");

  assertEqual(
    firing.before.run.enemies.length,
    0,
    "enemies alive when Oil Splash's timer came due (specs/instrumentation.md, clearEnemies)",
  );
  assertEqual(
    firing.after.run.enemies.length,
    0,
    "enemies alive after the firing tick",
  );
  assertGreaterThan(
    firing.puddles.length,
    0,
    "the puddles the due tick created with no enemy alive (specs/weapons.md, Oil Splash)",
  );
});
