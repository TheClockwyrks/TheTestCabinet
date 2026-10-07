// Wireworm — screens/title-howto: confirming the second title item opens the
// how-to screen.
//
// specs/ui.md's `title` table: `HOW TO PLAY`, the second entry of `TITLE_ITEMS`,
// "Moves to `howto`."
//
// The highlight is posed on the second item rather than pressed down onto it,
// so this decides the confirm alone: `controls/menu-down` is where the down
// binding is graded, and a build with a broken down binding and a working
// how-to route must not fail both.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { CONFIRM_KEY, poseTitle } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`leaves the game on the howto screen after ${TITLE_ITEMS[1]}`, async () => {
  await poseTitle(h, 1);

  await h.tap(CONFIRM_KEY);
  await captureStill(h, "howto");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    `the screen ${TITLE_ITEMS[1]} opened`,
  );
});
