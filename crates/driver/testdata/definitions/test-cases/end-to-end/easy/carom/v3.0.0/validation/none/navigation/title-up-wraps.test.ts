// navigation/title-up-wraps — one up press on the first title item wraps to the
// last.
//
// specs/ui.md: on the title, `p1-up` or `p2-up` moves `menuIndex` up one,
// wrapping from 0 to the last item. The selection is posed on the first item —
// where `reset` leaves it — and one real `ArrowUp` is pressed from there.
//
// The snapshot reports `menuIndex`, so the wrapped selection is read straight off
// it rather than inferred by confirming, which would also grade the confirm.

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

it("wraps the selection from SOLO to HOW TO PLAY on an up press", async () => {
  await selectTitle(h, TITLE_SOLO);

  await h.tap("ArrowUp");
  await captureStill(h, "menu");

  const wrapped = await h.snapshot();
  assertEqual(wrapped.screen, "title");
  assertEqual(wrapped.menuIndex, TITLE_HOWTO);
});
