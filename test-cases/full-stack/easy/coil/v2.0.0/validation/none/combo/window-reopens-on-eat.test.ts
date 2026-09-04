// combo/window-reopens-on-eat — an eat sets the window back to a full one.
//
// specs/scoring.md: "The eat then awards `PELLET_POINTS * M` at that new `M`, and
// reopens the window at a full `COMBO_WINDOW`" — whatever was left on it. That is
// the rule that makes a chain of pellets a chain: each one buys the player another
// 28 ticks to reach the next.
//
// WHAT THE READING IS, EXACTLY. The reopen happens at step 5 of the tick, and step
// 6 of that same tick "Draw[s] `TICK_SECONDS` off the combo window"
// (specs/movement.md), unconditionally. So a window read at the end of the tick
// that ate is a full `COMBO_WINDOW` less the one tick that has passed since —
// which is the composition of the two steps in the order the specification fixes
// them, and is 28 ticks of travel less the tick the player spent arriving. A build
// that does not reopen at all reads near zero here, which is the failure the point
// is for.
//
// The window is posed nearly spent, so "whatever was left on it" is as far from a
// full one as the rule allows.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { COMBO_WINDOW, TICK_SECONDS } from "../constants";
import {
  arrangeEat,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** Seconds left on the window at the eat: one tick's worth, and still open. */
const NEARLY_SPENT = TICK_SECONDS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts a full window back on the tick that ate", async () => {
  const scene = await arrangeEat(h, { combo: 2, comboWindow: NEARLY_SPENT });
  assertCloseTo(
    scene.snapshot.comboWindow,
    NEARLY_SPENT,
    9,
    "the window before the eat",
  );

  const after = await captureReplay(h, "reopen", () => h.tick());

  assertEqual(after.ticks, 1, "ticks resolved");
  assertCloseTo(
    after.comboWindow,
    COMBO_WINDOW - TICK_SECONDS,
    9,
    "a full COMBO_WINDOW reopened at step 5, less the tick step 6 drew off",
  );
});
