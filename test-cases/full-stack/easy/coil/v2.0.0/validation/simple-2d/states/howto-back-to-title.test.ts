// states/howto-back-to-title — `back` leaves the how-to screen for the title.
//
// specs/ui.md, on `howto`: "`back` returns to `title`." specs/controls.md binds
// `back` to `Escape` and, on a menu-bearing screen, has it "leave the screen for
// the one it was reached from".
//
// The how-to screen is reached through the surface rather than through the title
// menu, because whether the menu can OPEN it is `states/howto-reachable`, and a
// build that cannot open the screen must fail that point alone rather than lose
// this one to the same fault. What is pressed here is the key that leaves it.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** The key `specs/controls.md` binds to `back`. */
const BACK = BINDINGS.back[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the screen back to title on back", async () => {
  const posed = poseScene(h, { screen: "howto" });
  assertEqual(posed.screen, "howto", "the screen back is pressed on");

  await h.tap(BACK);
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen back returned to from howto",
  );
});
