// contact/contact-rehit-interval — an enemy in continuous contact hits once
// every CONTACT_COOLDOWN: on tick 1, then 31, 61, and 91.
//
// THE RULE, FROM THE SPEC. specs/world.md, Contact damage: "An enemy in
// continuous contact therefore hits once every CONTACT_COOLDOWN seconds", the
// hit setting "its contactCooldown ... to CONTACT_COOLDOWN" (0.5). Timers: "a
// timer set to s seconds is due round(s × TICK_HZ) ticks after the tick it was
// set on", so 0.5 seconds is round(0.5 × 60) = 30 ticks, and "a timer at 0
// stays due on every tick until it is set again", so a fresh spawn's cooldown
// of 0 lands the first hit on tick 1. The schedule is therefore 1, 31, 61, 91.
//
// HOW A HIT IS READ. A hit is the tick on which hp fell below the tick before
// it: recovery is 0 with no Tinder held and nothing else on the field can
// change hp, so the set of ticks hp fell on is the set of ticks the moth hit
// on. The moth's damage is 5 (specs/enemies.md), so 91 ticks with four hits
// leave 100 − 4 × 5 = 80.
//
// THE POSE. An isolated night with enemyContact on: one moth posed 5 units
// along +x, inside the 22 its radius 10 plus PLAYER_RADIUS sum to, held there
// with enemyMotion off so the contact is continuous.
//
// THE TOLERANCE. The schedule is a set of whole ticks and compared exactly: a
// build one tick off on the interval lands on 30 or 32 and fails. The hp left
// is compared within FIGURE_TOLERANCE, exact arithmetic on stated figures.

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
  isolate,
  spawnEnemyNear,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** The enemy in continuous contact. */
const TYPE = "moth";

/** Where the moth is posed: 5 units along +x, inside the overlap. */
const OFFSET = 5;

/** The interval between hits, in ticks: round(0.5 × 60) = 30. */
const INTERVAL = ticksFor(CONTACT_COOLDOWN);

/** How many hits the schedule is read across. */
const HITS = 4;

/** The ticks the hits fall on: 1, 31, 61, 91. */
const EXPECTED_TICKS = Array.from({ length: HITS }, (_, i) => 1 + i * INTERVAL);

/** The span driven: through the last expected hit. */
const TICKS = EXPECTED_TICKS[HITS - 1];

/** The ticks on which hp fell, counted from 1, across a trace. */
function hitTicks(
  before: WickSnapshot,
  trace: readonly WickSnapshot[],
): number[] {
  const ticks: number[] = [];
  let hp = before.run.player.hp;
  trace.forEach((snapshot, i) => {
    if (snapshot.run.player.hp < hp) ticks.push(i + 1);
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

it("hits on tick 1 and again every 30 ticks while the moth stays overlapping", async () => {
  isolate(h);
  enable(h, "enemyContact");
  spawnEnemyNear(h, TYPE, OFFSET, 0);
  const before = h.snapshot();

  const trace = await captureReplay(h, "rehit", () => h.trace(TICKS));

  assertDeepEqual(
    hitTicks(before, trace),
    EXPECTED_TICKS,
    "the ticks the moth's hits landed on",
  );
  assertWithin(
    trace[trace.length - 1].run.player.hp,
    BASE_MAX_HP - HITS * ENEMIES[TYPE].damage,
    FIGURE_TOLERANCE,
    `hp after ${HITS} hits`,
  );
});
