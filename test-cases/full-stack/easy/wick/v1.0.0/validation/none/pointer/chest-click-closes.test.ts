// pointer/chest-click-closes — a click inside the chest overlay's one box
// closes it and resumes the run.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer and touch"):
// "`howto` and `chest` show no menu, and each answers the pointer and touch on
// one rectangle instead: the area the screen's way out is taken in ... taking it
// does what `back` on `howto` and `confirm` on `chest` do." specs/ui.md
// ("`chest`"): "`confirm` closes the overlay, sounding no cue: `screen =
// playing`, and the simulation resumes on the next tick."
//
// WHY THIS IS A POINT OF ITS OWN. The chest overlay stops the run until it is
// dismissed, so a build that answers no gesture there ends the night for a
// player who is not on a keyboard. The keyboard's route is
// `screens/chest-confirm-closes`'.
//
// HOW THE SCENARIO IS DRIVEN. An isolated night, a chest at the lamplighter's
// feet, and the tick that collects it, which is the REAL path the overlay opens
// on; then the primary button pressed and released at the middle of the box the
// build reported.
//
// THE TOLERANCE. None: a screen name is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, clickAt, createHarness, type Harness } from "../harness";
import { chestPoint } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to playing when the chest overlay's box is clicked", async () => {
  const at = await chestPoint(h);

  const closed = await clickAt(h, at);
  await captureStill(h, "closed");

  assertEqual(closed.screen, "playing", "the screen the click left");
  assertEqual(
    closed.run.chestResult,
    null,
    "the chest result the closed overlay left behind",
  );
});
