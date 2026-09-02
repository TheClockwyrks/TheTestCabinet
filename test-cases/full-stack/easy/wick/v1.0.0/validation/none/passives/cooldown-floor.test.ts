// Wick — passives/cooldown-floor: a cooldown scaled below `MIN_COOLDOWN` is
// floored there, and the weapon fires on the floored interval.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Cooldown"): "A weapon's
// cooldown is its table `cooldown` times `cooldownMul`, floored at
// `MIN_COOLDOWN` (`0.2`) seconds: `cooldown = max(MIN_COOLDOWN, table cooldown
// × cooldownMul)`." `BEACON_STATS` (`specs/evolutions.md`) carries cooldown
// `0.25`, and Oil at level 5 gives `cooldownMul` `0.6`, so the unfloored
// product is `0.15` and the timer a firing sets reads `MIN_COOLDOWN` (`0.2`).
// `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
// `round(s × TICK_HZ)` ticks after the tick it was set on", so Beacon fires
// again every `round(0.2 × 60) = 12` ticks.
//
// THE POSE. An isolated night with Oil 5 held through `setPassive` and Beacon
// held at its single level and fired by one tick. Beacon "needs at least one
// enemy to fire", so one hound stands `FAR` (`5000`) units along `+x`, past
// every reach a bolt has: `effectMotion` is held, so no bolt travels at all,
// and the hound is only there to be aimed at. `weaponFire` stays on after the
// firing, so the floored timer counts exactly as it does in play, and the drive
// covers two whole intervals.
//
// TOLERANCE. `TIMER_TOL` (`1e-6`) on the timer; the ticks the later firings
// landed on are exact. The unfloored `0.15` would fire on ticks `9` and `18`,
// three ticks from either reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNear } from "../assert";
import {
  MIN_COOLDOWN,
  TIMER_TOL,
  dueTicks,
  effectiveCooldown,
  weaponRow,
} from "../constants";
import {
  captureReplay,
  createHarness,
  fireWeapon,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";
import { firedOn, placeFarTarget } from "./stage";

/** The Oil level held: `cooldownMul` `0.6`, which would give `0.15`. */
const OIL_LEVEL = 5;

/** `max(0.2, 0.25 × 0.6)`, which is `MIN_COOLDOWN`. */
const EXPECTED_COOLDOWN = effectiveCooldown(
  weaponRow("beacon").cooldown ?? NaN,
  { oil: OIL_LEVEL },
);

/** `round(0.2 × 60)`. */
const INTERVAL = dueTicks(MIN_COOLDOWN);

/** Two whole intervals of the floored timer. */
const DRIVE = INTERVAL * 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("floors Beacon's timer at 0.2 with Oil 5 held and fires it every 12 ticks", async () => {
  await isolate(h);
  await holdPassive(h, "oil", OIL_LEVEL);
  await placeFarTarget(h, "hound");

  const firing = await fireWeapon(h, "beacon");
  assertNear(
    firing.after.run.weapons?.[firing.slot]?.cooldown ?? NaN,
    EXPECTED_COOLDOWN,
    TIMER_TOL,
    "Beacon's timer after a firing with Oil 5 held",
  );

  const ticks = await captureReplay(h, "floor", () => h.stepWatching(DRIVE));

  assertDeepEqual(
    firedOn(firing.after, ticks, "beacon"),
    [INTERVAL, DRIVE],
    "the ticks after the first firing on which Beacon fired again",
  );
});
