// Automated validation (Warhead) for the Controls item (Warhead) `one-charge`: secondary fire (F)
// launches a single torpedo, consuming the charge, with at most one stored and one in
// flight. With a charge ready, F is pressed twice: the first launches one torpedo and
// empties the charge; the second, with no charge and one already in flight, does nothing.
//
// The ship's pose and the readied charge are the preconditions (`arrange`); the two presses are
// the behavior, and key presses are control ops which are legal in `act`, so they live there —
// which is also what makes the clip show the launch happening rather than opening on a torpedo
// already in flight.

import { newGame, poseShip } from "../_helpers.mjs";

export default function item() {
  // The charge state before firing, and the field after each press.
  let ready;
  let after1;
  let afterSecondPress;

  return {
    id: "controls.one-charge",

    async arrange(api) {
      await newGame(api);
      await poseShip(api, { x: 300, y: 360, vx: 0, vy: 0, angle: 0 });
      await api.call("setTorpedoReady", true);
    },

    async act(api) {
      ready = (await api.snapshot()).torpedoReady;

      await api.call("press", "KeyF"); // launch
      after1 = await api.snapshot();

      await api.call("press", "KeyF"); // no charge, one already in flight — nothing
      afterSecondPress = (await api.snapshot()).torpedoes.length;

      // Let the single torpedo fly so the clip shows one, not two: 0.8 s = 96 ticks.
      await api.advance(96);
    },

    async assert(api, check) {
      check.expectEq("a torpedo charge is ready", ready, true);
      check.expectEq("F launches one torpedo", after1.torpedoes.length, 1);
      check.expectEq(
        "launching consumes the charge",
        after1.torpedoReady,
        false,
      );
      check.expectEq(
        "a second F does not launch a second torpedo",
        afterSecondPress,
        1,
      );
    },
  };
}
