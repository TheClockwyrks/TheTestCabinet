// Refract — screens/title-howto: confirming HOW TO PLAY on the title opens the
// how-to screen.
//
// specs/ui.md's title table: confirming `HOW TO PLAY` "sets `screen = howto` and
// `menuIndex = 0`". The highlight is put on the third item by two plain down
// presses (the helper asserts each pose), and the confirm is a real key, so what
// is graded is the build's own handling of the `confirm` action on that item.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAction,
  type Harness,
} from "../harness";
import { poseLastTitleItem } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the how-to screen with menuIndex 0", async () => {
  await poseLastTitleItem(h);

  await fireAction(h, "confirm");
  await captureStill(h, "howto");

  const opened = await h.snapshot();
  assertEqual(opened.screen, "howto", "confirming HOW TO PLAY");
  assertEqual(opened.menuIndex, 0, "menuIndex on arriving at howto");
});
