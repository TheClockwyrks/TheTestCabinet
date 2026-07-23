// Automated validation for the Pause sub-item `freezes`.
//
// While paused the simulation does not advance — the surge holds its position
// (specs/ui.md). We get a real Mote moving, pause, then advance; a paused sim
// ignores the advance, so the Mote's position is unchanged.

import { newGame, spawn, unit, press } from "../_helpers.mjs";

export default function item() {
  let mote;
  let before;
  let paused;
  let after;

  return {
    id: "pause.freezes",

    async arrange(api) {
      await newGame(api, "containment", "medium");
      await api.call("setLives", 100000);
      mote = await spawn(api, "mote", "left");
    },

    // Get the Mote genuinely moving first (60 ticks = the old 1s), read where it got
    // to, then pause and advance the same amount again. A paused sim ignores it, so
    // the two positions must match.
    async act(api) {
      await api.advance(60); // get it moving
      before = await unit(api, mote);

      await press(api, "KeyP");
      paused = (await api.snapshot()).screen;
      await api.advance(60); // a paused sim ignores the advance
      after = await unit(api, mote);

      await api.settle(120);
      await api.screenshot("frozen");
    },

    async assert(api, check) {
      check.expectEq("the match is paused", paused, "paused");
      check.expectClose(
        "the Mote's x holds while paused",
        after.x,
        before.x,
        0.01,
      );
      check.expectClose(
        "the Mote's y holds while paused",
        after.y,
        before.y,
        0.01,
      );
    },
  };
}
