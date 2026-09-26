// multi/deuce — a tie at the win score keeps playing until someone leads by two.
//
// The score is posed at the deuce tie, then real points are driven through the
// goal: the first takes it one clear, which must NOT end the match, and the
// second takes it two clear, which must. Both outcomes resolve through the
// build's own win rule, never a fabricated end state.
//
// Each point is staged by `arrangeGoal`, which empties the field down to the one
// ball it drives — the other two are removed and both obstacles with them — and
// drives the paddles out of the lane. Staging the second point that way is also
// what puts the scored ball back in flight: the ball is spawned, taken out of its
// hold, and aimed down the lane, each by an operation that sets one field, so
// there is no waiting on a respawn's hold between the two points.

import { afterEach, beforeEach, it } from "vitest";
import { WIN_LEAD, WIN_SCORE } from "../constants";
import { assertEqual, assertNull } from "../assert";
import {
  arrangeGoal,
  captureReplay,
  createHarness,
  enterPlaying,
  type Harness,
} from "../harness";

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
  enterPlaying(h);
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

  // Second real point: 12-10, now the required lead, so the match ends.
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
