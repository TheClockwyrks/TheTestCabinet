// Meltdown — modes/hundred-victory: clearing the onslaught with a life in hand
// wins the run.
//
// THE RULE. `specs/modes.md`, The Hundred: "The run is won when the onslaught is
// cleared with at least one life left." `specs/waves.md` says the same thing in
// general terms — "Victory is reached by clearing Wave `N` with at least one life
// left", and on that clear "the run ends in victory, and the victory screen
// opens" — and The Hundred's `N` is its one wave.
//
// THE END OF THE WAVE IS POSED AND THE CLEAR IS DRIVEN. `specs/waves.md` clears a
// wave "on the frame in which its last live unit dies or leaks with none of it
// left to release", so the arrangement is `wavePending` `0` with exactly one live
// unit, and the victory is reached through the game's own transition, because
// `setScreen` "runs no entry effect" (`specs/instrumentation.md`) and the entry
// effect is the whole question.
//
// WHY IT IS POSED RATHER THAN RELEASED. Releasing a hundred units to watch what
// happens after the hundredth would make this item depend on the spawner, the
// cadence and the composition, which `modes.hundred-releases-one-hundred` already
// decides.
//
// THE LIFE IN HAND IS THE CONDITION, AND IT IS CHECKED BEFORE THE READING. The
// mode opens on `START_LIVES` (`20`) and the clear is reached by a leak costing a
// single life (`modes/ending.ts`), so nineteen remain — comfortably the "at least
// one" the rule names, and nowhere near the `0` that would make this a loss
// instead. `waves.a-fatal-leak-on-the-final-wave-loses` is the item that decides
// the other side of that boundary, and nothing here approaches it.
//
// WHAT IS READ, AND HOW IT STAYS APART FROM `modes.hundred-has-no-build-phases`.
// This point reads the screen the clear opened: `victory` and nothing else. That
// the run ENDS rather than rolling into a build phase is the other item, so a
// build that ends the run on the game-over screen passes there and fails here.
//
// WHAT EVERY WRONG MODEL READS. A build that gave The Hundred more than one wave
// reads `playing`; one that treats a leak-cleared wave as a loss reads
// `gameover`; one that never clears reads `playing`. The reading is a screen
// name and carries no tolerance.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, poseWaveEnd, runUntilLeaked } from "./ending";

/** The mode this point reads, and its one wave. */
const MODE = "hundred";
const ONSLAUGHT = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the victory screen when the onslaught's last unit goes", async () => {
  startRun(h, MODE);
  poseWaveEnd(h, ONSLAUGHT);
  poseLeaker(h);

  const before = h.snapshot();
  assertEqual(before.mode, MODE, "precondition: the mode the run is posed on");
  assertEqual(
    before.wavePending,
    0,
    "precondition: the units still to release",
  );
  assertEqual(before.surge.length, 1, "precondition: the units on the floor");
  assertTrue(
    before.lives > 1,
    "precondition: the lives in hand before the last unit leaks",
  );

  const gone = await runUntilLeaked(h);
  captureStill(h, "victory");

  assertTrue(gone, "precondition: the onslaught's last unit left the floor");
  const after = h.snapshot();
  assertTrue(
    after.lives >= 1,
    "precondition: a life still in hand when the onslaught cleared",
  );
  assertEqual(
    after.screen,
    "victory",
    "the screen a cleared onslaught opens with a life in hand",
  );
});
