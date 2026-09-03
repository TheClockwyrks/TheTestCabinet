// contact/contact-cooldown-counts-out-of-contact — a contact cooldown counts
// down whether or not the enemy is touching the lamplighter.
//
// THE SPEC LINE. `specs/world.md`, "Contact damage": "The cooldown counts down
// on every tick the enemy is alive, in or out of contact." And the phase that
// does it, "One tick" step 7: "Every live enemy's `contactCooldown` counts
// down". The rate is the Timers rule of the same file: "On every tick a timer
// counts down by `TICK_DT`", so a cooldown posed to `0.5` reads
// `0.5 − 10 × TICK_DT` after ten ticks.
//
// WHY 500 UNITS AWAY. The point is the "out of contact" half of the sentence,
// so the moth stands far outside its `10 + 12` overlap bound where no hit can
// land and the cooldown's only history is the count-down. `enemyMotion` is off
// so the moth does not close the distance across the ten ticks — "Every enemy
// holds its position and heading. `age` and `contactCooldown` still count"
// (`specs/instrumentation.md`, The driver switches) — and `enemyContact` is on
// so the contact phase runs as it does in play.
//
// WHY 10 TICKS. Short of the timer's floor by a wide margin: `0.5` is `30`
// ticks, so after ten the reading is a third of a second and nothing near the
// "below `TICK_DT / 2` leaves it at exactly `0`" clamp, whose own point is
// elsewhere.
//
// THE TOLERANCE. Ten subtractions of `TICK_DT`, so `MOTION_EPS`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertNear } from "../assert";
import { CONTACT_COOLDOWN, MOTION_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** Where the moth stands: far outside any overlap. */
const OFFSET = 500;

/** Ticks driven. */
const TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("counts a posed cooldown down by TICK_DT a tick while the moth is out of contact", async () => {
  isolate(h);
  const moth = placeEnemyNear(h, "moth", OFFSET, 0);
  h.debug.setEnemyContactCooldown(moth, CONTACT_COOLDOWN);
  enable(h, "enemyContact");

  const after = await advanceTicks(h, TICKS);
  captureStill(h, "counting");

  const enemy = enemyById(after, moth);
  assertDefined(enemy, "the moth is still live");
  assertNear(
    enemy?.contactCooldown ?? Number.NaN,
    CONTACT_COOLDOWN - TICKS * TICK_DT,
    MOTION_EPS,
    `contactCooldown after ${TICKS} ticks out of contact (specs/world.md, Contact damage)`,
  );
});
