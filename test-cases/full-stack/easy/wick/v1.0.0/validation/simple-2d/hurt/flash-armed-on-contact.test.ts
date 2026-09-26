// hurt/flash-armed-on-contact — the tick a contact hit lands leaves the
// lamplighter's hurtFlash at HURT_FLASH.
//
// THE RULE, FROM THE SPEC. specs/world.md ("Contact damage"): "The lamplighter
// carries `hurtFlash`, a timer that counts down with the contact cooldowns in
// phase 7 and is set to `HURT_FLASH` on every tick on which a contact hit
// lands, whatever the number of hits that tick", with "Seconds the hurt flash
// runs | `HURT_FLASH` | `0.3`" in that section's table.
//
// WHY 0.3 AND NOT 0.3 − TICK_DT. specs/world.md ("One tick", phase 7): "Every
// live enemy's `contactCooldown` and the lamplighter's `hurtFlash` count down,
// and, while `enemyContact` is on, an overlapping enemy whose cooldown is due
// hits". The count-down precedes the hit within the phase, so the value the hit
// sets is the value the tick leaves, and the snapshot taken after that tick
// reads 0.3 exactly.
//
// WHY ONE TICK. A posed enemy's `contactCooldown` "is `0` when the enemy
// spawns" and "a timer at `0` stays due on every tick until it is set again"
// (specs/world.md), so the hit lands on the first tick run after the pose.
//
// THE POSE. An isolated night with `enemyContact` the only switch on and one
// rat posed 20 units along +x, inside the 24 its radius 12 and PLAYER_RADIUS
// sum to. The run's `hurtFlash` is `0` before the tick, "`0` on the idle run
// and on a fresh run" (specs/world.md), so the reading after it is what the hit
// set and not what the pose carried.
//
// WHAT IS READ. `run.hurtFlash` in the snapshot of the tick the hit landed on,
// with the hp the same tick left read first as the premise that a hit landed at
// all. The figure hp falls by is `contact/contact-hit`'s point.
//
// THE TOLERANCE is FIGURE_TOLERANCE: 0.3 is a stated figure read back, so 1e-9
// is headroom for a build holding the timer as a real number and nothing more.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, HURT_FLASH } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  CONTACT_DISTANCE,
  HP_AFTER_HIT,
  OVERLAP_OFFSET,
  poseNight,
  spawnHitter,
} from "./hurt";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads hurtFlash 0.3 in the snapshot of the tick the rat's hit landed", async () => {
  const posed = poseNight(h);
  assertEqual(posed.run.hurtFlash, 0, "hurtFlash on the fresh run");
  spawnHitter(h, OVERLAP_OFFSET);
  // The pose stands inside the overlap the rule requires.
  assertLessThan(
    OVERLAP_OFFSET,
    CONTACT_DISTANCE,
    "the posed distance against the radii's sum",
  );

  const after = await h.tick(1);
  captureStill(h, "armed");

  assertWithin(
    after.run.player.hp,
    HP_AFTER_HIT,
    FIGURE_TOLERANCE,
    "hp after the rat's hit, the premise that a hit landed",
  );
  assertWithin(
    after.run.hurtFlash,
    HURT_FLASH,
    FIGURE_TOLERANCE,
    "hurtFlash on the tick the contact hit landed",
  );
});
