// Automated validation for the Controls sub-item `speed-toggle`.
//
// F toggles the game-speed control between 1x and 2x (specs/controls.md). We read the
// speed, press F, and read it toggle.
//
// A CLIP WITH THE SURGE MOVING, NOT A STILL OF THE INDICATOR.
//
// The toggle "applies to the whole simulation" (specs/controls.md) and "changes how many
// simulation steps run per real second; it does not change the outcome of the
// simulation, only how fast it plays" (specs/gameplay.md) — so what it does is a
// property of MOTION, and a screenshot of a `2x` badge is the one thing that cannot
// show it. A build that draws the badge and ignores it entirely produced an identical
// still. So a Mote is released and walked at 1x for a couple of seconds, F is pressed on
// screen, and the same Mote carries on at double the pace: the badge changes and the
// floor changes with it, in one clip, which is the whole claim.
//
// The verdict is still the snapshot's `speed` field either side of the press. Whether
// the sim really runs at double rate is not something the two passes can measure the
// same way — the validate pass advances by exact steps, which is deliberately immune to
// the speed control — so that half belongs to the clip and the reviewer's eye, which is
// what this item's media is for.

import { newGame, spawn, press, actTail } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "controls.speed-toggle",

    async arrange(api) {
      await newGame(api, "containment", "medium");
      await api.call("setLives", 100000);
      await spawn(api, "mote", "left");
      await spawn(api, "mote", "top");
    },

    // Two seconds of the floor at 1x, the press, then two seconds of it at 2x.
    async act(api) {
      before = (await api.snapshot()).speed;
      await actTail(api, 150); // 2.5 s of the surge walking at 1x

      await press(api, "KeyF");
      after = (await api.snapshot()).speed;

      await actTail(api, 150); // and 2.5 s of the same walk at 2x
    },

    async assert(api, check) {
      check.expectEq("the game starts at 1x", before, 1);
      check.expectEq("F toggles to 2x", after, 2);
    },
  };
}
