// navigation/title-down-wraps — one down press on the last title item wraps to
// the first.
//
// specs/ui.md: on the title, `p1-down` or `p2-down` moves `menuIndex` down one,
// wrapping from the last item to 0. The wrap is the whole of the point, so the
// selection is POSED on the last item and exactly one real `ArrowDown` is
// pressed from there: two presses to walk down to it would fail this point
// whenever the ordinary down edge was broken, which is `title-down`'s.
//
// The snapshot reports `menuIndex`, so the wrapped selection is read straight off
// it rather than inferred by confirming.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { TITLE_HOWTO, TITLE_SOLO, selectTitle } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps the selection from HOW TO PLAY to SOLO on a down press", async () => {
  await selectTitle(h, TITLE_HOWTO);

  await h.tap("ArrowDown");
  await captureStill(h, "menu");

  const wrapped = await h.snapshot();
  assertEqual(wrapped.screen, "title");
  assertEqual(wrapped.menuIndex, TITLE_SOLO);
});
