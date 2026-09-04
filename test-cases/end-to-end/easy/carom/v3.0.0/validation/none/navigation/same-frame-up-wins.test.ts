// navigation/same-frame-up-wins — a frame carrying both an up edge and a down
// edge moves up only.
//
// specs/ui.md, at the end of its keyboard section: when several of a menu's
// edges arrive on one frame, up is applied before down, so a frame carrying both
// moves up only. A build that reads its edges in the other order plays the same
// until the frame two arrive together, which is why this is its own point rather
// than a clause on `title-up` or `title-down`.
//
// THE SELECTION IS POSED ON THE MIDDLE ITEM, which is what makes the reading
// unambiguous: up alone reaches 0, down alone reaches 2, and both applied in
// turn come back to 1. So the expected 0 can only come from the up edge winning.
//
// Both keys are held before the frame is driven and released after it, so their
// two edges land in ONE input read. `ArrowUp` and `ArrowDown` are the pair
// specs/ui.md binds to `p2-up` and `p2-down`, so one hand's two keys raise the
// two actions this rule is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { TITLE_SOLO, TITLE_VERSUS, selectTitle } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves up only when both edges land on one frame", async () => {
  await selectTitle(h, TITLE_VERSUS);

  await h.hold("ArrowUp");
  await h.hold("ArrowDown");
  await h.advance(1);
  await h.release("ArrowUp");
  await h.release("ArrowDown");
  await captureStill(h, "menu");

  const moved = await h.snapshot();
  assertEqual(moved.screen, "title");
  assertEqual(moved.menuIndex, TITLE_SOLO);
});
