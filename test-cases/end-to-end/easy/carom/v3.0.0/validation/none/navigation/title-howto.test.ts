// navigation/title-howto — confirming HOW TO PLAY opens the how-to screen.
//
// specs/ui.md: on the title, `confirm` on `HOW TO PLAY` sets `screen = howto`.
// The selection is posed on the third entry and the confirm is a real `Enter`
// pressed through Chromium's own input pipeline, so a build whose arrow keys
// never reach the item still has its confirm graded here — the arrows are
// `title-down`'s point and `title-down-wraps`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { TITLE_HOWTO, selectTitle } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the how-to screen from the title", async () => {
  await selectTitle(h, TITLE_HOWTO);

  await h.tap("Enter");
  await captureStill(h, "howto");

  assertEqual((await h.snapshot()).screen, "howto");
});
