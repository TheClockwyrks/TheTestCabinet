// combo/eat-after-lapse-scores-single — an eat after the lapse starts again at
// one.
//
// specs/scoring.md's table: against a closed window `M` becomes `1`, and "The eat
// then awards `PELLET_POINTS * M` at that new `M`". So a player who let the window
// run out does not resume from the multiplier they had reached; they start over,
// and the pellet is worth ten.
//
// WHY IT IS NOT THE SAME POINT AS `first-eat-scores-single`. That one meets a
// window that was never opened; this one meets a window that was opened, raised a
// multiplier, and then lapsed. A build that resets the window without resetting
// what it had earned passes the first and fails this, which is the whole reason
// the closed-window path is checked from both sides.
//
// The multiplier is posed high and the window full, the snake is held while the
// window runs out, and travel is turned back on for the eat itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import {
  COMBO_MAX,
  COMBO_WINDOW,
  PELLET_POINTS,
  TICK_SECONDS,
} from "../constants";
import {
  arrangeEat,
  captureReplay,
  createHarness,
  gateTravel,
  type Harness,
} from "../harness";

/** The multiplier the round had reached before the window lapsed. */
const REACHED = COMBO_MAX - 1;

/** The budget the window is, in ticks, as specs/scoring.md counts it. */
const BUDGET_TICKS = Math.round(COMBO_WINDOW / TICK_SECONDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("resolves an eat past the lapse at one, and awards PELLET_POINTS", async () => {
  const scene = arrangeEat(h, {
    combo: REACHED,
    comboWindow: COMBO_WINDOW,
    travel: false,
    score: 0,
  });
  assertEqual(
    scene.snapshot.combo,
    REACHED,
    "the multiplier the round reached",
  );

  const run = await captureReplay(h, "after", async () => {
    const lapsed = await h.tick(BUDGET_TICKS);
    gateTravel(h, true);
    return { lapsed, eaten: await h.tick() };
  });

  // The window really lapsed, and took the earned multiplier with it.
  assertCloseTo(
    run.lapsed.comboWindow,
    0,
    9,
    "the window once the budget ran out",
  );
  assertEqual(run.lapsed.combo, 1, "the multiplier once the window lapsed");
  assertEqual(run.lapsed.score, 0, "the score before the eat");

  // So the next eat resolves at one and is worth PELLET_POINTS, not the
  // multiplier the round had reached.
  assertEqual(run.eaten.combo, 1, "the multiplier the eat resolved at");
  assertEqual(run.eaten.score, PELLET_POINTS, "the points the eat awarded");
});
