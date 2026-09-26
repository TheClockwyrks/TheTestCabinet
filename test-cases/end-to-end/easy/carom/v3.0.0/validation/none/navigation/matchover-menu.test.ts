// navigation/matchover-menu — confirming MENU on the match-over screen returns
// to the title.
//
// specs/ui.md: on `matchover`, `confirm` on `MENU` returns to the title,
// restoring every declared field to its title value — `screen = title`, both
// scores 0, `winner` null — and restoring `menuIndex` from `titleIndex`.
//
// The finished match is posed and `menuIndex` is posed on the second entry, which
// is the ground the review item names; the confirm is a real `Enter`. An arrow
// press to walk down to it would fail this point whenever the match-over menu's
// movement edge was broken, and that edge is graded on its own.
//
// No title item was ever confirmed on the way here, so `titleIndex` is still the
// `0` a fresh title carries and the `menuIndex` read back is `0` — the figure the
// review item names. Both are read off the snapshot.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { MATCHOVER_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { reachMatchover } from "./screens";

/** The match-over menu's second entry (specs/ui.md, `MATCHOVER_ITEMS`). */
const MENU = MATCHOVER_ITEMS.indexOf("MENU");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title on MENU", async () => {
  await reachMatchover(h, "versus");
  await h.debug.setMenuIndex(MENU);

  await h.tap("Enter");
  await captureStill(h, "title");

  const title = await h.snapshot();
  assertEqual(title.screen, "title");
  assertDeepEqual(title.score, { p1: 0, p2: 0 });
  assertNull(title.winner);
  assertEqual(title.menuIndex, title.titleIndex);
  assertEqual(title.menuIndex, 0);
});
