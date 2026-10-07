// progression/level-cleared — emptying an exhausted channel clears the level.
//
// THE SPEC LINE. `specs/progression.md` — "Clearing a level": "A level is cleared
// the moment its quota is exhausted and no cores remain on the channel." The
// screen it moves to is that file's own table: "Levels 1 through 4 cleared |
// `cleared` | the next level, after the interlude".
//
// THE DRIVE. `clearing.ts` poses level 1 with its quota spent and one run of
// three matching cores on the channel's first leg, and fires a matching core into
// them. The insertion carries the run past `MIN_RUN`, `specs/extraction.md`
// extracts every core of it, and the channel is left empty on that tick;
// `specs/channel.md`'s order of a tick resolves the insertion at step 3 and the
// clear at step 6, so the screen moves on the same tick the last core leaves.
//
// WHAT IS DECIDED, AND WHAT IS NOT. One question: does the screen become
// `cleared`. That the channel emptied is asserted as the drive's own precondition
// — a screen that never changed because the shot missed is a fact about this
// suite rather than about the build — and what an extraction pays is
// `extraction/`'s to decide.
//
// TOLERANCES. None: a screen name and a core count are both exact, and the
// standing tolerances make them so ("count, score, charge id, screen | exact").
// The only bound is the sweep's, and it is a ceiling rather than a tolerance: 90
// ticks covers the 28-tick flight several times over and stays inside the 2 s
// (120-tick) interlude a clear opens, so a passing sweep stops on the clearing
// tick rather than on the level that follows it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  coreCount,
  createHarness,
  type Harness,
} from "../harness";
import { driveClear, poseClearingHall } from "./clearing";

/** Levels 1 through 4 clear to `cleared`; level 5 is `progression/victory`. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves to the cleared screen on the tick the last core leaves", async () => {
  await poseClearingHall(h, LEVEL);

  const drive = await captureReplay(h, "clear", () => driveClear(h));

  // The screen first, because it is the reading the item is named for: a build
  // that skips the interlude reports the level after it here, and the count of
  // cores would otherwise be the pair a reviewer reads.
  assertEqual(drive.ended.screen, "cleared", "the screen on the clearing tick");
  assertEqual(
    coreCount(drive.ended),
    0,
    "no core left on the channel once the run was extracted",
  );
});
