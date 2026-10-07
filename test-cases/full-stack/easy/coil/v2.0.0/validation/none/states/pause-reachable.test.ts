// states/pause-reachable — a live round pauses, and the round is still there.
//
// specs/controls.md has `back` pause a live round, and specs/ui.md has `paused`
// "reached from `playing`", with the round "frozen behind it". Both halves are
// read: the screen the game moves to, and that the round it left is still the
// round underneath — the same chain, on the same heading, with the same score. A
// build that answered `back` by tearing the round down and returning something
// fresh leaves the player nothing to resume, and fails on the second reading
// while passing on the first.
//
// The round is reached through the surface rather than through the title menu,
// and the chain is posed clear of the board's furniture with nothing else on the
// board, so what this decides is the pause and nothing on the way to it. What the
// pause menu DRAWS is `screens/pause-items`; that nothing advances behind it is
// `states/pause-freezes-tick`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { KEY } from "../constants";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** A chain long enough to read as a round in progress. */
const CHAIN = chainFrom(HOME_HEAD, "right", 6);
const SCORE = 290;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves a live round to paused with the round still behind it", async () => {
  const live = await poseScene(h, {
    snake: CHAIN,
    dir: "right",
    pellet: null,
    travel: false,
    score: SCORE,
    best: SCORE,
  });
  assertEqual(live.screen, "playing", "the screen back is pressed on");

  await h.tap(KEY.back);
  await captureStill(h, "paused");

  const paused = await h.snapshot();
  assertEqual(paused.screen, "paused", "the screen back opened from playing");
  assertDeepEqual(paused.snake, CHAIN, "the chain the pause left in place");
  assertEqual(paused.dir, "right", "the heading the pause left in place");
  assertEqual(paused.score, SCORE, "the score the pause left in place");
});
