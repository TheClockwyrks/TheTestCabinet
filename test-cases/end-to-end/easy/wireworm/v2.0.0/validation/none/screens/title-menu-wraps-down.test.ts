// Wireworm — screens/title-menu-wraps-down: moving down from the last title item
// highlights the first.
//
// specs/controls.md, "Menus": "`up` and `down` move the highlight by one item
// and wrap at both ends, so moving down from the last item highlights the
// first." With `TITLE_ITEMS` two entries long, the last item is index
// `TITLE_ITEMS.length - 1` and the wrap lands on `0`; a build that clamps
// instead of wrapping leaves the highlight where it was, which reads as a
// different number.
//
// The last item is POSED with `setMenuIndex` rather than walked to with a down
// press, so this check does not lean on the plain movement it is a special case
// of — that is `controls/menu-down`'s requirement, and a build that got the
// movement wrong must fail there rather than here as well.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { MENU_DOWN_KEY, poseTitle } from "./screens";

/** The last row of the title menu, which a down press wraps off the end of. */
const LAST_ITEM = TITLE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps the highlight from the last title item to the first", async () => {
  await poseTitle(h, LAST_ITEM);

  await h.tap(MENU_DOWN_KEY);
  await captureStill(h, "wrapped");

  assertEqual(
    (await h.snapshot()).menuIndex,
    0,
    `the highlight after a down press on item ${LAST_ITEM}`,
  );
});
