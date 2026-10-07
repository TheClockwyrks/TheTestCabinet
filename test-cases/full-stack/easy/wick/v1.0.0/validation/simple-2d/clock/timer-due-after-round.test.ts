// Wick — clock/timer-due-after-round: a timer is due exactly round(s × TICK_HZ)
// ticks after it is set.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("Timers"): "On every tick a timer counts down by
//     `TICK_DT` and is held at `0` ... A timer is due on every tick on which it
//     is `0` after its count-down, so a timer set to `s` seconds is due
//     `round(s × TICK_HZ)` ticks after the tick it was set on".
//   - `specs/weapons.md` ("Cooldown timers"): "On acquisition the timer is `0`,
//     so a weapon fires on the first `playing` tick it is held ... After
//     firing, the timer is set to the weapon's current cooldown, and the weapon
//     fires again on the tick the timer is due."
//   - `specs/weapons.md` ("Taper"): level 1 has cooldown `1.35` and "The slash
//     is drawn for `SLASH_FLASH` (`0.1`) seconds", so a slash is a zone that
//     appears on the firing tick; `specs/state.md` (`ZoneState`): a slash
//     holds `SLASH_FLASH` as its `ttl`.
//   - `specs/instrumentation.md` (`setWeaponCooldown`): "Sets the cooldown
//     timer of the weapon in `slot`, a held slot, to `seconds`, at least `0`."
//
// WHAT IS READ. Taper alone is held with `weaponFire` on. Its first tick fires
// it and sets the timer to 1.35, which the snapshot reports; round(1.35 × 60)
// is 81, so the next slash must appear on the 81st tick after and on none
// before. The timer is then posed to 0.5, round(0.5 × 60) is 30, and the next
// slash must appear on the 30th tick after. A firing is read as a new slash
// zone, one whose id is at or above the `nextId` the trace began at, because a
// slash is created on its firing tick alone and lives six ticks.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper needs no target, so the night holds
// nothing but the lamplighter and the held Taper: no enemy is hit, no gem drops,
// and nothing else counts. The 1.35 case measures the timer the firing itself
// set; the 0.5 case measures a timer set by the surface, so the rule is read
// for a value the firing never produces.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the timer reading 1.35 after the
// firing, a stated figure read back; none on the tick counts, which the spec
// states exactly through `round`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, TAPER_LEVELS, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** Taper's level 1 cooldown, the timer a firing sets: 1.35 s, 81 ticks. */
const FIRED_COOLDOWN = TAPER_LEVELS[0].cooldown;

/** The timer posed through the surface: 0.5 s, 30 ticks. */
const POSED_COOLDOWN = 0.5;

/** How far past the expected tick a sweep runs before giving up. */
const SWEEP_MARGIN = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Whether a slash created since `idFloor` is in the world. */
function slashSince(snapshot: WickSnapshot, idFloor: number): boolean {
  return snapshot.run.zones.some(
    (zone) => zone.kind === "slash" && zone.id >= idFloor,
  );
}

/**
 * Drive tick by tick until a new slash appears, and answer how many ticks that
 * took, or `null` when none appeared within the budget.
 */
async function ticksToNextSlash(budget: number): Promise<number | null> {
  const idFloor = h.snapshot().run.nextId;
  const seen = await h.trace(budget, (snapshot) =>
    slashSince(snapshot, idFloor),
  );
  const last = seen[seen.length - 1];
  return slashSince(last, idFloor) ? seen.length : null;
}

it("fires Taper again exactly round(s × TICK_HZ) ticks after its timer is set", async () => {
  isolate(h, { keepTaper: true });
  enable(h, "weaponFire");
  const opening = h.snapshot();
  const slot = 0;
  assertEqual(opening.run.weapons[slot]?.id, "taper", "the weapon held");

  const outcome = await captureReplay(h, "due", async () => {
    const first = await h.tick(1);
    const firedTicks = await ticksToNextSlash(
      ticksFor(FIRED_COOLDOWN) + SWEEP_MARGIN,
    );
    h.debug.setWeaponCooldown(slot, POSED_COOLDOWN);
    const posedTicks = await ticksToNextSlash(
      ticksFor(POSED_COOLDOWN) + SWEEP_MARGIN,
    );
    return { first, firedTicks, posedTicks };
  });

  assertEqual(
    slashSince(outcome.first, opening.run.nextId),
    true,
    "a slash on the first tick Taper is held",
  );
  assertWithin(
    outcome.first.run.weapons[slot]?.cooldown ?? Number.NaN,
    FIRED_COOLDOWN,
    FIGURE_TOLERANCE,
    "the timer the firing set",
  );
  assertEqual(
    outcome.firedTicks,
    ticksFor(FIRED_COOLDOWN),
    "ticks from the firing to the next slash, a timer set to 1.35",
  );
  assertEqual(
    outcome.posedTicks,
    ticksFor(POSED_COOLDOWN),
    "ticks from the pose to the next slash, a timer set to 0.5",
  );
});
