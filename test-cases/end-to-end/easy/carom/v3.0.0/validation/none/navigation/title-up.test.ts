// navigation/title-up — one up press moves the title selection from HOW TO PLAY
// to VERSUS.
//
// specs/ui.md: on the title, `p1-up` or `p2-up` moves `menuIndex` up one. The
// ground is posed — the title with `menuIndex` at 2 — and one real `ArrowUp` is
// pressed through Chromium's own input pipeline.
//
// The selection is POSED on the last item rather than walked to with two down
// presses, so a build whose down edge is broken fails `title-down` and still has
// this point graded on the edge it is about.
//
// The snapshot reports `menuIndex`, so what the press moved is read straight off
// it. Confirming to see which entry was taken would grade the confirm as well,
// and that is `title-versus`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { TITLE_HOWTO, TITLE_VERSUS, selectTitle } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the selection to VERSUS with one up press", async () => {
  await selectTitle(h, TITLE_HOWTO);

  await h.tap("ArrowUp");
  await captureStill(h, "menu");

  const moved = await h.snapshot();
  assertEqual(moved.screen, "title");
  assertEqual(moved.menuIndex, TITLE_VERSUS);
});
