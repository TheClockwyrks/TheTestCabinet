// Wireworm — screens/title-menu-wraps-up: moving up from the first title item
// highlights the last.
//
// specs/controls.md, "Menus": "`up` and `down` move the highlight by one item
// and wrap at both ends, so ... moving up from the first highlights the last."
// The first item is index `0` and the wrap lands on `TITLE_ITEMS.length - 1`; a
// build that clamps instead of wrapping leaves the highlight at `0`, which reads
// as a different number.
//
// The first item is where a reset title already rests, and it is posed anyway,
// so the check never depends on a movement it is not grading —
// `controls/menu-up` is where the plain up press is decided.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { MENU_UP_KEY, poseTitle } from "./screens";

/** The last row of the title menu, which an up press wraps off the front onto. */
const LAST_ITEM = TITLE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps the highlight from the first title item to the last", async () => {
  await poseTitle(h, 0);

  await h.tap(MENU_UP_KEY);
  await captureStill(h, "wrapped");

  assertEqual(
    (await h.snapshot()).menuIndex,
    LAST_ITEM,
    "the highlight after an up press on item 0",
  );
});
