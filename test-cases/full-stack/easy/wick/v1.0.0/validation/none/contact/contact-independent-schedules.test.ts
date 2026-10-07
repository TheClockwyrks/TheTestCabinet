// contact/contact-independent-schedules — overlapping enemies each hit on
// their own schedule.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Contact damage"): "Every
// enemy carries its own contact cooldown, `contactCooldown`", and "several
// overlapping enemies each hit on their own schedule." A hit sets the enemy's
// cooldown "to `CONTACT_COOLDOWN`" (0.5), and "Timers" makes a timer set to `s`
// due "`round(s x TICK_HZ)` ticks after the tick it was set on": 30 ticks for
// 0.5 and 15 for 0.25. So a moth with the 0 it spawned with hits on tick 1 and
// tick 31, and one posed to 0.25 hits on tick 15 and tick 45, each 30 ticks
// after its own hit.
//
// HOW A HIT IS READ, TWICE OVER. The snapshot reports each enemy's
// `contactCooldown`, and the hit's own tick reads the full 0.5 it was just set
// to (phase 7 counts down before it hits, specs/world.md — "One tick"); every
// later tick reads less, and a cooldown posed at 0.25 never reads 0.5 until a
// hit sets it. So the ticks an enemy reads exactly `CONTACT_COOLDOWN` on are
// the ticks it hit on, which is what attributes a hit to a moth. That those
// four markers are four hits rather than four cooldowns set by nothing is read
// off the lamplighter: recovery is `BASE_RECOVERY` (`0`) with no Tinder held
// and nothing heals, so `hp` falls on exactly the ticks a hit landed, and the
// two readings must name the same four ticks. Neither says how much a hit took:
// the moth's damage is the enemy roster's point, not this one.
//
// THE DRIVE. An isolated night with `enemyContact` on and `enemyMotion` off:
// two moths held either side of the lamplighter's center, 5 units away, well
// inside their radius 10 plus `PLAYER_RADIUS` 12. One keeps the 0 it spawned
// with; the other is posed to 0.25 through `setEnemyContactCooldown`. Forty-five
// ticks are run one at a time, and the four hits of 5 leave 100 at 80, far from
// the 0 that would end the run.
//
// THE TOLERANCE. `TIMER_TOL` on the marker: a timer set to a stated figure
// reads it exactly, and the tick before or after a hit reads a sixtieth away.
// None on the tick sets, which are exact. A build that gave every overlapping
// enemy one shared schedule reads both moths on tick 1 and 31.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { CONTACT_COOLDOWN, TIMER_TOL, dueTicks } from "../constants";
import {
  captureReplay,
  createHarness,
  enemyById,
  isolate,
  placeEnemyNear,
  ticksHpFell,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** How far from the center each moth is posed, on opposite sides. */
const MOTH_OFFSET = 5;

/** The cooldown the second moth is posed to. */
const POSED_COOLDOWN = 0.25;

/** The ticks between two hits by one enemy: `round(0.5 x 60)`. */
const REHIT_TICKS = dueTicks(CONTACT_COOLDOWN);

/** The tick the posed cooldown is due: `round(0.25 x 60)`. */
const POSED_DUE_TICK = dueTicks(POSED_COOLDOWN);

/** Ticks run: through the second moth's second hit, on tick 45. */
const TICKS = POSED_DUE_TICK + REHIT_TICKS;

/** The fresh moth's hits: tick 1 and 30 after it. */
const FRESH_HIT_TICKS = [1, 1 + REHIT_TICKS];

/** The posed moth's hits: tick 15 and 30 after it. */
const POSED_HIT_TICKS = [POSED_DUE_TICK, POSED_DUE_TICK + REHIT_TICKS];

/** The ticks a hit lands on, from either moth, in order: 1, 15, 31, 45. */
const EXPECTED_HIT_TICKS = [...FRESH_HIT_TICKS, ...POSED_HIT_TICKS].sort(
  (a, b) => a - b,
);

/** The 1-based ticks of `history` on which enemy `id` reads the full cooldown. */
function ticksHitBy(history: readonly WickSnapshot[], id: number): number[] {
  const hits: number[] = [];
  for (const [index, snapshot] of history.entries()) {
    const cooldown = enemyById(snapshot, id)?.contactCooldown ?? NaN;
    if (Math.abs(cooldown - CONTACT_COOLDOWN) <= TIMER_TOL)
      hits.push(index + 1);
  }
  return hits;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hits on tick 1 and 31 from one moth and tick 15 and 45 from the other", async () => {
  const posedWorld = await isolate(h, { on: ["enemyContact"] });
  const fresh = await placeEnemyNear(h, "moth", MOTH_OFFSET, 0);
  const posed = await placeEnemyNear(h, "moth", -MOTH_OFFSET, 0);
  await h.debug.setEnemyContactCooldown(posed.id, POSED_COOLDOWN);

  const history = await captureReplay(h, "schedules", () =>
    h.stepWatching(TICKS),
  );

  assertDeepEqual(
    ticksHitBy(history, fresh.id),
    FRESH_HIT_TICKS,
    "the ticks the moth with a fresh cooldown hit on",
  );
  assertDeepEqual(
    ticksHitBy(history, posed.id),
    POSED_HIT_TICKS,
    "the ticks the moth posed to 0.25 hit on",
  );
  assertDeepEqual(
    ticksHpFell(posedWorld, history),
    EXPECTED_HIT_TICKS,
    `the ticks hp fell on over ${TICKS} ticks under both moths`,
  );
});
