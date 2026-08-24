// navigation/title-down — one down press moves the title selection from SOLO to
// VERSUS.
//
// specs/ui.md: on the title, `p1-down` or `p2-down` moves `menuIndex` down one.
// The snapshot does not report `menuIndex`, so the selection is read the way a
// player reads it: after the one press, confirming opens the entry the index
// now names, which from 0 is `VERSUS` at 1.

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

it("moves the selection to VERSUS with one down press", async () => {
  await h.debug.reset();
  await h.tap("ArrowDown");
  await captureStill(h, "menu");
  await h.tap("Enter");

  const opened = await h.snapshot();
  assertEqual(opened.screen, "countdown");
  assertEqual(opened.mode, "versus");
});
