// passives/no-recovery-without-tinder — health does not recover with no Tinder
// held.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`: "a passive not held is
// level `0`, so every multiplier starts at `1`, armor and amount bonus at `0`,
// and max health and recovery at their base", and the Recovery section's
// formula "recovery = BASE_RECOVERY + TINDER_RECOVERY_PER_LEVEL × tinder" with
// `BASE_RECOVERY` (`0`) from `specs/world.md`. So `recovery` is `0`, and the
// tick's step, "`hp = min(maxHp, hp + recovery × TICK_DT)`", moves nothing:
// `hp` posed to `50` reads `50` however many ticks pass.
//
// WHY THE SPAN IS TEN SECONDS. Six hundred ticks is long enough that a build
// recovering even `BASE_RECOVERY + 0.5` for a passive it does not hold would
// be five health out, and long enough to catch one that recovers a fixed
// fraction a tick rather than a rate.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding no passive at all,
// with `hp` posed to `50`, half the `100` maximum, so a build that clamped
// upward toward the maximum has somewhere to move to. Every driver switch is
// off, so no enemy, no pickup, and no weapon touches `hp` across the span.
//
// THE TOLERANCE. `REAL_EPS` on the reading, a posed value untouched.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertNear } from "../assert";
import { REAL_EPS, TICK_HZ } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The health posed before the span. */
const POSED_HP = 50;

/** Ten seconds of game time. */
const TICKS = 10 * TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves hp at 50 over six hundred ticks with no Tinder held", async () => {
  const start = isolate(h);
  h.debug.setHp(POSED_HP);

  const after = await advanceTicks(h, TICKS);
  captureStill(h, "none");

  assertLength(
    start.run.passives,
    0,
    "the passives held across the span (specs/passives.md)",
  );
  assertNear(
    after.run.player.hp,
    POSED_HP,
    REAL_EPS,
    "hp after ten seconds with no Tinder held (specs/passives.md, Recovery)",
  );
});
