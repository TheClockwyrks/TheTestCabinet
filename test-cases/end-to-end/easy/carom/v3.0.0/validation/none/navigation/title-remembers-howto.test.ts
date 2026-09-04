// navigation/title-remembers-howto — the title comes back on HOW TO PLAY after
// the how-to screen.
//
// specs/ui.md, "The remembered title selection": confirming an item on the title
// menu sets `titleIndex` to that item's index. And "Returning to the title":
// leaving the how-to screen restores `menuIndex` from `titleIndex`. So a round
// trip through the how-to screen ends on the entry that opened it — `HOW TO
// PLAY`, the third of `TITLE_ITEMS`.
//
// BOTH HALVES ARE READ, because only the pair tells the requirement apart from a
// build that never remembers anything: `titleIndex` on the how-to screen, which
// is what the confirm remembered, and `menuIndex` on the title, which is what the
// return restored. The figures are `2` and `2`, and a fresh title carries `0` for
// both, so neither reading is one a build gets for free.
//
// Two real keys, and they are the two this point is about: the `Enter` that
// confirms the entry and the `Escape` that leaves the screen. The selection is
// POSED onto `HOW TO PLAY` rather than walked down to, because the arrow edges
// are `title-down`'s point. `navigation/howto-back` grades the return itself over
// a how-to screen posed with nothing confirmed, and reads back the `0` this point
// deliberately moves off.
//
// Nothing on the field is posed or removed: specs/ui.md advances nothing on the
// title and nothing on `howto`, so no ball and no obstacle can move under this
// round trip. No paddle is taken: a menu is not driven through one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { TITLE_HOWTO, selectTitle } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title on HOW TO PLAY", async () => {
  await selectTitle(h, TITLE_HOWTO);
  assertEqual((await h.snapshot()).titleIndex, 0);

  await h.tap("Enter");
  const opened = await h.snapshot();
  assertEqual(opened.screen, "howto");
  assertEqual(opened.titleIndex, TITLE_HOWTO);

  await h.tap("Escape");
  await captureStill(h, "title");

  const title = await h.snapshot();
  assertEqual(title.screen, "title");
  assertEqual(title.titleIndex, TITLE_HOWTO);
  assertEqual(title.menuIndex, TITLE_HOWTO);
});
