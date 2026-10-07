// clock/timer-due-after-round — a timer set to `s` seconds is due exactly
// `round(s × TICK_HZ)` ticks after the tick it was set on.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Timers"): "On every tick a
// timer counts down by `TICK_DT` and is held at `0` ... A timer is due on
// every tick on which it is `0` after its count-down, so a timer set to `s`
// seconds is due `round(s × TICK_HZ)` ticks after the tick it was set on".
// specs/weapons.md ("Cooldown timers"): "After firing, the timer is set to the
// weapon's current cooldown, and the weapon fires again on the tick the timer
// is due." Taper's level-1 cooldown is `1.35` (`TAPER_LEVELS`), which is
// `round(1.35 × 60)`, `81` ticks; and specs/instrumentation.md's
// `setWeaponCooldown(slot, seconds)` poses a timer to any figure, here `0.5`,
// which is `30`.
//
// THE DRIVE. Taper, alone, fires on a tick of its own (a fresh slot's timer
// is `0`) and its timer is set to `1.35`. The ticks after are stepped one at a
// time, and the tick on which a new slash zone appears is the tick the timer
// came due. It is the 81st: one tick earlier the timer reads `1.35 − 80/60`,
// one `TICK_DT`, which is what a count-down of eighty `TICK_DT`s from `1.35`
// leaves and is above the half-tick the hold-at-zero rule turns on. Then the
// timer is posed to `0.5` on the tick it was just reset, and Taper fires
// again on the 30th tick after. A build that counts a tick early or late
// fires on the 80th or the 82nd; one that rounds `1.35 × 60 = 81.00000000000001`
// up or the `0.5` case down misses one of the two.
//
// THE NIGHT. An isolated run with Taper alone and `weaponFire` on: Taper
// "needs no target" (specs/weapons.md), so nothing else is posed, and every
// other faculty is held.
//
// THE TOLERANCE. The firing tick is a count, read exactly. The timer's reading
// one tick before due is `TIMER_TOL`, the `1e-6` allowed for a timer still
// counting, against `TICK_DT`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNear } from "../assert";
import { TICK_DT, TIMER_TOL, dueTicks, weaponRow } from "../constants";
import {
  captureReplay,
  createHarness,
  fireWeapon,
  isolate,
  newZones,
  weaponIn,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** The cooldown a level-1 Taper firing sets: `1.35` s, 81 ticks. */
const FIRING_COOLDOWN = weaponRow("taper", 1).cooldown ?? NaN;

/** The cooldown posed afterwards: `0.5` s, 30 ticks. */
const POSED_COOLDOWN = 0.5;

/** How far past the due tick a count runs before it gives up. */
const OVERRUN_TICKS = 5;

/** What a count to a firing found. */
interface Count {
  /** Ticks stepped until a slash appeared, or `null` when none did. */
  ticks: number | null;
  /** Taper's timer as read one tick before the due tick. */
  beforeDue: number;
  /** The state the count stopped on. */
  snapshot: WickSnapshot;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Step one tick at a time from `from` until Taper creates a zone, up to
 * `due + OVERRUN_TICKS` ticks, reading the timer on the tick before `due`.
 */
async function countToFiring(from: WickSnapshot, due: number): Promise<Count> {
  let before = from;
  let beforeDue = NaN;
  for (let tick = 1; tick <= due + OVERRUN_TICKS; tick += 1) {
    const after = await h.step(1);
    if (tick === due - 1) beforeDue = weaponIn(after, "taper")?.cooldown ?? NaN;
    if (newZones(before, after).length > 0) {
      return { ticks: tick, beforeDue, snapshot: after };
    }
    before = after;
  }
  return { ticks: null, beforeDue, snapshot: before };
}

it("fires Taper on the 81st tick after a 1.35 s cooldown and the 30th after a posed 0.5 s", async () => {
  await isolate(h);
  const { firing, long, short } = await captureReplay(h, "due", async () => {
    const firing = await fireWeapon(h, "taper");
    const long = await countToFiring(firing.after, dueTicks(FIRING_COOLDOWN));
    await h.debug.setWeaponCooldown(firing.slot, POSED_COOLDOWN);
    const short = await countToFiring(
      await h.snapshot(),
      dueTicks(POSED_COOLDOWN),
    );
    return { firing, long, short };
  });

  assertGreaterThan(
    firing.zones.length,
    0,
    "zones Taper created on the tick it was held with its timer at 0",
  );
  assertNear(
    long.beforeDue,
    TICK_DT,
    TIMER_TOL,
    "Taper's timer 80 ticks after a firing set it to 1.35 s",
  );
  assertEqual(
    long.ticks,
    dueTicks(FIRING_COOLDOWN),
    "ticks after a firing until Taper fired again on its 1.35 s cooldown",
  );
  assertEqual(
    short.ticks,
    dueTicks(POSED_COOLDOWN),
    "ticks after posing the timer to 0.5 s until Taper fired again",
  );
});
