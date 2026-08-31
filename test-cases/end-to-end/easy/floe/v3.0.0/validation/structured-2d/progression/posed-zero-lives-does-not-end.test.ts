// progression/posed-zero-lives-does-not-end — an emptied counter is a precondition,
// not an ending: the run keeps playing until a death spends it.
//
// specs/instrumentation.md is explicit about the operation: `setLives(n)` "Sets the
// lives remaining, counting the critter currently crossing. It ends no run, so
// `setLives(0)` leaves the game playing and the next death ends it."
// specs/progression.md hangs the ending on the DEATH HOLD expiring — "When the hold
// expires the run continues or ends" — and on nothing else, so a counter that merely
// stands at `0` ends nothing.
//
// THIS POINT IS WHAT MAKES THE COUNTER SAFE TO POSE. `progression/game-over-at-zero`
// poses a life and spends it, `progression/three-lives` poses the counter away from
// three before opening a run, and every check that reads a life as a DIFFERENCE
// leans on the pose itself being inert. That is graded here rather than assumed.
//
// THE SPAN IS SAMPLED, NOT JUST ENDED. A single reading five seconds on would pass a
// build that ended the run and then restarted it, or one that ended it and came back
// to `playing` from the `PLAY AGAIN` its own menu highlights. So the sweep polls
// every `POLL` and stops the moment the game leaves `playing` or leaves `crossing`,
// and the check requires that it never did — with the sample that ended the sweep
// named in the failure.
//
// NOTHING ON THE STRAIT CAN COST A LIFE. `startCrossing` empties the four rosters and
// shuts the four world gates, and the critter is left where a fresh crossing puts it,
// on the near shore, which is solid footing (specs/strait.md). So no vehicle arrives,
// no bear emerges, no water is underfoot and the crossing timer does not drain: the
// five costs specs/progression.md lists are all off the table, and the only thing
// that could end this run is the counter itself.
//
// Five seconds is the span the review item names, and it is more than five times
// `DEATH_PAUSE` (`0.9` s), so a build that started an ending on the first tick has
// long since finished it by the last reading.

import { afterEach, beforeEach, it } from "vitest";
import { ROW_NEAR, START_COL } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The counter the run is posed with: empty, with no death to spend it. */
const POSED_LIVES = 0;

/** The span the review item names, in frames, and how often it is sampled. */
const WATCH_FRAMES = ticksFor(5);
const POLL = ticksFor(0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps playing a crossing whose counter was posed empty", async () => {
  startCrossing(h);
  h.debug.setLives(POSED_LIVES);

  const posed = h.snapshot();
  assertEqual(posed.lives, POSED_LIVES, "the counter posed empty");
  assertEqual(
    posed.screen,
    "playing",
    "still playing at the moment of the pose",
  );
  assertEqual(
    posed.phase,
    "crossing",
    "still crossing at the moment of the pose",
  );
  assertEqual(
    posed.critter.row,
    ROW_NEAR,
    "the critter on the near shore, where nothing can reach it",
  );
  assertEqual(posed.critter.col, START_COL, "the column a crossing begins on");

  const left = await h.until(
    (state) => state.screen !== "playing" || state.phase !== "crossing",
    { maxFrames: WATCH_FRAMES, poll: POLL },
  );

  captureStill(h, "posed");

  assertTrue(
    !left.hit,
    `the run still playing and still crossing over ${WATCH_FRAMES} frames: it ` +
      `read screen ${JSON.stringify(left.snapshot.screen)} and phase ` +
      `${JSON.stringify(left.snapshot.phase)} after ${left.frames} of them ` +
      `(specs/instrumentation.md)`,
  );

  const after = h.snapshot();
  assertEqual(after.lives, POSED_LIVES, "the counter left as it was posed");
  assertEqual(after.screen, "playing", "the run still under way");
  assertEqual(after.phase, "crossing", "the crossing still under way");
});
