// navigation/matchover-down — one down press moves the match-over selection from
// PLAY AGAIN to MENU.
//
// specs/ui.md: on `matchover`, `p1-down` or `p2-down` moves `menuIndex` down
// one, exactly as it does on the title and on the pause menu. The screen is
// posed with `reachMatchover`, which sets the winner, the final score and
// `menuIndex = 0` — the entry reaching the screen leaves selected — so the
// ground is reached without playing twenty-two points of a real match.
//
// One real `ArrowDown` is pressed and the snapshot is read back. `screen` is
// read as well as `menuIndex`: a build that treated the arrow as a confirm would
// leave the match-over screen for the title or for a fresh countdown, and
// reading both is what tells that apart from an arrow that did nothing.
//
// The two-item match-over screen carries no wrap point of its own: the title's
// two cover both ends of a wrapping menu, and one down press is the whole of
// what this screen's movement adds.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MATCHOVER_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { reachMatchover } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the match-over selection to MENU with one down press", async () => {
  assertEqual(MATCHOVER_ITEMS[1], "MENU");
  await reachMatchover(h, "versus");

  await h.tap("ArrowDown");
  await captureStill(h, "menu");

  const moved = await h.snapshot();
  assertEqual(moved.screen, "matchover");
  assertEqual(moved.menuIndex, 1);
});
