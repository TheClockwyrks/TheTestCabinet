// evolutions/evolved-timer-zero — an evolved weapon's timer starts at 0, so it
// fires on the first playing tick after the overlay closes.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Opening a chest"),
// rule 1: "The evolved weapon replaces its base in the same slot with a single
// level, its cooldown timer is set to `0` so it fires on the first `playing`
// tick it is held". `specs/progression.md` ("The chest overlay"): "The
// simulation does not tick while the overlay is open; `confirm` closes it,
// setting `chestResult` to `null` and `screen` to `playing`", and
// `specs/instrumentation.md` gives `setScreen("playing")` from `chest` as sets
// `screen` alone, leaving `chestResult` standing. `specs/weapons.md` ("Cooldown
// timers"): "the weapon fires again on the tick the timer is due", and a timer
// at `0` "stays due on every tick until it is set again" (`specs/world.md`,
// Timers). Pyre is Taper's slash, which "need[s] no target", so the first
// `playing` tick after the overlay closes creates its slashes.
//
// WHAT IS READ. Two readings of one requirement: `weapons[slot].cooldown` on
// the tick the chest evolved Taper, which the rule sets to `0`; and the zones
// the first `playing` tick after the overlay created, which is what a timer at
// `0` produces. A build that evolved correctly but left the timer at Taper's
// running value fails both.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Taper at 8 and
// Wick 1 and nothing else, every driver switch off — so the chest tick fires
// nothing at all, and no slash from Taper's own timer can be mistaken for
// Pyre's. `weaponFire` is turned on only after the overlay is closed, so the
// tick that is read is the first tick Pyre could fire on and the ticks before
// it fired nothing.
//
// THE TOLERANCE. `REAL_EPS` on the timer, which the rule sets outright; the
// slash count is a whole number read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNear } from "../assert";
import { MAX_WEAPON_LEVEL, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
  isolate,
  openChest,
  poseScreen,
  type Harness,
} from "../harness";
import { holdRecipe, zonesOfWeapon } from "./evolved";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads cooldown 0 on Pyre's slot and fires Pyre on the first playing tick after the overlay", async () => {
  isolate(h);
  const slot = holdRecipe(h, "pyre", MAX_WEAPON_LEVEL);

  const evolved = await openChest(h);
  assertEqual(
    evolved.run.weapons[slot]?.id,
    "pyre",
    "the weapon in Taper's slot after the chest (specs/evolutions.md, Opening a chest)",
  );
  assertNear(
    evolved.run.weapons[slot]?.cooldown ?? Number.NaN,
    0,
    REAL_EPS,
    "Pyre's cooldown timer on the tick the chest evolved Taper (specs/evolutions.md, Opening a chest)",
  );

  const fired = await captureReplay(h, "fired", async () => {
    const closed = poseScreen(h, "playing");
    enable(h, "weaponFire");
    const before = h.snapshot();
    const after = await advanceTicks(h, 1);
    return { closed, before, after };
  });

  assertEqual(
    fired.closed.screen,
    "playing",
    "the screen after the overlay was closed (specs/instrumentation.md, setScreen)",
  );
  assertEqual(
    zonesOfWeapon(fired.before, "pyre").length,
    0,
    "the Pyre zones standing before the first playing tick",
  );
  assertGreaterThan(
    zonesOfWeapon(fired.after, "pyre", "slash").length,
    0,
    "the Pyre slashes the first playing tick after the overlay created (specs/evolutions.md, Opening a chest)",
  );
});
