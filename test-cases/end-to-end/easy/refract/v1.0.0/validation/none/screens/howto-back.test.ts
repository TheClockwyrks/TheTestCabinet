// Refract — screens/howto-back: back leaves the how-to screen for the title.
//
// specs/ui.md's `howto` screen: "`back` ... returns to `title` with
// `HOW TO PLAY` highlighted (`menuIndex = 2`)" — the entry that led away. The
// how-to screen is reached with real keys (the helper asserts each pose), and
// the back press is a real key too, so what is graded is the build's own
// handling of the `back` action on that screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAction,
  type Harness,
} from "../harness";
import { reachHowto } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title with menuIndex 2", async () => {
  await reachHowto(h);

  await fireAction(h, "back");
  await captureStill(h, "title");

  const returned = await h.snapshot();
  assertEqual(returned.screen, "title", "back from howto");
  assertEqual(returned.menuIndex, 2, "menuIndex on returning to the title");
});
