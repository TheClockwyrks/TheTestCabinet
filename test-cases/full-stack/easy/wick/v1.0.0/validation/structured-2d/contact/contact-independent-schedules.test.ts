// contact/contact-independent-schedules — overlapping enemies each hit on
// their own cooldown.
//
// THE SPEC LINE. `specs/world.md`, "Contact damage": "Every enemy carries its
// own contact cooldown, `contactCooldown`", and "several overlapping enemies
// each hit on their own schedule." The schedules themselves follow the Timers
// rule: a timer set to `s` "is due `round(s × TICK_HZ)` ticks after the tick
// it was set on". A moth spawned with its cooldown at `0` is due on tick `1`;
// one whose cooldown is posed to `0.25` before the first tick is due
// `round(0.25 × 60) = 15` ticks later, on tick `15`; and each hit sets that
// enemy's own cooldown to `0.5`, so each hits again `30` ticks after its own
// hit, on `31` and `45`.
//
// HOW A HIT IS ATTRIBUTED. The two moths deal the same `5`, so hp alone cannot
// say which one hit. The cooldown can: a hit is the only thing in the
// specification that RAISES an enemy's `contactCooldown` (every other tick
// counts it down or holds it), so the ticks on which a moth's cooldown rose
// are the ticks it hit on. The hp readings are kept beside them: hp must fall
// on exactly the union of the two schedules, `[1, 15, 31, 45]`, which is what
// rules out a build that shares one cooldown between the two and hits with
// both at once.
//
// THE POSE. Two moths, one either side of the lamplighter and both inside the
// `10 + 12` overlap bound, `enemyMotion` off so both stay, `enemyContact` on,
// nothing else in the world. Four hits of `5` leave hp at `80`.
//
// THE TOLERANCE. Whole ticks, compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertDefined } from "../assert";
import { CONTACT_COOLDOWN, ticksOf } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
  enemyById,
  isolate,
  placeEnemyNear,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** Each moth's center distance: inside its overlap bound, on opposite sides. */
const OFFSET = 8;

/** The second moth's posed cooldown, and the tick it is therefore due on. */
const POSED_COOLDOWN = 0.25;
const POSED_DUE = ticksOf(POSED_COOLDOWN);

/** Ticks between one enemy's hits. */
const INTERVAL = ticksOf(CONTACT_COOLDOWN);

/** Each moth's schedule over the span, and the ticks hp must fall on. */
const FIRST_HITS = [1, 1 + INTERVAL];
const SECOND_HITS = [POSED_DUE, POSED_DUE + INTERVAL];
const HP_DROPS = [...FIRST_HITS, ...SECOND_HITS].sort((a, b) => a - b);
const SPAN = HP_DROPS[HP_DROPS.length - 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The moth's cooldown, or `NaN` once it is gone, which no reading equals. */
function cooldownOf(s: WickSnapshot, id: number): number {
  const enemy = enemyById(s, id);
  assertDefined(enemy, `moth ${id} is still live`);
  return enemy?.contactCooldown ?? Number.NaN;
}

it("lands two overlapping moths' hits on 1 and 31, and on 15 and 45", async () => {
  isolate(h);
  const first = placeEnemyNear(h, "moth", OFFSET, 0);
  const second = placeEnemyNear(h, "moth", -OFFSET, 0);
  h.debug.setEnemyContactCooldown(second, POSED_COOLDOWN);
  enable(h, "enemyContact");
  // Read after the poses, so the first tick's readings compare against the
  // cooldowns the moths actually start with.
  const before = h.snapshot();

  const seen = await captureReplay(h, "schedules", async () => {
    const drops: number[] = [];
    const firstHits: number[] = [];
    const secondHits: number[] = [];
    let hp = before.run.player.hp;
    let firstCooldown = cooldownOf(before, first);
    let secondCooldown = cooldownOf(before, second);
    for (let tick = 1; tick <= SPAN; tick += 1) {
      const s = await advanceTicks(h, 1);
      if (s.run.player.hp < hp) drops.push(tick);
      hp = s.run.player.hp;
      const a = cooldownOf(s, first);
      const b = cooldownOf(s, second);
      if (a > firstCooldown) firstHits.push(tick);
      if (b > secondCooldown) secondHits.push(tick);
      firstCooldown = a;
      secondCooldown = b;
    }
    return { drops, firstHits, secondHits };
  });

  assertDeepEqual(
    seen.firstHits,
    FIRST_HITS,
    "the ticks the moth with cooldown 0 hit on (specs/world.md, Contact damage)",
  );
  assertDeepEqual(
    seen.secondHits,
    SECOND_HITS,
    `the ticks the moth posed to ${POSED_COOLDOWN} hit on (specs/world.md, Contact damage)`,
  );
  assertDeepEqual(
    seen.drops,
    HP_DROPS,
    "the ticks hp fell on: each moth's own schedule and nothing shared",
  );
});
