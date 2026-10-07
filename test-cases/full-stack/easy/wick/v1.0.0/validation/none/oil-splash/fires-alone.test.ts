// Wick — oil-splash/fires-alone: Oil Splash fires with no enemy alive.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Oil Splash"): "Oil
// Splash fires whether or not any enemy exists." ("Cooldown timers") "On
// acquisition the timer is `0`, so a weapon fires on the first `playing` tick
// it is held; Taper, Lantern, Halo, Oil Splash, Pin, Shard, and Flare need no
// target and fire the same way". The targeting summary marks Oil Splash as
// not needing a target. So on an empty field Oil Splash's due tick creates its
// puddles.
//
// WHAT IS READ. The puddle zones the firing tick created, with the enemies
// list read empty just before it: at least one, of Oil Splash. How many is
// the row's point (`row-*`), and where they land is `scatter-*`'s.
//
// THE POSE. An isolated night, every enemy cleared and no spawn, event, or
// motion to bring one, with Oil Splash alone at level 1, due at once, fired
// through the shared `fireOil`.
//
// TOLERANCE. None: the requirement is a count of zones on a fixed tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { fireOil, puddlesOf } from "./stage";

/** Any row fires alone; the first is the plainest. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates puddles on Oil Splash's due tick with no enemy alive", async () => {
  const empty = await isolate(h);
  assertEqual(empty.run.enemies.length, 0, "enemies alive before the firing");

  const fired = await fireOil(h, LEVEL);
  await captureStill(h, "alone");

  assertEqual(
    fired.before.run.enemies.length,
    0,
    "enemies alive on the tick before the firing",
  );
  assertGreaterThan(
    puddlesOf(fired).length,
    0,
    "Oil Splash puddles the due tick created on an empty field",
  );
});
