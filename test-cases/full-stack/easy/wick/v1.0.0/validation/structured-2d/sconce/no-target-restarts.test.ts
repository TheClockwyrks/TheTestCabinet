// sconce/no-target-restarts — Sconce restarts its cooldown with no enemy
// alive.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Cooldown timers"): "A
// weapon that needs a target and finds no eligible target does not fire on
// that tick, and its timer is set to its current cooldown as though it had."
// Sconce "needs at least one enemy to fire" (Sconce), and "The current
// cooldown is the table cooldown times `cooldownMul`, floored at
// `MIN_COOLDOWN` (`0.2`)", which with no Oil held is level 1's table cooldown
// of `2.0` (`specs/passives.md` gives `cooldownMul` as `1` at Oil level 0). So
// on the due tick with no enemy alive, no projectile is created and the timer
// reads `2.0` after that tick.
//
// WHY THE TIMER READS THE COOLDOWN AND NOT A COUNTED-DOWN VALUE. The timer is
// set on the due tick itself, after the count-down that made it due
// (`specs/world.md`, "One tick", phase 5: "each held weapon's timer counts
// down, and each weapon whose timer is due fires"); the count-down of the next
// tick has not happened yet when the snapshot is read.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy at all,
// Sconce at level 1 with its timer at 0, `weaponFire` on and every other
// switch off, so nothing spawns an enemy into the world before the due tick
// and nothing but Sconce's own rule sets its timer.
//
// THE TOLERANCE. `REAL_EPS` on the timer, a table value times a multiplier of
// `1`; a build that left the timer at `0` is off by the whole cooldown, and
// one that launched anyway shows a projectile.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { cooldownOf, REAL_EPS, SCONCE_LEVELS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireSconce } from "./firing";

/** Level 1 of Sconce: table cooldown 2.0. */
const LEVEL = 1;
const ROW = SCONCE_LEVELS[LEVEL - 1];

/** The current cooldown with no Oil held: `max(0.2, 2.0 × 1)`. */
const CURRENT_COOLDOWN = cooldownOf(ROW.cooldown, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates no projectile on the due tick and sets the timer to 2", async () => {
  const firing = await fireSconce(h, LEVEL, []);
  captureStill(h, "restart");

  assertEqual(
    firing.after.run.enemies.length,
    0,
    "the enemies alive on the due tick",
  );
  assertEqual(
    firing.after.run.projectiles.length,
    0,
    "the projectiles after Sconce's due tick with no enemy alive (specs/weapons.md, Cooldown timers)",
  );
  assertNear(
    firing.after.run.weapons[firing.slot].cooldown,
    CURRENT_COOLDOWN,
    REAL_EPS,
    "Sconce's timer after the due tick, against its current cooldown (specs/weapons.md, Cooldown timers)",
  );
});
