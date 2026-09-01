// screens/title-shows-items — the title screen draws both of its items.
//
// specs/screens.md fixes the title screen's menu as `TITLE_ITEMS`, "`NEW GAME`,
// `HOW TO PLAY`, in that order", and each item's label "is drawn inside the
// rectangle `specs/controls.md` fixes for it". A player who cannot see the two
// items has no way of knowing the screen answers a press at all, whatever the
// press then does.
//
// BOTH LITERALS, ONE POINT. The two are the one requirement — the title screen
// carries its menu — and splitting them would grade one menu twice. What each
// item DOES is `screens/title-new-game-enters-play` and
// `screens/title-how-to-opens`, so a build that draws both and answers neither
// grades apart from one that draws neither.
//
// The literals are read from `src/constants.ts`, which the case seeded. Matching
// is by substring over the frame's own draw calls and ignores case, because a
// menu entry is commonly drawn with padding or a marker beside it.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drewText,
  resetTo,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws both TITLE_ITEMS on the title screen", async () => {
  resetTo(h);
  assertEqual(
    h.snapshot().screen,
    "title",
    "posing: reset restores the title screen, which is the screen this point " +
      "reads (specs/instrumentation.md)",
  );

  const calls = await h.drawFrame();
  captureStill(h, "title");

  for (const item of TITLE_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `the title screen's frame to draw the ${JSON.stringify(item)} item of ` +
        "TITLE_ITEMS (specs/screens.md)",
    );
  }
});
