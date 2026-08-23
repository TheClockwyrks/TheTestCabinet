// navigation/title-up-wraps — one up press on the first title item wraps to the
// last.
//
// specs/ui.md: on the title, `p1-up` or `p2-up` moves `menuIndex` up one,
// wrapping from 0 to the last item. The snapshot does not report `menuIndex`,
// so the selection is read by confirming: from the wrapped index 2 the entry
// taken is `HOW TO PLAY`.

import { afterEach, beforeEach, expect, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps the selection from SOLO to HOW TO PLAY on an up press", async () => {
  await h.debug.reset();
  await h.tap("ArrowUp");
  await captureStill(h, "menu");
  await h.tap("Enter");

  expect((await h.snapshot()).screen).toBe("howto");
});
