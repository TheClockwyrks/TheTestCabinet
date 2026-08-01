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

    // Get the Mote genuinely moving first, read where it got to, then pause and
    // advance the same amount again. A paused sim ignores it, so the two positions
    // must match.
    //
    // Both halves run for three seconds rather than one, because this item's evidence
    // is a CONTRAST and one second of each is too short to be one. A still can only
    // ever show the second half — a Mote standing on the floor, which is also what a
    // Mote that never moved looks like — so the clip is what carries the claim, and it
    // has to contain enough walking before the pause for the stopping to register as
    // stopping. Three seconds is about 180 px of travel at a Mote's 60 px/s, most of a
    // tenth of the floor, against three seconds of it not moving at all.
    async act(api) {
      await api.advance(180); // 3 s of the Mote walking, under its own power
      before = await unit(api, mote);

      await press(api, "KeyP");
      paused = (await api.snapshot()).screen;
      await api.advance(180); // 3 s a paused sim ignores
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
