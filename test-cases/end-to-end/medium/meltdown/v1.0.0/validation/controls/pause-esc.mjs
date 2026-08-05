// Automated validation for the Controls sub-item `pause-esc`.
//
// Esc pauses a live match when nothing is armed or selected (specs/controls.md).
//
// THE FLOOR HAS TO BE MOVING FOR THE PAUSE TO BE VISIBLE — see the same note on
// `controls.pause-p`. A Mote is released and walked for a couple of seconds before the
// key goes down, and the drive runs on afterwards with the sim still being advanced, so
// the clip shows a unit crossing the floor, the pause menu arriving, and the unit
// stopping dead behind it. Esc is the THREE-WAY binding (cancel a placement, else
// deselect, else pause), so nothing is armed or selected here and it falls through to
// pausing, which is the branch this item owns.

import { newGame, spawn, press, actTail } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "controls.pause-esc",

    // A live match with nothing armed or selected, so Esc has nothing to cancel and
    // falls through to pausing.
    async arrange(api) {
      await newGame(api, "containment", "medium");
      await api.call("setLives", 100000);
      await spawn(api, "mote", "left");
    },

    async act(api) {
      await actTail(api, 150); // 2.5 s of the Mote walking, under its own power
      await press(api, "Escape");
      screen = (await api.snapshot()).screen;

      // And on afterwards, with the simulation still being advanced: a paused game
      // ignores it, so the same Mote visibly holds its position behind the menu.
      await actTail(api, 180);
    },

    async assert(api, check) {
      check.expectEq("Esc pauses the match", screen, "paused");
    },
  };
}
