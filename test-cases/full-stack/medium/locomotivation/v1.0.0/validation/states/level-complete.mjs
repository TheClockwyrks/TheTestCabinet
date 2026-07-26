// State: the shift-complete summary is reachable by winning a level.

import { setTile, startFresh, TICK } from "../_helpers.mjs";

export default function item() {
  // The screen the win reached.
  let screen;

  return {
    id: "states.level-complete",

    // Pose level 1 one delivery short of its quota, with that delivery in hand.
    async arrange(api) {
      await startFresh(api, 1);
      await api.call("setDelivered", "red", 2);
      await api.call("givePackage", {
        color: "red",
        weightClass: "parcel",
        archetype: "dispenser",
      });
    },

    // Win it for real — the summary is reached the way a player reaches it — then let the
    // screen paint before reading and capturing it.
    async act(api) {
      await setTile(api, 4, 2);
      await api.advance(TICK);

      await api.settle(150);
      screen = (await api.snapshot()).screen;
      await api.screenshot("state");
    },

    async assert(api, check) {
      check.expectEq(
        "winning reaches the shift-complete screen",
        screen,
        "level-complete",
      );
    },
  };
}
