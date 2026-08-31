// modes/hundred-has-no-build-phases — clearing the onslaught opens no build phase.
//
// THE RULE. specs/modes.md, The Hundred: "There is one untimed opening phase and no
// build phase between waves, because there is one wave", and its table reads `no`
// under Build phases. specs/waves.md gives the transition this point watches: on the
// frame a wave clears, "If the wave cleared was Wave `N`, the run ends in victory...
// Otherwise the wave number rises by one and a build phase for the next wave begins,
// with its timer at `BUILD_PHASE_TIME`". The Hundred's wave count is `1`, so its one
// wave IS Wave `N` and the second branch must never be taken.
//
// THE CLEAR IS REACHED, NOT POSED. specs/instrumentation.md has `setPhase` set that
// field alone and run no entry effect, and "a build phase opens" is exactly the
// effect under test — so the run is posed at the SHAPE a clear happens from and the
// clear itself is the game's own: `wavePending` `0` with one live unit, which
// specs/waves.md clears "on the frame in which its last live unit dies or leaks with
// none of it left to release".
//
// THE ONSLAUGHT IS POSED RATHER THAN RELEASED, and the item says so in as many
// words. Releasing a hundred units to watch what happens after the hundredth would
// make this point depend on the spawner, the cadence and the composition, which
// `modes.hundred-releases-one-hundred` already decides; one posed unit reaches the
// same transition and depends on none of them.
//
// THE LAST UNIT GOES BY LEAKING, which needs no tower, no target and no combat — one
// walker with a single tile left to travel (modes/run.ts). specs/waves.md clears a
// wave on a death or a leak alike, so either reaches the transition, and the leak is
// the one this group can pose in two operations. The Hundred opens on twenty lives,
// so a Mote's leak of `1` leaves nineteen and cannot end the run by itself.
//
// TWO READINGS, ONE CLAUSE. No build phase opened: the phase is not `building`. And
// no countdown started: `buildTimer` is still `0`, where a build that opened the
// phase would have set it to `BUILD_PHASE_TIME` (`15`). The timer is posed at `0`
// going in, for the reason modes/run.ts gives — a wave phase carries no countdown,
// and a reading taken off a timer the arrangement itself had wound up would be
// measuring the arrangement. A build that opens a build phase fails the first; one
// that starts the clock without changing the phase fails the second.
//
// WHAT THIS POINT DOES NOT DECIDE. That the clear shows the victory screen is
// `modes.hundred-victory`; that The Hundred pays no interest is
// `modes.hundred-figures`. Interest is not read here at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertTrue } from "../assert";
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

it("opens no build phase when the onslaught's last unit goes", async () => {
  startRun(h, MODE);
  poseWaveEnd(h, WAVE);
  poseLeaker(h);
  const opened = h.snapshot();

  const cleared = await runUntilLeaked(h);
  captureStill(h, "nobuild");
  assertEqual(
    opened.buildTimer,
    0,
    "posing: the countdown a wave phase carries, which is none (specs/waves.md)",
  );
  assertTrue(cleared, "precondition: the onslaught's last unit left the floor");

  const after = h.snapshot();
  assertNotEqual(
    after.phase,
    "building",
    "the phase the onslaught's clear leaves the run in, The Hundred having no " +
      "build phase between waves (specs/modes.md, The Hundred)",
  );
  assertEqual(
    after.buildTimer,
    0,
    "the build countdown left running after the onslaught's clear, there being " +
      "no build phase for it to count down (specs/modes.md, The Hundred)",
  );
});
