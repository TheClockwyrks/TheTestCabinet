// Automated validation for progression.game-over: losing the last life ends the run
// on the Game-over screen, recording the level reached.
//
// One life and a worm walking the floor row into the cursor are the preconditions;
// the end is produced by the real loseLife path (lives -> 0 -> gameover) when the
// segment reaches the cursor, read back and captured.
//
// The worm is left to WALK in rather than posed on top of the cursor — see
// `arrangeWormIntoCursor` for why a posed overlap decided this on a build's choice
// of when to test for contact rather than on whether it costs a life.

import {
  actWormReachesCursor,
  arrangeWormIntoCursor,
  freshBoard,
} from "../_helpers.mjs";

export default function item() {
  let snap;

  return {
    id: "progression.game-over",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setLives", 1); // the next touch is the last
      await arrangeWormIntoCursor(api);
    },

    // The approach and the touch that ends the run are the clip: the reviewer
    // watches the last segment bear down on the cursor and the run end on it.
    async act(api) {
      snap = await actWormReachesCursor(api);
      // The snapshot is captured; hold on the Game-over screen so the clip (and the
      // still below) show the state the assertions read.
      await api.advance(120); // 1s holding on the Game-over screen
      await api.settle(300); // a real pause so the screen has painted before the capture
      await api.screenshot("game-over");
    },

    async assert(api, check) {
      check.expectEq(
        "losing the last life ends the game",
        snap.screen,
        "gameover",
      );
      check.expectEq("no lives remain", snap.lives, 0);
      check.expectGt("the level reached is recorded", snap.reachedLevel, 0);
    },
  };
}
