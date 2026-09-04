// multi/deuce — a tie at the win score keeps playing until someone leads by two.
//
// The score is posed at the deuce tie, then real points are driven through the
// goal: the first takes it one clear, which must NOT end the match, and the
// second takes it two clear, which must. Both outcomes resolve through the
// build's own win rule, never a fabricated end state.
//
// Between the two points the scored ball is holding on its home rather than
// waiting behind a countdown, so the second point is set up by cutting that hold
// short and re-aiming the ball once it is in flight again.

import { afterEach, beforeEach, it } from "vitest";
import { WIN_LEAD, WIN_SCORE } from "../constants";
import { assertEqual, assertNull } from "../assert";
import {
  arrangeGoal,
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { readBalls } from "./harness";

/** 10-10: the tie one point below the win score, where the deuce rule applies. */
const TIED_AT = WIN_SCORE - 1;

/** Frames recorded after the deciding point resolves. */
const AFTERMATH_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays on at a one-point lead and ends at two", async () => {
  await startPlaying(h);
  h.debug.setScore(TIED_AT, TIED_AT);

  // First real point: 11-10, a one-point lead, so play continues.
  arrangeGoal(h, "right");
  const oneClear = await h.until((s) => s.score.p1 > TIED_AT, {
    maxFrames: 360,
    poll: 1,
  });

  assertEqual(oneClear.hit, true);
  assertEqual(oneClear.snapshot.screen, "playing");
  assertNull(oneClear.snapshot.winner);
  assertEqual(oneClear.snapshot.score.p1, TIED_AT + 1);
  assertEqual(oneClear.snapshot.score.p2, TIED_AT);

  // Second real point: 12-10, now the required lead, so the match ends. `serve`
  // ends the scored ball's hold; the launch is the build's own, so the scenario
  // is re-aimed once that ball is flying again.
  h.debug.serve();
  const live = await h.until((s) => readBalls(s)[0].held === false, {
    maxFrames: 60,
    poll: 1,
  });
  assertEqual(live.hit, true);

  arrangeGoal(h, "right");
  // The deciding point, and only it: the one before it is the arrangement that
  // put the match at a one-point lead.
  const twoClear = await captureReplay(h, "deuce", async () => {
    const resolved = await h.until((s) => s.screen === "matchover", {
      maxFrames: 360,
      poll: 1,
    });
    await h.advance(AFTERMATH_TICKS);
    return resolved;
  });

  assertEqual(twoClear.hit, true);
  assertEqual(twoClear.snapshot.winner, "left");
  assertEqual(twoClear.snapshot.score.p1, TIED_AT + WIN_LEAD);
  assertEqual(twoClear.snapshot.score.p2, TIED_AT);
});
