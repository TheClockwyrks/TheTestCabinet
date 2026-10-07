// pointer/chest-touch-closes — a touch contact landing and lifting inside the
// chest overlay's one box closes it and resumes the run.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer and touch"),
// rule 3: a contact "landing and lifting inside the rectangle ... takes it
// exactly as `confirm` on it does", with the screen's own paragraph fixing that
// taking `chest`'s one box does "what ... `confirm` on `chest` do[es]".
// specs/ui.md ("`chest`"): "`confirm` closes the overlay, sounding no cue:
// `screen = playing`, and the simulation resumes on the next tick."
//
// WHY THIS IS A POINT OF ITS OWN. The overlay stops the run until it is
// dismissed, so a build that answers no contact there ends the night for a
// player on a touch device — the one place in this game where missing touch
// costs a whole run rather than a convenience. The mouse's route is
// `pointer/chest-click-closes`'.
//
// HOW THE SCENARIO IS DRIVEN. An isolated night, a chest at the lamplighter's
// feet, and the tick that collects it; then a REAL contact landing at the
// middle of the box the build reported and lifting there, one driven frame each.
//
// THE TOLERANCE. None: a screen name is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  touchTapAt,
  type Harness,
} from "../harness";
import { chestPoint } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to playing when the chest overlay's box is tapped", async () => {
  const at = await chestPoint(h);

  const closed = await touchTapAt(h, at);
  await captureStill(h, "closed");

  assertEqual(closed.screen, "playing", "the screen the contact left");
  assertEqual(
    closed.run.chestResult,
    null,
    "the chest result the closed overlay left behind",
  );
});
