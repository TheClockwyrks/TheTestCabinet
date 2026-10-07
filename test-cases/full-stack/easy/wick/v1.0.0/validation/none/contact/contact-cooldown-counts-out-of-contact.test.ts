// contact/contact-cooldown-counts-out-of-contact — a contact cooldown counts
// down out of contact.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Contact damage"): "The
// cooldown counts down on every tick the enemy is alive, in or out of contact."
// And "Timers": "On every tick a timer counts down by `TICK_DT` and is held at
// `0`", with `TICK_DT` `1 / 60`. So a cooldown posed at 0.5 on an enemy 500
// units from the lamplighter reads `0.5 - 10 x TICK_DT`, a third of a second,
// after ten ticks: none of the ten is anywhere near the half-tick at which the
// rule holds a timer at 0.
//
// THE DRIVE. An isolated night with `enemyContact` on, so the reading is taken
// with the faculty live rather than held, and `enemyMotion` off, so the moth
// stays the 500 units away it was posed at rather than closing on the
// lamplighter. Its cooldown is posed to 0.5 through `setEnemyContactCooldown`,
// ten ticks are run, and the cooldown is read.
//
// THE TOLERANCE. `TIMER_TOL`: ten subtractions of an inexact `1 / 60` drift by
// the order of `1e-15`, and the nearest wrong answers are a cooldown that holds
// out of contact (0.5) and one that only counts while overlapping (0.5 again),
// both a sixth of a second away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { CONTACT_COOLDOWN, TICK_DT, TIMER_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** How far from the center the moth is posed: far outside 10 + 12. */
const MOTH_OFFSET = 500;

/** Ticks run with the cooldown counting. */
const TICKS = 10;

/** `0.5 - 10 x TICK_DT`. */
const EXPECTED = CONTACT_COOLDOWN - TICKS * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("counts a posed cooldown down by TICK_DT per tick on a moth 500 units away", async () => {
  await isolate(h, { on: ["enemyContact"] });
  const moth = await placeEnemyNear(h, "moth", MOTH_OFFSET, 0);
  await h.debug.setEnemyContactCooldown(moth.id, CONTACT_COOLDOWN);

  const after = await h.step(TICKS);

  // The moth well clear of the lamplighter with its cooldown counting. Captured
  // before the assertion, so a failing build leaves the picture that shows why.
  await captureStill(h, "counting");

  assertNear(
    mustEnemy(after, moth.id).contactCooldown,
    EXPECTED,
    TIMER_TOL,
    `the moth's contactCooldown after ${TICKS} ticks out of contact`,
  );
});
