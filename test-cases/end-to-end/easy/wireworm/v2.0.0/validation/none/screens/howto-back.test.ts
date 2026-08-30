// Wireworm — screens/howto-back: the back binding leaves the how-to screen for
// the title.
//
// specs/ui.md's `howto` screen: "`back` returns to `title`". The screen is posed
// with `setScreen` rather than confirmed into from the title, because
// `screens/title-howto` is the item that decides that route and a build that
// cannot reach the how-to screen must not fail this one twice over. The back
// press itself is a real `Escape`, so what is graded is the build's own handling
// of the `back` action on the screen it is pressed on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { BACK_KEY, poseHowto } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title from the how-to screen", async () => {
  await poseHowto(h);

  await h.tap(BACK_KEY);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the back binding returned to",
  );
});
