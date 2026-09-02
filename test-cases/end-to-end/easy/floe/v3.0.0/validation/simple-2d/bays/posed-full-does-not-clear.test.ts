// bays/posed-full-does-not-clear — a strait whose five bays merely STAND filled
// is a level still being played.
//
// specs/bays.md is explicit that the clear follows from an event and not from a
// count: "A level is cleared by the hop that fills its last open bay. The clear
// follows from that hop and from no other event, so a strait whose bays stand
// filled without such a hop is a level still being played."
// specs/instrumentation.md says the same of the operation used here: `setBay`
// "scores nothing and clears no level."
//
// THIS POINT IS WHAT MAKES THE WHOLE CHECKLIST'S POSING SAFE. Every suite in
// every category opens on `startCrossing`, which empties the strait's four
// rosters and its bays through `clearBays`, and several pose bays filled on
// purpose. All of that rests on the rule above, so it is graded here rather than
// assumed.
//
// The level is `3` rather than `1`, so "the level unchanged" is a reading a
// broken build cannot match by accident: a build that cleared would read `4`, and
// a build that cleared and started the run over would read `1`. Neither is `3`.
//
// Five seconds is the span the review item names. It is more than three times
// `CLEAR_PAUSE` (`1.6` s), so a build that started a clear at the first tick has
// long since finished it and moved the level on by the time the reading is taken.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BAY_COUNT } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The level the strait is posed at: neither the level a clear would move it to,
 * nor the level a restarted run would read.
 */
const LEVEL = 3;

/** All five bays posed filled. */
const ALL_FILLED: boolean[] = Array.from({ length: BAY_COUNT }, () => true);

/** The span the review item names, in frames. One frame of this suite is one tick. */
const WATCH_FRAMES = ticksFor(5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps playing a level whose bays were posed filled", async () => {
  startCrossing(h, LEVEL);
  for (let bay = 0; bay < BAY_COUNT; bay += 1) h.debug.setBay(bay, true);

  const posed = h.snapshot();
  assertDeepEqual(posed.bays, ALL_FILLED, "five bays posed filled");
  assertEqual(
    posed.phase,
    "crossing",
    "still crossing at the moment of the pose",
  );
  assertEqual(posed.level, LEVEL, "the level posed");

  await h.advance(WATCH_FRAMES);
  captureStill(h, "posed");

  const after = h.snapshot();
  assertEqual(after.phase, "crossing", "no clear followed the posed bays");
  assertEqual(after.level, LEVEL, "the level unchanged");
  assertEqual(after.screen, "playing", "the run still under way");
  assertDeepEqual(
    after.bays,
    ALL_FILLED,
    "the five bays left as they were posed",
  );
});
