// Wick — evolutions/evolved-timer-zero: an evolved weapon's cooldown timer
// starts at 0, so it fires on its first `playing` tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Opening a chest"), rule 1: "The evolved weapon
//     replaces its base in the same slot with a single level, its cooldown
//     timer is set to `0` so it fires on the first `playing` tick it is held".
//   - `specs/world.md` ("Timers"): "A timer is due on every tick on which it is
//     `0` after its count-down", so a timer left at `0` is due on the next tick
//     the weapon's faculty runs.
//   - `specs/evolutions.md` ("Pyre"): a firing creates "two rectangles of
//     `width × height`", zones of kind `slash` (`specs/state.md`, `ZoneKind`).
//   - `specs/instrumentation.md` (`setScreen`, `playing` from `chest`): "Closes
//     the overlay exactly as `confirm` does: `chestResult` becomes `null`",
//     which is how the run resumes after the chest without pressing a key.
//   - `specs/instrumentation.md` (The driver switches): while `weaponFire` is
//     off "Every cooldown timer holds where it stands and nothing fires", so
//     the timer read on the chest tick is the one the evolution set, and the
//     firing waits for the switch.
//
// WHAT IS READ. Two things about the one evolution: on the tick the chest
// evolved Taper, Pyre's slot reads cooldown `0`; and on the first `playing`
// tick after the overlay closes, with `weaponFire` on, Pyre's slashes are in
// `zones`. A build that gives the evolved weapon its full cooldown reads a
// timer of 1.2 and fires nothing on that tick.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper at level 8 and Wick held so the chest
// evolves, nothing on the field, every driver switch off through the chest, and
// `weaponFire` turned on only after the overlay closes, so the firing tick read
// is the first `playing` tick Pyre is held and nothing else can create a zone.
//
// TOLERANCE. `FIGURE_TOLERANCE` on the timer, a stated figure read back as a
// double. None on the count of zones.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertWithin } from "../assert";
import { EVOLUTIONS, FIGURE_TOLERANCE, MAX_WEAPON_LEVEL } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  holdPassive,
  holdWeapon,
  openChest,
  zonesOf,
  type Harness,
} from "../harness";
import { assertResultKind, poseChestNight } from "./chest";

/** The evolution this point reaches: Pyre, from Taper with Wick. */
const EVOLUTION = "pyre";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads cooldown 0 on the evolving tick and fires Pyre on the first playing tick after", async () => {
  poseChestNight(h);
  const slot = holdWeapon(h, EVOLUTIONS[EVOLUTION].from, MAX_WEAPON_LEVEL);
  holdPassive(h, EVOLUTIONS[EVOLUTION].passive, 1);

  const evolved = await openChest(h);
  assertResultKind(evolved, "evolve", "the chest that evolved Taper");
  assertEqual(
    evolved.run.weapons[slot]?.id,
    EVOLUTION,
    "the weapon in the slot after the evolution",
  );
  assertWithin(
    evolved.run.weapons[slot]?.cooldown ?? Number.NaN,
    0,
    FIGURE_TOLERANCE,
    "Pyre's timer on the tick the chest evolved Taper",
  );

  const after = await captureReplay(h, "fired", async () => {
    h.debug.setScreen("playing");
    enable(h, "weaponFire");
    return h.tick(1);
  });

  assertEqual(after.screen, "playing", "the screen the firing tick ran on");
  assertGreaterThan(
    zonesOf(after, EVOLUTION).length,
    0,
    "Pyre zones after the first playing tick it is held",
  );
});
