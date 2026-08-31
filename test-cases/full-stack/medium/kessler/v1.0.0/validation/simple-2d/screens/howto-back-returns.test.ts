// screens/howto-back-returns — back returns from how to play.
//
// specs/screens.md, on `howto`: "`confirm` and `back` both return to
// `title`." This point is `back`'s path; `confirm`'s is its own point.
//
// The how-to screen is reached through the surface rather than through the
// title menu, because whether the menu can OPEN it is `screens/howto-reachable`,
// and a build that cannot open the screen must fail that point alone rather
// than lose this one to the same fault. What is pressed here is the key that
// leaves it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEYS } from "../constants";
import {
  captureStill,
  openHarness,
  poseScene,
  tap,
  type Harness,
} from "../harness";

/** The key specs/controls.md binds to `back`. */
const BACK = KEYS.back[0];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the screen back to title on back", async () => {
  const posed = poseScene(h, "howto");
  assertEqual(posed.screen, "howto", "the screen back is pressed on");

  await tap(h, BACK);
  captureStill(h, "title-after-back");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen back returned to from howto",
  );
});
