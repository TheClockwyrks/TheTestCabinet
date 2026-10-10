// navigation/same-frame-move-before-confirm — a frame carrying a movement edge
// and a confirm edge moves only.
//
// specs/ui.md, at the end of its keyboard section: when several of a menu's
// edges arrive on one frame, movement is applied before `confirm`, and a frame
// carrying both moves only. So the title has to still be showing afterwards, on
// the entry the movement reached.
//
// Reading both halves is the point. `menuIndex` at 1 says the movement was
// applied; `screen` still `title` says the confirm on that same frame was not.
// A build that confirmed first would have opened a Solo countdown from
// `menuIndex` 0, and one that applied both would be on VERSUS's countdown —
// neither of which passes.
//
// Both keys are held before the frame is driven and released after it, so their
// two edges land in ONE input read.

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

it("moves the selection and confirms nothing when both edges land on one frame", async () => {
  await selectTitle(h, TITLE_SOLO);

  await h.hold("ArrowDown");
  await h.hold("Enter");
  await h.advance(1);
  await h.release("ArrowDown");
  await h.release("Enter");
  await captureStill(h, "menu");

  const moved = await h.snapshot();
  assertEqual(moved.screen, "title");
  assertEqual(moved.menuIndex, TITLE_VERSUS);
});
