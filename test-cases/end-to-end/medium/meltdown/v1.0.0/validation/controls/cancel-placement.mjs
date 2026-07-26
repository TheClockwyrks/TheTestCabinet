// Automated validation for the Controls sub-item `cancel-placement`.
//
// Esc cancels an armed placement before it falls back to pausing (specs/controls.md).
// We arm a tower, press Esc, and confirm the held placement is cleared (and the match
// is not paused).

import { newGame, press } from "../_helpers.mjs";

export default function item() {
  let held;
  let s;

  return {
    id: "controls.cancel-placement",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
    },

    // Arm, then cancel. Both halves matter: the check is that Esc consumed the
    // placement INSTEAD of pausing, so the clip has to show the tower being held
    // first.
    async act(api) {
      await press(api, "Digit1"); // arm the Arc
      held = (await api.snapshot()).build.type;
      await press(api, "Escape");
      s = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq("a tower is held", held, "arc");
      check.expectEq("Esc clears the held placement", s.build, null);
      check.expectEq(
        "Esc did not pause (it cancelled the placement first)",
        s.screen,
        "playing",
      );
    },
  };
}
