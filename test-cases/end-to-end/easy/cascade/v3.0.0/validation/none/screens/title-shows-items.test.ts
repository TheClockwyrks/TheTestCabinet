// screens/title-shows-items — the title screen draws both of its menu items.
//
// `specs/screens.md`, the `title` screen's element table: Items, `TITLE_ITEMS`,
// "`NEW GAME`, `HOW TO PLAY`, in that order", and below it "Each item's label is
// drawn inside the rectangle `specs/controls.md` fixes for it". This item decides
// that both LABELS are drawn; whether each landed inside its own rectangle is
// `presentation/hud-labels-drawn`'s sibling question for the HUD, and what each
// item DOES is `screens/title-new-game-enters-play` and
// `screens/title-how-to-opens`.
//
// Both labels are asserted here rather than split into two items because the
// requirement is one menu: `specs/screens.md` names them as a single element,
// `TITLE_ITEMS`, and splitting would grade one menu twice.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  type Harness,
} from "../harness";
import { openTitle } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws both title-screen menu items", async () => {
  await openTitle(h);

  const calls = await h.frameCalls();
  await captureStill(h, "title");

  for (const item of TITLE_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `the title screen draws the item "${item}" (specs/screens.md)`,
    );
  }
});
