// states/gameover-play-again — PLAY AGAIN from the game-over screen opens a fresh
// round.
//
// specs/ui.md, on `gameover` and `cleared`: "`confirm` on `PLAY AGAIN` starts a
// fresh round in the same mode." A fresh round is the one specs/board.md and
// specs/scoring.md describe: the starting chain of `START_CELLS` and a score of
// `0`.
//
// The round that ended is grown and scored, so both readings have somewhere to
// fall from. `PLAY AGAIN` is the first item of `OVER_ITEMS` and specs/ui.md sets
// `menuIndex` to `0` on arriving at a menu-bearing screen, so one `confirm`
// accepts it; the highlight is posed rather than pressed for, so a build whose
// highlight will not move fails `controls/menu-highlight-moves` alone.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, START_CELLS } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** The first key `specs/controls.md` binds to `confirm`. */
const CONFIRM = BINDINGS.confirm[0];

/** `PLAY AGAIN` is the first item of `OVER_ITEMS` (specs/ui.md). */
const PLAY_AGAIN_INDEX = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays out a fresh round on confirm at PLAY AGAIN", async () => {
  const over = poseScene(h, {
    screen: "gameover",
    menuIndex: PLAY_AGAIN_INDEX,
    snake: chainFrom(HOME_HEAD, "right", 8),
    dir: "right",
    pellet: null,
    score: 530,
    best: 530,
  });
  assertEqual(over.screen, "gameover", "the screen PLAY AGAIN is confirmed on");

  await h.tap(CONFIRM);
  captureStill(h, "again");

  const fresh = h.snapshot();
  assertEqual(fresh.screen, "playing", "the screen PLAY AGAIN opened");
  assertDeepEqual(
    fresh.snake,
    [...START_CELLS],
    "the chain the fresh round opens on",
  );
  assertEqual(fresh.score, 0, "the score the fresh round opens at");
});
