// collision/death-halts-the-tick — a fatal tick runs no further steps.
//
// specs/movement.md's step 3: "Test the new head cell for a fatal collision. If it
// is fatal, the round ends and steps 4 to 6 do not run."
//
// Three of the tick's six steps are therefore observable by their absence, and
// each is read here against the value it held before the tick: step 4 would have
// moved the chain, step 5 would have scored, and step 6 would have drawn
// `TICK_SECONDS` off the combo window. A build that resolves the death and then
// carries on down the list shows a player their score rising on the frame they
// died, or their snake buried one cell inside a wall.
//
// The combo window is posed OPEN and part spent, so step 6 has something to take
// and its absence is visible; the score is posed above zero for the same reason.
// The head is one cell from a wall, which is the shortest route to a fatal cell
// that touches nothing else the reading is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual, assertEqual } from "../assert";
import { COMBO_WINDOW } from "../constants";
import {
  arrangeApproach,
  captureReplay,
  createHarness,
  WALL_CELL,
  type Harness,
} from "../harness";

/** The score the round stands at when the fatal tick resolves. */
const SCORE = 250;

/** The multiplier in force, so a step 5 that ran would be plain to see. */
const COMBO = 3;

/** Seconds left on the window, part spent so step 6 has something to draw off. */
const WINDOW = COMBO_WINDOW / 2;

/** Ticks of clear travel before the tick this point reads. */
const RUN_UP = 3;

/** Ticks run after it, so what it left behind is on the recording. */
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the chain, the score and the window as the tick found them", async () => {
  const posed = await arrangeApproach(h, WALL_CELL, {
    dir: "left",
    length: 4,
    score: SCORE,
    combo: COMBO,
    comboWindow: WINDOW,
    runUp: RUN_UP + 1,
  });
  assertEqual(posed.snapshot.screen, "playing", "the round before the tick");

  // The readings the fatal tick is measured against are taken at the END of the
  // run-up, because the window drains on every tick the chain travels.
  const run = await captureReplay(h, "halted", async () => {
    const before = await h.tick(RUN_UP);
    const fatal = await h.tick();
    await h.tick(SETTLE);
    return { before, fatal };
  });
  const { before, fatal: after } = run;

  assertEqual(after.screen, "gameover", "the screen the fatal tick reached");
  // Step 4 did not run: the chain is exactly as it was, head included.
  assertDeepEqual(after.snake, before.snake, "the chain after the fatal tick");
  // Step 5 did not run.
  assertEqual(after.score, SCORE, "the score after the fatal tick");
  // Step 6 did not run.
  assertCloseTo(
    after.comboWindow,
    before.comboWindow,
    9,
    "the seconds left on the window after the fatal tick",
  );
});
