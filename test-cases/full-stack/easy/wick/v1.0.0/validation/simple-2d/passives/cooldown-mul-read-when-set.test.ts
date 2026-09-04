// passives/cooldown-mul-read-when-set — a cooldown timer already counting keeps
// the value it was set with when Oil arrives, and the next firing reads the new
// multiplier.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Cooldown"): "A weapon's
// timer is set from this value each time the weapon fires, and a timer already
// counting keeps the value it was set with", and ("The derived stats") "a
// passive gained mid-run takes effect on the next read: the next hit, the next
// time a weapon sets its cooldown timer". specs/world.md ("Timers"): "On every
// tick a timer counts down by TICK_DT", so a timer standing at 1.0 reads
// 1 − 1/60 after one tick whatever Oil is held, and is due round(1.0 × 60) = 60
// ticks after the tick it was set on. Row 1 of TAPER_LEVELS gives cooldown 1.35
// (specs/weapons.md, "Taper") and Oil 5 gives cooldownMul 1 − 0.08 × 5 = 0.6,
// so the firing on tick 60 sets the timer to max(0.2, 1.35 × 0.6) = 0.81.
//
// THE WORLD. An isolated playing run: nothing on the field, Taper alone at
// level 1 with its timer posed to 1.0 and weaponFire on, and only then Oil at
// level 5 placed in the first passive slot, which is the order the requirement
// names. Taper needs no target, so no enemy is posed and each new zone id is a
// firing.
//
// WHAT IS READ. Taper's timer after the first tick, which must be the posed
// 1.0 counted down by one tick rather than a rescaled 0.6 or 0.81; the tick of
// the following 60 on which a slash with an id not seen before appeared,
// exactly [60]; and the timer after that firing, 0.81.
//
// TOLERANCE. MOTION_TOLERANCE (1e-6) on the timer counted tick by tick, and
// FIGURE_TOLERANCE (1e-9) on the freshly set figure, a product of two stated
// figures. None on the tick, which the timer rule fixes to a whole count.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  MOTION_TOLERANCE,
  TAPER_LEVELS,
  TICK_DT,
  cooldownFor,
  ticksFor,
  type HeldPassives,
} from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  holdWeapon,
  isolate,
  type Harness,
} from "../harness";
import { freshTicks, holdPassives, timerOf, zoneIdsOf } from "./night";

/** The passives gained while the timer counts: Oil at level 5. */
const HELD: HeldPassives = { oil: 5 };

/** The Taper level held: row 1, cooldown 1.35. */
const LEVEL = 1;

/** The seconds the timer is posed to, mid-count when Oil arrives. */
const RUNNING = 1;

/** round(1.0 × 60) = 60 ticks from the pose to the firing. */
const PERIOD_TICKS = ticksFor(RUNNING);

/** max(0.2, 1.35 × 0.6) = 0.81, what the firing sets the timer to. */
const NEXT = cooldownFor(TAPER_LEVELS[LEVEL - 1].cooldown, HELD);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the running timer at 1.0 when Oil 5 arrives and sets the next one to 0.81", async () => {
  isolate(h);
  const slot = holdWeapon(h, "taper", LEVEL);
  h.debug.setWeaponCooldown(slot, RUNNING);
  enable(h, "weaponFire");
  holdPassives(h, HELD);

  const run = await captureReplay(h, "kept", async () => {
    const trace = await h.trace(PERIOD_TICKS);
    return {
      first: trace[0],
      last: trace[PERIOD_TICKS - 1],
      firings: freshTicks(trace, (s) => zoneIdsOf(s, "taper"), new Set()),
    };
  });

  assertWithin(
    timerOf(run.first, slot),
    RUNNING - TICK_DT,
    MOTION_TOLERANCE,
    "Taper's timer one tick after Oil 5 was gained",
  );
  assertDeepEqual(
    run.firings,
    [PERIOD_TICKS],
    "the ticks after the pose on which a new slash appeared",
  );
  assertWithin(
    timerOf(run.last, slot),
    NEXT,
    FIGURE_TOLERANCE,
    "Taper's timer after the firing that followed the running one",
  );
});
