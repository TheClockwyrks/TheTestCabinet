// Automated validation for the Controls sub-item `pause-p`.
//
// P pauses a live match (specs/controls.md).
//
// THE FLOOR HAS TO BE MOVING FOR THE PAUSE TO BE VISIBLE. This used to start a match and
// press P as the first statement of `act`, which is where the record pass begins
// filming — so the clip opened on an already-paused menu over an empty opening build
// phase. Nothing moved before the press because nothing was ever moving, and nothing
// moved after it for the same reason, which leaves a pause indistinguishable from a game
// that was never running.
//
// So a Mote is released and walked for a couple of seconds before the key goes down, and
// the drive runs on afterwards with the sim still being advanced. What the clip shows is
// a unit crossing the floor, the pause menu arriving, and the unit stopping dead behind
// it — the same shape `pause.freezes` uses, which is the item that owns the freeze
// itself. This one owns the KEY, so the verdict is still read on the press.

import { newGame, spawn, press, actTail } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "controls.pause-p",

    async arrange(api) {
      await newGame(api, "containment", "medium");
      await api.call("setLives", 100000);
      await spawn(api, "mote", "left");
    },

    async act(api) {
      await actTail(api, 150); // 2.5 s of the Mote walking, under its own power
      await press(api, "KeyP");
      screen = (await api.snapshot()).screen;

      // And on afterwards, with the simulation still being advanced: a paused game
      // ignores it, so the same Mote visibly holds its position behind the menu.
      await actTail(api, 180);
    },

    async assert(api, check) {
      check.expectEq("P pauses the match", screen, "paused");
    },
  };
}
