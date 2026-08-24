// navigation/title-down-wraps — one down press on the last title item wraps to
// the first.
//
// specs/ui.md: on the title, `p1-down` or `p2-down` moves `menuIndex` down one,
// wrapping from the last item to 0. Two down presses reach the last item (the
// sibling `title-howto` reads that); the third is the wrap. The snapshot does
// not report `menuIndex`, so the selection is read by confirming: from the
// wrapped index 0 the entry taken is `SOLO`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps the selection from HOW TO PLAY to SOLO on a down press", async () => {
  await h.debug.reset();
  await h.tap("ArrowDown"); // SOLO -> VERSUS
  await h.tap("ArrowDown"); // VERSUS -> HOW TO PLAY
  await h.tap("ArrowDown"); // HOW TO PLAY -> SOLO
  await captureStill(h, "menu");
  await h.tap("Enter");

  const opened = await h.snapshot();
  assertEqual(opened.screen, "countdown");
  assertEqual(opened.mode, "solo");
});
