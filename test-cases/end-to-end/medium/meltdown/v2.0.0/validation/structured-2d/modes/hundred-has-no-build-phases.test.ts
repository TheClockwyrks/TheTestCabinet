// Meltdown — modes/hundred-has-no-build-phases: clearing the onslaught ends the
// run instead of opening a build phase.
//
// THE RULE. `specs/modes.md`, The Hundred: "There is one untimed opening phase
// and no build phase between waves, because there is one wave", and the
// derived-figures table gives the mode `1` wave and `no` build phases.
// `specs/waves.md` fixes what a clear does with that: "If the wave cleared was
// Wave `N`, the run ends in victory... Otherwise the wave number rises by one and
// a build phase for the next wave begins." So on The Hundred the first clear is
// the last, and there is no build phase behind it.
//
// THE END OF THE WAVE IS POSED AND THE CLEAR IS DRIVEN. `specs/waves.md` clears a
// wave "on the frame in which its last live unit dies or leaks with none of it
// left to release", so the arrangement is `wavePending` `0` with exactly one live
// unit — the same end-of-wave shape `waves.wave-clears-when-the-last-unit-goes`
// uses — and the CLEAR itself is reached through the game's own transition,
// because `setPhase` "runs no entry effect" (`specs/instrumentation.md`) and the
// entry effect is the whole question.
//
// WHY IT IS POSED RATHER THAN RELEASED. Releasing a hundred units to watch what
// happens after the hundredth would make this item depend on the spawner, the
// cadence and the composition, all of which
// `modes.hundred-releases-one-hundred` already decides — and a build with a
// perfect ending and a broken spawner would then fail twice for one fault.
//
// WHAT IS READ, AND HOW IT STAYS APART FROM `modes.hundred-victory`. This point
// reads that the run ENDED — the `playing` screen is gone and no `building` phase
// opened behind it — and says nothing about which ending was shown. Which screen
// a cleared onslaught opens is `modes.hundred-victory`, so a build that ends the
// run on the game-over screen fails there and passes here, and the two grades
// stay separable. Interest is `modes.hundred-figures`'s business, not this
// item's.
//
// WHAT EVERY WRONG MODEL READS. A build that gave The Hundred the standard twenty
// waves opens a build phase on wave 2 and stays on `playing`; one that gave it
// build phases but one wave ends the run without a build phase and passes; one
// that never clears at all stays on `playing` in the `wave` phase and fails.
//
// THE LIVES ARE LEFT WHERE THE MODE PUTS THEM — `START_LIVES` (`20`) — and the
// clear is reached by a leak costing a single life (`modes/ending.ts`), so the
// run still has nineteen in hand and cannot be ending because it ran out.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertTrue } from "../assert";
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

it("ends the run rather than opening a build phase when the onslaught clears", async () => {
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
  captureStill(h, "nobuild");

  assertTrue(gone, "precondition: the onslaught's last unit left the floor");
  const after = h.snapshot();
  assertNotEqual(
    after.screen,
    "playing",
    "the screen a cleared onslaught leaves the run on",
  );
  assertNotEqual(
    after.phase,
    "building",
    "the phase a cleared onslaught leaves the run in",
  );
});
