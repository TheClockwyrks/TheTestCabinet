// Automated validation for the Controls sub-item `rotate`.
//
// R rotates the held preview 90 degrees before placing (specs/controls.md). We arm a
// tower, then press R and read the held rotation advance.
//
// WHAT THE CLIP HAS TO SHOW, AND WHAT IT USED TO.
//
// The visible content of a rotation is the radiator fins swinging round the footprint
// (specs/heat.md: they are "drawn as cool cyan fin marks"), and there were two reasons a
// reviewer could not see that happen. The preview was left wherever the build parks a
// freshly-armed one — the top-left corner on at least one build, a 2x2 square of nothing
// in particular — and the arm and the press resolved instantly one after the other, so
// the quarter turn happened inside a single frame before the recording had anything to
// show. What was filmed was three seconds of a stationary preview in the corner of the
// floor.
//
// So the preview is MOVED onto open floor in the middle of the playfield first, and the
// drive turns it through all four rotations with a beat on each. A reviewer watches the
// fins step round N, E, S, W and back — which is also the full cycle the binding
// promises, not just its first quarter.
//
// The Arc is armed by its hotkey rather than by `armTower`, because that is the path a
// player takes to a held preview and this is a controls item; the digit binding itself
// is `controls.arm-hotkeys`'s claim.

import { newGame, press, actTail } from "../_helpers.mjs";

// Where the held preview is parked: open floor near the middle of the playfield, clear
// of the vents and of the panel, so the footprint and its fins are plainly visible.
const PREVIEW_COL = 22;
const PREVIEW_ROW = 16;

// The beat held at each rotation, so the fins are legible in their new orientation
// before the next turn. 45 ticks is 0.75 s; four of them plus the tail is about four
// seconds.
const HOLD = 45;

export default function item() {
  const rotations = [];

  return {
    id: "controls.rotate",

    clipMs: 8000,

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
    },

    // Arm, park the preview somewhere it can be seen, and turn it all the way round.
    async act(api) {
      await press(api, "Digit1"); // arm the Arc
      await api.call("movePreview", PREVIEW_COL, PREVIEW_ROW);
      rotations.push((await api.snapshot()).build.rotation);
      await api.advance(HOLD);

      for (let turn = 0; turn < 4; turn += 1) {
        await press(api, "KeyR");
        rotations.push((await api.snapshot()).build.rotation);
        await api.advance(HOLD);
      }

      await actTail(api, 60);
    },

    async assert(api, check) {
      check.expectEq("the held tower starts un-rotated", rotations[0], 0);
      check.expectEq(
        "R rotates the held tower a quarter turn",
        rotations[1],
        1,
      );
      check.expectEq("a second press turns it again", rotations[2], 2);
      check.expectEq("and a third", rotations[3], 3);
      // Four quarter turns is a full circle, so it must come back to where it started —
      // which also rules out a build that saturates at 3 instead of wrapping.
      check.expectEq(
        "four presses bring it back to its starting orientation",
        rotations[4],
        0,
      );
    },
  };
}
