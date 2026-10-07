// contact/contact-independent-schedules — two overlapping enemies each hit on
// their own cooldown: one on ticks 1 and 31, the other on ticks 15 and 45.
//
// THE RULE, FROM THE SPEC. specs/world.md, Contact damage: "Every enemy carries
// its own contact cooldown, contactCooldown", and "several overlapping enemies
// each hit on their own schedule". A hit sets that enemy's cooldown to
// CONTACT_COOLDOWN (0.5), which under Timers is due round(0.5 × 60) = 30 ticks
// later. A cooldown of 0 is due on tick 1; one posed to 0.25 is due
// round(0.25 × 60) = 15 ticks after the pose, on tick 15
// (setEnemyContactCooldown, specs/instrumentation.md). So the first moth hits
// on 1 and 31, the second on 15 and 45.
//
// HOW EACH HIT IS ATTRIBUTED. A hit is a tick on which hp fell, since recovery
// is 0 with no Tinder held and nothing else on the field can change hp. Which
// moth landed it is read off its own contactCooldown, which the hit set to 0.5
// on that tick, so the two schedules are read separately rather than as one
// merged list. Each moth's damage is 5 (specs/enemies.md), so 45 ticks with
// four hits leave 100 − 4 × 5 = 80.
//
// THE POSE. An isolated night with enemyContact on: two moths overlapping the
// lamplighter, one 5 units along +x and one 5 along −x, both inside the 22
// their radius 10 plus PLAYER_RADIUS sum to, held there with enemyMotion off.
// The second's cooldown is posed to 0.25 before any tick runs.
//
// THE TOLERANCE. Each schedule is a set of whole ticks, compared exactly. The
// hp left is compared within FIGURE_TOLERANCE, exact arithmetic on stated
// figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertWithin } from "../assert";
import {
  BASE_MAX_HP,
  CONTACT_COOLDOWN,
  ENEMIES,
  FIGURE_TOLERANCE,
  ticksFor,
} from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  enemyById,
  isolate,
  spawnEnemyNear,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** The two enemies in contact. */
const TYPE = "moth";

/** How far each moth is posed from the lamplighter's center, one each side. */
const OFFSET = 5;

/** The cooldown the second moth is posed with. */
const SECOND_COOLDOWN = 0.25;

/** The interval between one enemy's hits, in ticks: round(0.5 × 60) = 30. */
const INTERVAL = ticksFor(CONTACT_COOLDOWN);

/** The first moth, due on tick 1: hits on 1 and 31. */
const FIRST_TICKS = [1, 1 + INTERVAL];

/** The second moth, due round(0.25 × 60) = 15 ticks in: hits on 15 and 45. */
const SECOND_TICKS = [
  ticksFor(SECOND_COOLDOWN),
  ticksFor(SECOND_COOLDOWN) + INTERVAL,
];

/** The span driven: through the last expected hit. */
const TICKS = Math.max(...FIRST_TICKS, ...SECOND_TICKS);

/**
 * The ticks on which hp fell and enemy `id`'s contactCooldown read
 * CONTACT_COOLDOWN, the mark a hit of that tick leaves on the enemy that landed
 * it, counted from 1 across a trace.
 */
function hitTicksOf(
  before: WickSnapshot,
  trace: readonly WickSnapshot[],
  id: number,
): number[] {
  const ticks: number[] = [];
  let hp = before.run.player.hp;
  trace.forEach((snapshot, i) => {
    const enemy = enemyById(snapshot, id);
    const setByHit =
      enemy !== undefined &&
      Math.abs(enemy.contactCooldown - CONTACT_COOLDOWN) <= FIGURE_TOLERANCE;
    if (snapshot.run.player.hp < hp && setByHit) ticks.push(i + 1);
    hp = snapshot.run.player.hp;
  });
  return ticks;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("hits on ticks 1 and 31 from one moth and 15 and 45 from the other", async () => {
  isolate(h);
  enable(h, "enemyContact");
  const first = spawnEnemyNear(h, TYPE, OFFSET, 0);
  const second = spawnEnemyNear(h, TYPE, -OFFSET, 0);
  h.debug.setEnemyContactCooldown(second, SECOND_COOLDOWN);
  const before = h.snapshot();

  const trace = await captureReplay(h, "schedules", () => h.trace(TICKS));

  assertDeepEqual(
    hitTicksOf(before, trace, first),
    FIRST_TICKS,
    "the ticks the moth with cooldown 0 hit on",
  );
  assertDeepEqual(
    hitTicksOf(before, trace, second),
    SECOND_TICKS,
    "the ticks the moth posed to 0.25 hit on",
  );
  assertWithin(
    trace[trace.length - 1].run.player.hp,
    BASE_MAX_HP -
      (FIRST_TICKS.length + SECOND_TICKS.length) * ENEMIES[TYPE].damage,
    FIGURE_TOLERANCE,
    "hp after the four hits",
  );
});
