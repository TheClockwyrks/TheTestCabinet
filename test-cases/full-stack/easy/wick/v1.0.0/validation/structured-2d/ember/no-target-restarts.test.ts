// ember/no-target-restarts — Ember restarts its cooldown with no enemy alive.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Cooldown timers"): "A
// weapon that needs a target and finds no eligible target does not fire on
// that tick, and its timer is set to its current cooldown as though it had."
// Ember "needs at least one enemy to fire" (Ember), and "The current cooldown
// is the table cooldown times `cooldownMul`, floored at `MIN_COOLDOWN`
// (`0.2`)", which with no Oil held is level 1's table cooldown of `1.2`
// (`specs/passives.md` gives `cooldownMul` as `1` at Oil level 0). So on the
// due tick with no enemy alive, no projectile is created and the timer reads
// `1.2` after that tick.
//
// WHY THE TIMER READS THE COOLDOWN AND NOT A COUNTED-DOWN VALUE. The timer is
// set on the due tick itself, after the count-down that made it due
// (`specs/world.md`, "One tick", phase 5: "each held weapon's timer counts
// down, and each weapon whose timer is due fires"); the count-down of the
// next tick has not happened yet when the snapshot is read.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy at all, Ember
// at level 1 with its timer at 0, `weaponFire` on and every other switch off,
// so nothing spawns an enemy into the world before the due tick and nothing
// but Ember's own rule sets its timer.
//
// THE TOLERANCE. `REAL_EPS` on the timer, a table value times a multiplier of
// `1`; a build that left the timer at `0` is off by the whole cooldown, and
// one that fired anyway shows a projectile.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { cooldownOf, EMBER_LEVELS, REAL_EPS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireEmber } from "./firing";

/** Level 1 of Ember: table cooldown 1.2. */
const LEVEL = 1;
const ROW = EMBER_LEVELS[LEVEL - 1];

/** The current cooldown with no Oil held: `max(0.2, 1.2 × 1)`. */
const CURRENT_COOLDOWN = cooldownOf(ROW.cooldown, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates no projectile on the due tick and sets the timer to 1.2", async () => {
  const firing = await fireEmber(h, LEVEL, []);
  captureStill(h, "restart");

  assertEqual(
    firing.after.run.enemies.length,
    0,
    "the enemies alive on the due tick",
  );
  assertEqual(
    firing.after.run.projectiles.length,
    0,
    "the projectiles after Ember's due tick with no enemy alive",
  );
  assertNear(
    firing.after.run.weapons[firing.slot].cooldown,
    CURRENT_COOLDOWN,
    REAL_EPS,
    "Ember's timer after the due tick, against its current cooldown",
  );
});
