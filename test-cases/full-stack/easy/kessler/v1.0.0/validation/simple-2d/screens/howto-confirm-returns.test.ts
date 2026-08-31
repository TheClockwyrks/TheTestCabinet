// screens/howto-confirm-returns — confirm returns from how to play.
//
// specs/screens.md, on `howto`: "`confirm` and `back` both return to
// `title`." This point is `confirm`'s path; `back`'s is its own point.
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

/** The key that carries `confirm` alone — `Space` also carries `launch`. */
const CONFIRM = KEYS.confirm[1];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the screen back to title on confirm", async () => {
  const posed = poseScene(h, "howto");
  assertEqual(posed.screen, "howto", "the screen confirm is pressed on");

  await tap(h, CONFIRM);
  captureStill(h, "title-after-confirm");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen confirm returned to from howto",
  );
});
