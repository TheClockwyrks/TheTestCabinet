// Wick — pin/fires-alone: Pin fires with no enemy alive.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Pin"): "Pin fires
// whether or not any enemy exists." and ("Cooldown timers") "On acquisition
// the timer is `0`, so a weapon fires on the first `playing` tick it is held;
// Taper, Lantern, Halo, Oil Splash, Pin, Shard, and Flare need no target and
// fire the same way". The targeting summary marks Pin as not needing a
// target. So on an empty field Pin's due tick creates its darts.
//
// WHAT IS READ. The projectiles the firing tick created, with the enemies
// list read empty just before it: at least one dart, of Pin. How many is the
// row's point (`row-*`), and where they fly is `fires-facing-*`'s.
//
// THE POSE. An isolated night — every enemy cleared, and no spawn, event, or
// motion to bring one — with Pin alone at level 1, due at once, fired through
// the shared `fireWeapon`.
//
// TOLERANCE. None: the requirement is a count of projectiles on a fixed tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { firePin } from "./stage";

/** Any row fires alone; the first is the plainest. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates darts on Pin's due tick with no enemy alive", async () => {
  const empty = await isolate(h);
  assertEqual(empty.run.enemies.length, 0, "enemies alive before the firing");

  const fired = await firePin(h, LEVEL);
  await captureStill(h, "alone");

  assertEqual(
    fired.before.run.enemies.length,
    0,
    "enemies alive on the tick before the firing",
  );
  const darts = fired.projectiles.filter((shape) => shape.weapon === "pin");
  assertGreaterThan(
    darts.length,
    0,
    "Pin darts the due tick created on an empty field",
  );
});
