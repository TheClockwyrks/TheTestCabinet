// Wick — weapons/cooldown-period: a weapon fires again on the tick its timer
// is due, and on no tick between.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set
//     to the weapon's current cooldown, and the weapon fires again on the tick
//     the timer is due. The current cooldown is the table cooldown times
//     `cooldownMul`, floored at `MIN_COOLDOWN`". With no Oil held
//     `cooldownMul` is `1` (`specs/passives.md`), and Taper's level-1 row has
//     cooldown `1.35` (`specs/weapons.md`, "Taper").
//   - `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
//     `round(s × TICK_HZ)` ticks after the tick it was set on", so a timer set
//     to `1.35` on the firing tick is due `round(81.00…) = 81` ticks later.
//   - `specs/world.md` ("One tick"), phase 5: "each held weapon's timer counts
//     down, and each weapon whose timer is due fires". The timer is set AFTER
//     the firing tick's count-down, so the snapshot after that tick reads the
//     freshly set `1.35`.
//   - `specs/state.md` (`ZoneState.id`): "unique for the run, assigned from
//     `nextId`", which is what tells a slash created on one tick from one
//     created on another once the first has expired.
//
// WHAT IS READ. The cooldown timer after the first firing, and the tick of
// the second firing: a firing is a tick whose snapshot holds a Taper slash
// with an id not seen before. A slash lives `SLASH_FLASH` (`0.1`) seconds, six
// ticks, so a slash id lasting across ticks is one firing and a new id is
// another. Over the 81 ticks after the first firing, no new slash may appear on
// the first 80 and one must appear on the 81st.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper at level 1 alone, nothing on the
// field, every switch off but `weaponFire`. Taper needs no target, so the field
// stays empty and nothing else can create a zone.
//
// TOLERANCE. `FIGURE_TOLERANCE` on the timer reading, a stated figure read back
// as a double. None on the tick: the rule fixes it to a whole count, and a
// build a tick out has broken the stated rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  TAPER_LEVELS,
  cooldownFor,
  ticksFor,
} from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  zonesOfKind,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** Taper's current cooldown at level 1 with no Oil held: 1.35 seconds. */
const COOLDOWN = cooldownFor(TAPER_LEVELS[0].cooldown, {});

/** The ticks between the first firing and the second: round(1.35 × 60). */
const PERIOD_TICKS = ticksFor(COOLDOWN);

/** The ids of every Taper slash in `snapshot`. */
function slashIds(snapshot: WickSnapshot): number[] {
  return zonesOfKind(snapshot, "slash")
    .filter((zone) => zone.weapon === "taper")
    .map((zone) => zone.id);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires Taper again exactly 81 ticks after its first firing", async () => {
  isolate(h, { keepTaper: true });
  enable(h, "weaponFire");

  const period = await captureReplay(h, "period", async () => {
    const first = await h.tick(1);
    const seen = new Set(slashIds(first));
    // Which of the following ticks brought a slash id not seen before, counted
    // from 1 for the tick right after the first firing.
    const firings: number[] = [];
    const trace = await h.trace(PERIOD_TICKS);
    trace.forEach((snapshot, index) => {
      const fresh = slashIds(snapshot).filter((id) => !seen.has(id));
      if (fresh.length > 0) firings.push(index + 1);
      for (const id of fresh) seen.add(id);
    });
    return { first, firings };
  });

  assertEqual(
    slashIds(period.first).length > 0,
    true,
    "whether Taper fired on the first tick",
  );
  assertWithin(
    period.first.run.weapons[0]?.cooldown ?? Number.NaN,
    COOLDOWN,
    FIGURE_TOLERANCE,
    "Taper's timer after its first firing",
  );
  assertDeepEqual(
    period.firings,
    [PERIOD_TICKS],
    "the ticks after the first firing on which a new slash appeared",
  );
});
