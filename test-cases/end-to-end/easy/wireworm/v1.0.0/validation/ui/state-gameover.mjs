// Automated validation for ui.state-gameover: the Game-over screen is reachable, and
// the debug API captures it. The state
// is reached the real way — losing the last life.

import {
  actWormReachesCursor,
  arrangeWormIntoCursor,
  freshBoard,
} from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "ui.state-gameover",

    // The worm WALKS into the cursor rather than being posed on top of it — see
    // `arrangeWormIntoCursor` for why a posed overlap left this deciding on a
    // build's choice of when to test for contact rather than on the screen it
    // reaches.
    async arrange(api) {
      await freshBoard(api);
      await api.call("setLives", 1);
      await arrangeWormIntoCursor(api);
    },

    async act(api) {
      screen = (await actWormReachesCursor(api)).screen;
      await api.settle(300); // a real pause so the Game-over screen has painted
      await api.screenshot("gameover");
    },

    async assert(api, check) {
      check.expectEq("the Game-over screen is reachable", screen, "gameover");
    },
  };
}
