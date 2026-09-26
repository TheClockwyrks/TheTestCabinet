// navigation/pause-quit — confirming QUIT TO MENU on the pause menu returns to
// the title.
//
// specs/ui.md: on `paused`, `confirm` on `QUIT TO MENU` returns to the title,
// which restores every declared field to its title value — `screen = title`, both
// scores 0 — and restores `menuIndex` from `titleIndex`. The score is posed to
// 3-4 first so the return has something to clear.
//
// The pause menu is posed over a live match and `menuIndex` is posed on the third
// entry, which is the ground the review item names; the confirm is a real
// `Enter`. Two arrow presses to walk down to it would fail this point whenever
// the pause menu's movement edge was broken, and that edge is graded on its own.
//
// The title is reached without any title item ever having been confirmed, so
// `titleIndex` is still the `0` a fresh title carries and the `menuIndex` read
// back is `0` — the figure the review item names. Both are read off the snapshot.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { reachPaused } from "./screens";

/** The pause menu's third entry (specs/ui.md, `PAUSE_ITEMS`). */
const QUIT_TO_MENU = PAUSE_ITEMS.indexOf("QUIT TO MENU");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title on QUIT TO MENU", async () => {
  await reachPaused(h, "versus");
  await h.debug.setScore(3, 4);
  await h.debug.setMenuIndex(QUIT_TO_MENU);

  await h.tap("Enter");
  await captureStill(h, "title");

  const title = await h.snapshot();
  assertEqual(title.screen, "title");
  assertDeepEqual(title.score, { p1: 0, p2: 0 });
  assertEqual(title.menuIndex, title.titleIndex);
  assertEqual(title.menuIndex, 0);
});
