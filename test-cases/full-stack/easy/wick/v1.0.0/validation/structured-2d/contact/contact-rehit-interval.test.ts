// contact/contact-rehit-interval — an enemy in continuous contact hits once
// every CONTACT_COOLDOWN.
//
// THE SPEC LINE. `specs/world.md`, "Contact damage": "An enemy in continuous
// contact therefore hits once every `CONTACT_COOLDOWN` seconds". Which ticks
// those are follows from the Timers rule: "a timer set to `s` seconds is due
// `round(s × TICK_HZ)` ticks after the tick it was set on", and from the hit
// setting the cooldown "to `CONTACT_COOLDOWN`" (`0.5`), so a hit on tick `T`
// sets a timer due on `T + 30`. A fresh moth's cooldown "is `0` when the enemy
// spawns", and a timer at `0` "stays due on every tick until it is set again",
// so the first hit lands on tick `1` and the rest on `31`, `61`, `91`.
//
// THE READING. Ninety-one ticks, one at a time, noting every tick on which hp
// fell. The list of those ticks is the requirement: exactly `[1, 31, 61, 91]`,
// no hit early, none late, none in between. How much each hit removes is
// `contact-hit`'s point; whether the cooldown reads `0.5` after a hit is
// `contact-cooldown-set`'s.
//
// THE POSE. One moth overlapping the lamplighter, `enemyMotion` off so it
// stays in contact for the whole span rather than depending on its chase to
// keep it there, `enemyContact` on, no weapon to kill it and no recovery to
// mask a hit. A moth's four hits of `5` take hp from `100` to `80`, nowhere
// near an ending.
//
// THE TOLERANCE. Ticks are whole numbers decided by the timer rule, so the
// list is compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { CONTACT_COOLDOWN, ticksOf } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** The moth's center distance: inside its `10 + 12` overlap bound. */
const OFFSET = 8;

/** Ticks between hits in continuous contact: `round(0.5 × 60)`. */
const INTERVAL = ticksOf(CONTACT_COOLDOWN);

/** The ticks the hits are due on: the first tick, then every interval. */
const EXPECTED = [1, 1 + INTERVAL, 1 + 2 * INTERVAL, 1 + 3 * INTERVAL];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands a held moth's hits on ticks 1, 31, 61, and 91", async () => {
  const before = isolate(h);
  placeEnemyNear(h, "moth", OFFSET, 0);
  enable(h, "enemyContact");

  const hitTicks = await captureReplay(h, "rehit", async () => {
    const ticks: number[] = [];
    let hp = before.run.player.hp;
    for (let tick = 1; tick <= EXPECTED[EXPECTED.length - 1]; tick += 1) {
      const s = await advanceTicks(h, 1);
      if (s.run.player.hp < hp) ticks.push(tick);
      hp = s.run.player.hp;
    }
    return ticks;
  });

  assertDeepEqual(
    hitTicks,
    EXPECTED,
    "the ticks on which hp fell under continuous contact (specs/world.md, Contact damage and Timers)",
  );
});
