// Wick — lantern/fires-alone: Lantern fires with no enemy alive.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Cooldown timers"):
// "Taper, Lantern, Halo, Oil Splash, Pin, Shard, and Flare need no target and
// fire the same way", and the targeting summary lists Lantern as needing a
// target: "no". "On acquisition the timer is `0`, so a weapon fires on the
// first `playing` tick it is held", and firing creates lantern zones ("On
// firing, `amount` lanterns appear"). So Lantern's due tick creates its set on
// a night with nothing alive.
//
// THE POSE. An isolated night: nothing alive, and the emptiness read off the
// snapshot before the firing so the point decides what it names. Lantern held
// at level 1 and fired by one tick with `weaponFire` on (`lantern/stage.ts`).
// The reading is whether that tick created any Lantern lantern zone; how many,
// and where, are the row and placement points'.
//
// TOLERANCE. None: the requirement is a count of zones on a fixed tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  type Harness,
} from "../harness";
import { lanternsOf } from "./stage";

/** The level fired; the target rule is the same at every level. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates a lantern set on the due tick with no enemy alive", async () => {
  const opened = await isolate(h);
  assertEqual(
    (opened.run.enemies ?? []).length,
    0,
    "enemies alive before the firing tick",
  );

  const firing = await fireWeapon(h, "lantern", LEVEL);
  await captureStill(h, "alone");

  assertGreaterThan(
    lanternsOf(firing).length,
    0,
    "Lantern lantern zones the due tick created with no enemy alive",
  );
});
