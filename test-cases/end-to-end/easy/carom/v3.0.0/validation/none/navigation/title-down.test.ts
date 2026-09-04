// navigation/title-down — one down press moves the title selection from SOLO to
// VERSUS.
//
// specs/ui.md: on the title, `p1-down` or `p2-down` moves `menuIndex` down one.
// The ground is posed — the title with `menuIndex` at 0 — and one real
// `ArrowDown` is pressed through Chromium's own input pipeline.
//
// The snapshot reports `menuIndex`, so what the press moved is read straight off
// it. Confirming to see which entry was taken would grade the confirm as well,
// and that is `title-versus`'s point.

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

it("moves the selection to VERSUS with one down press", async () => {
  await selectTitle(h, TITLE_SOLO);

  await h.tap("ArrowDown");
  await captureStill(h, "menu");

  const moved = await h.snapshot();
  assertEqual(moved.screen, "title");
  assertEqual(moved.menuIndex, TITLE_VERSUS);
});
