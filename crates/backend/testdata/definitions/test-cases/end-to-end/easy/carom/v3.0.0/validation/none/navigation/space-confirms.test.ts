// navigation/space-confirms — Space confirms a menu entry, as Enter does.
//
// specs/ui.md binds `confirm` to both `Enter` and `Space`. The selection is posed
// on `HOW TO PLAY` and confirmed with a real `Space` press: the screen opened is
// `howto`, which is what the sibling `title-howto` reads back from `Enter` on the
// same item. The two points differ in the key and in nothing else, so a build
// binding only one of the pair fails exactly one of them.

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

it("opens the selected entry on Space", async () => {
  await selectTitle(h, TITLE_HOWTO);

  await h.tap("Space");
  await captureStill(h, "howto");

  assertEqual((await h.snapshot()).screen, "howto");
});
