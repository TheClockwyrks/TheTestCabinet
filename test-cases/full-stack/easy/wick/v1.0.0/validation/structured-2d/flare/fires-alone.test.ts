// flare/fires-alone — Flare fires with no enemy alive.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Flare"): "Flare fires
// whether or not any enemy exists", and the targeting summary marks Flare as
// needing no target, which is what separates it from the weapons for which "A
// weapon that needs a target and finds no eligible target does not fire on
// that tick". So a due tick with the field empty is a firing: one zone of
// kind `burst` (`specs/state.md`, `ZoneState`) exists after it. ("Cooldown
// timers") "After firing, the timer is set to the weapon's current cooldown",
// "the table cooldown times `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`)",
// so with no Oil held the timer reads row 1's cooldown of 60 after that tick
// — the reading that tells a firing apart from a tick that did nothing at
// all, since a timer left at 0 is due again on the next tick.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding no enemy at all,
// with Flare held at level 1, its timer at 0 and `weaponFire` the one switch
// on, so the first tick is Flare's due tick and nothing else runs on it.
// `spawning` and `events` are off, so the director puts no enemy on the field
// before that tick, which is exactly the emptiness this point is about.
//
// THE TOLERANCE. `REAL_EPS` on the timer, a table value times a multiplier of
// `1`; the burst count is a whole number read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLARE_LEVELS, REAL_EPS, cooldownOf } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";
import { armFlare, bursts } from "./burst";

/** The row under test: cooldown 60. */
const LEVEL = 1;
const ROW = FLARE_LEVELS[LEVEL - 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates its burst and sets its timer to 60 on a due tick with the field empty", async () => {
  const posed = isolate(h);
  assertEqual(posed.run.enemies.length, 0, "the enemies the posed run holds");
  const slot = armFlare(h, LEVEL);

  const fired = await advanceTicks(h, 1);
  captureStill(h, "alone");

  assertEqual(
    bursts(fired).length,
    1,
    "the zones of kind burst with weapon flare after the due tick, with no enemy alive (specs/weapons.md, Flare)",
  );
  assertNear(
    fired.run.weapons[slot].cooldown,
    cooldownOf(ROW.cooldown, 0),
    REAL_EPS,
    "Flare's timer after the firing, against row 1's cooldown with no Oil held",
  );
});
