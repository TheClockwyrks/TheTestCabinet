// contact/contact-rehit-interval — continuous contact re-hits every
// CONTACT_COOLDOWN.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Contact damage"): "An enemy
// in continuous contact therefore hits once every `CONTACT_COOLDOWN` seconds",
// with `CONTACT_COOLDOWN` 0.5. The hit "set[s] its `contactCooldown` to
// `CONTACT_COOLDOWN`", and "Timers" fixes when that is due again: "a timer set
// to `s` seconds is due `round(s x TICK_HZ)` ticks after the tick it was set
// on", which is 30 ticks. An enemy "spawns ... with `contactCooldown` `0`"
// (specs/enemies.md), and a timer at 0 "stays due on every tick until it is set
// again", so a moth posed on the lamplighter hits on tick 1, and then on ticks
// 31, 61, and 91: a hit on every tick 1 + 30k and no other.
//
// HOW A HIT IS READ. The ticks `hp` fell on. Recovery is `BASE_RECOVERY` (`0`)
// with no Tinder held and nothing heals, so a contact hit is the only thing
// that lowers `hp`, and the reading says nothing about how much a hit took: the
// moth's damage is the enemy roster's point, not this one. Four moth hits of 5
// leave 100 at 80, far from the 0 that would end the run.
//
// THE DRIVE. An isolated night with `enemyContact` on and `enemyMotion` off, so
// the moth is held exactly where it was posed, 5 units from the center and well
// inside its radius 10 plus `PLAYER_RADIUS` 12. Ninety-one ticks are run one at
// a time.
//
// THE TOLERANCE. None: the reading is the set of ticks `hp` fell on, which is
// exact. A build that re-hits a tick early or late, or every tick, or once,
// reads a different set.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { CONTACT_COOLDOWN, dueTicks } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  placeEnemyNear,
  ticksHpFell,
  type Harness,
} from "../harness";

/** How far from the center the moth is posed: well inside 10 + 12. */
const MOTH_OFFSET = 5;

/** The ticks between two hits by one enemy: `round(0.5 x 60)`. */
const REHIT_TICKS = dueTicks(CONTACT_COOLDOWN);

/** The hits watched for. */
const HITS = 4;

/** Ticks run: through the fourth hit, on tick 91. */
const TICKS = 1 + REHIT_TICKS * (HITS - 1);

/** The ticks the hits land on: 1, 31, 61, 91. */
const EXPECTED_HIT_TICKS = Array.from(
  { length: HITS },
  (_, i) => 1 + i * REHIT_TICKS,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hits on tick 1 and then on every 30th tick after it", async () => {
  const posed = await isolate(h, { on: ["enemyContact"] });
  await placeEnemyNear(h, "moth", MOTH_OFFSET, 0);

  const history = await captureReplay(h, "rehit", () => h.stepWatching(TICKS));

  assertDeepEqual(
    ticksHpFell(posed, history),
    EXPECTED_HIT_TICKS,
    `the ticks hp fell on over ${TICKS} ticks of continuous contact`,
  );
});
