// flare/no-lingering-damage — the burst damages nothing after its tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Flare"): "every enemy
// within `radius` of the player's center takes `damage` on that tick" and
// "The burst is drawn for `FLARE_FLASH` (`0.4`) seconds and has no hitbox
// after the tick it fires." `specs/state.md` (`ZoneState`, `hits`) says the
// same from the state's side: a burst holds an empty `hits` list "since a
// puddle and an aura pulse over every enemy they overlap and a slash, a
// strike, and a burst hit on the tick they appear". So a moth standing inside
// a burst that fired on an earlier tick takes nothing: its `hp` reads the 5 it
// spawned with (`specs/enemies.md`), where a build whose burst kept its hitbox
// for the flash would have killed it with row 1's damage of 100.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy at all and
// Flare held at level 1, its timer at 0 and `weaponFire` the one switch on, so
// the first tick fires the burst onto an empty field. Only then is a moth
// spawned, `INSIDE` units from the lamplighter and well within the burst's
// radius of 640, and one more tick is run. The burst is read again on that
// tick before anything is graded, since its `ttl` of 0.4 is due 24 ticks after
// the tick it was set on (`specs/world.md`, Timers): what the moth stands
// under is a live burst, not a zone already gone. `enemyContact`,
// `enemyMotion`, and `despawning` are off, so nothing but the burst could
// touch the moth, and Flare's timer reads 60 after the firing, so no second
// burst arrives on top of it.
//
// THE TOLERANCE. None: what is read is whether the tick took damage off the
// moth, a yes or no, with `REAL_EPS` separating a lowered `hp` from the one it
// spawned with, far below the 100 a burst would have removed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { armFlare, hpOf, INSIDE, theBurst, tookDamage } from "./burst";

/** The row under test: radius 640, damage 100. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves a moth spawned inside the burst on the tick after the firing at full hp", async () => {
  isolate(h);
  armFlare(h, LEVEL);
  theBurst(await advanceTicks(h, 1));

  const moth = placeEnemyNear(h, "moth", INSIDE, 0);
  const before = hpOf(h.snapshot(), moth);
  const later = await advanceTicks(h, 1);
  captureStill(h, "once");
  theBurst(later);

  assertEqual(
    tookDamage(later, moth, before),
    false,
    "whether the burst damaged the moth spawned inside it on the tick after the firing",
  );
});
