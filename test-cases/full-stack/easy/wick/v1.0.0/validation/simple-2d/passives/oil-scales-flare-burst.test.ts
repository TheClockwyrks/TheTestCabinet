// Wick — passives/oil-scales-flare-burst: `cooldownMul` scales the interval
// between bursts like any other cooldown.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Cooldown"): "for Flare
// it is the interval between bursts; both scale the same way", over
// "`cooldownMul = 1 − OIL_COOLDOWN_PER_LEVEL × oil`" with
// `OIL_COOLDOWN_PER_LEVEL` (`0.08`). At Oil level 5, `cooldownMul` is `0.6`.
// Row 1 of `FLARE_LEVELS` carries `60`, so the timer a burst sets reads `36`,
// clear of `MIN_COOLDOWN` (`0.2`). The other interval Oil scales is
// `passives/oil-scales-halo-pulse`.
//
// THE POSE. An isolated night with Oil 5 held, and the weapon held at level 1
// and fired by one tick. It needs no target, so no enemy is posed; the reading
// is the timer the tick left.
//
// TOLERANCE. `TIMER_TOL` (`1e-6`) on the timer, the case's allowance for a
// count in seconds. The nearest wrong answer, the unscaled figure, is far
// outside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  FLARE_LEVELS,
  cooldownFor,
  type HeldPassives,
} from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { armAll, holdPassives, slotOf, timerOf } from "./night";

/** The passives held: Oil at level 5. */
const HELD: HeldPassives = { oil: 5 };

/** The level the weapon is held at: row 1 of its table. */
const LEVEL = 1;

/** The table figure times `cooldownMul`, floored at `MIN_COOLDOWN`. */
const EXPECTED = cooldownFor(FLARE_LEVELS[LEVEL - 1].cooldown, HELD);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads 36 with Oil 5 held", async () => {
  isolate(h);
  holdPassives(h, HELD);
  const slots = armAll(h, [["flare", LEVEL]]);

  const after = await h.tick(1);
  captureStill(h, "interval");

  assertWithin(
    timerOf(after, slotOf(slots, "flare")),
    EXPECTED,
    FIGURE_TOLERANCE,
    "the timer after the level-1 firing with Oil 5 held",
  );
});
