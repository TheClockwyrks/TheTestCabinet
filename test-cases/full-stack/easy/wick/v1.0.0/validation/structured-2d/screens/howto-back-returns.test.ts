// Wick — screens/howto-back-returns: `back` on the how-to screen returns to
// the title.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`howto`": "`back`
// returns to `title` with `menuIndex = 0`." `specs/controls.md` gives the
// `howto` row "`back` returns to `title`; `mute`" and binds `back` to
// `Escape`.
//
// THE DRIVE. The how-to screen posed through the debug surface, which enters
// it "exactly as confirming `HOW TO PLAY` does"
// (`specs/instrumentation.md`), then one real `Escape`. The title menu is
// never pressed, so this point is about the return alone.
//
// THE TOLERANCE. None: a screen name and an index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScreen,
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

it("reads title with menuIndex 0 after Escape on howto", async () => {
  h.reset();
  const posed = poseScreen(h, "howto");
  assertEqual(posed.screen, "howto", "the screen the press is made on");

  const after = await tap(h, "Escape");
  captureStill(h, "back");

  assertEqual(after.screen, "title", "the screen after Escape on howto");
  assertEqual(after.menuIndex, 0, "menuIndex on arriving back at the title");
});
