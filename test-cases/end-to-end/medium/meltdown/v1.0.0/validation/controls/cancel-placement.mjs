// Automated validation for the Controls sub-item `cancel-placement`.
//
// Esc cancels an armed placement before it falls back to pausing (specs/controls.md).
// We arm a tower, press Esc, and confirm the held placement is cleared (and the match
// is not paused).

import { newGame, press, actTail } from "../_helpers.mjs";

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

      // A LEAD-IN BEFORE THE CANCEL. `act` is where the record pass starts filming, and
      // arming and cancelling both resolve instantly, so back to back they landed inside
      // a single frame: the clip opened on a floor with nothing held and never showed
      // the placement that Esc was supposed to consume. Two seconds with the preview
      // visibly held is the before state this item's claim is a comparison against. It
      // costs the verdict nothing — `held` is read before it and `s` on the press.
      await actTail(api, 120); // 2 s with the Arc visibly held on the cursor

      await press(api, "Escape");
      s = await api.snapshot();

      // A key press and the state it leaves behind both resolve instantly, so without
      // this the clip is a still frame of a game that never visibly does anything —
      // three seconds of the result on screen is what makes it reviewable.
      await actTail(api, 180);
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
