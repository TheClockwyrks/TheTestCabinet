// Automated validation for the Controls sub-item `arm-hotkeys`.
//
// The number keys 1..8 arm the shop towers in shop order (specs/controls.md). We
// inject the keys and read the held-preview type back — Digit1 arms the first shop
// tower (Arc), Digit4 the fourth (Bloom), Digit7 the seventh (Forge).

import { newGame, press, TOWER_ORDER } from "../_helpers.mjs";

export default function item() {
  let armed1;
  let armed4;
  let armed7;

  return {
    id: "controls.arm-hotkeys",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
    },

    // The key presses are the behavior, so they are what the clip shows: each digit
    // swapping the held preview for a different shop tower.
    async act(api) {
      await press(api, "Digit1");
      armed1 = (await api.snapshot()).build.type;
      await press(api, "Digit4");
      armed4 = (await api.snapshot()).build.type;
      await press(api, "Digit7");
      armed7 = (await api.snapshot()).build.type;
    },

    async assert(api, check) {
      check.expectEq(
        "Digit1 arms the first shop tower",
        armed1,
        TOWER_ORDER[0],
      );
      check.expectEq(
        "Digit4 arms the fourth shop tower",
        armed4,
        TOWER_ORDER[3],
      );
      check.expectEq(
        "Digit7 arms the seventh shop tower",
        armed7,
        TOWER_ORDER[6],
      );
    },
  };
}
