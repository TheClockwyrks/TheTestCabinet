// screens/howto-back-returns — back returns from the how-to screen.
//
// WHAT THIS DECIDES. One thing: a `back` press on `howto` leaves the game on
// `title` with `HOW TO PLAY` selected.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`howto`): "`back` returns to `title` with `HOW TO PLAY`
//   selected."
//   specs/controls.md ("What each screen reads"): "`howto` | none | `back`
//   returns to `title`; `mute`".
//   specs/controls.md ("Actions and bindings"): `back` is `Escape`.
//
// THE DRIVE. The how-to screen through `setScreen("howto")`, which sets the
// screen and the three indices and nothing else (specs/instrumentation.md), so
// the title's menu is not walked to get there, then one real `Escape` press
// over one frame. The entry the return selects is the how-to screen's own,
// whatever route reached it.
//
// THE TOLERANCE. None: a screen name and a menu index are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns to the title with HOW TO PLAY selected", async () => {
  const posed = poseScene(h, "howto");
  assertEqual(posed.screen, "howto", "the screen Escape is pressed on");

  const after = await tap(h, "Escape");
  captureStill(h, "back");

  assertEqual(after.screen, "title", "the screen Escape left the game on");
  assertEqual(
    after.menuIndex,
    TITLE_ITEMS.indexOf("HOW TO PLAY"),
    "the entry selected on returning to the title",
  );
});
