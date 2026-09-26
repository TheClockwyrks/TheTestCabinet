// modes/hundred-victory — clearing all hundred wins the run.
//
// THE RULE. specs/modes.md, The Hundred: "The run is won when the onslaught is
// cleared with at least one life left." specs/waves.md states the general form —
// "Victory is reached by clearing Wave `N` with at least one life left", and on the
// clearing frame "If the wave cleared was Wave `N`, the run ends in victory, and the
// victory screen opens" — and The Hundred's wave count is `1`, so its one wave is
// Wave `N`.
//
// THE VICTORY IS REACHED, NOT POSED. specs/instrumentation.md has `setScreen` set
// the screen alone and run "no screen entry effect", and opening the victory screen
// is exactly the effect under test. So the run is posed at the SHAPE a clear happens
// from — `wavePending` `0` with one live unit, which specs/waves.md clears "on the
// frame in which its last live unit dies or leaks with none of it left to release" —
// and the transition below is the build's own.
//
// THE ONSLAUGHT IS POSED RATHER THAN RELEASED, and the item says so in as many
// words. Releasing a hundred units to see what happens after the hundredth would
// make this point depend on the spawner, the cadence and the composition, which
// `modes.hundred-releases-one-hundred` already decides; one posed unit reaches the
// same transition and depends on none of them.
//
// THE LIVES ARE THE OTHER HALF OF THE CONDITION, and the arrangement keeps them
// clear of it. The Hundred opens on twenty lives (specs/modes.md), the last unit
// goes by leaking, and specs/surge.md costs a Mote's leak `1` life — so nineteen are
// left on the clearing frame and "with at least one life left" holds by a wide
// margin. A build that ends the run in loss here has confused the two endings rather
// than counted the lives finely, and specs/waves.md's other branch —"A leak that
// takes the lives to `0` on the final wave therefore ends the run in loss" — is
// `waves.a-fatal-leak-on-the-final-wave-loses`'s requirement, not this one's.
//
// ONE READING. The screen is `victory`. What that screen then reports is
// `screens.victory-reports-its-figures`, and the score it pays is
// `economy.victory-score-bonus`; a build that ends the run on the game-over screen,
// or leaves it on `playing`, fails here and names which.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, poseWaveEnd, runUntilLeaked } from "./run";

/** The mode this point is about, and the only wave it has. */
const MODE = "hundred";
const WAVE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the victory screen when the onslaught's last unit goes with lives in hand", async () => {
  startRun(h, MODE);
  poseWaveEnd(h, WAVE);
  poseLeaker(h);

  const cleared = await runUntilLeaked(h);
  captureStill(h, "victory");
  assertTrue(cleared, "precondition: the onslaught's last unit left the floor");

  const after = h.snapshot();
  assertGreaterThan(
    after.lives,
    0,
    "precondition: the lives still in hand on the clearing frame, The Hundred " +
      "opening on twenty and one Mote's leak costing one (specs/modes.md, " +
      "specs/surge.md)",
  );
  assertEqual(
    after.screen,
    "victory",
    "the screen clearing the onslaught with lives left opens " +
      "(specs/modes.md, The Hundred)",
  );
});
