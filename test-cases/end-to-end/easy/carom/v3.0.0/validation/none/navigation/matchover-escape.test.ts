// navigation/matchover-escape — Escape on the match-over screen returns to the
// title.
//
// specs/ui.md: on `matchover`, `back` returns to the title, restoring every
// declared field to its title value — `screen = title`, both scores 0, `winner`
// null — and restoring `menuIndex` from `titleIndex`. `Escape` raises both
// `pause` and `back` on one frame, and `matchover` reads `back` alone, so one
// press must land the game on the title.
//
// The finished match is posed rather than played out: what is graded here is the
// key, and driving eleven real points to reach the screen would fail this point
// whenever the scoring was broken. No title item was ever confirmed on the way,
// so `titleIndex` is still the `0` a fresh title carries and the `menuIndex` read
// back is `0` — the figure the review item names.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { reachMatchover } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title on Escape", async () => {
  await reachMatchover(h, "versus");

  await h.tap("Escape");
  await captureStill(h, "title");

  const title = await h.snapshot();
  assertEqual(title.screen, "title");
  assertDeepEqual(title.score, { p1: 0, p2: 0 });
  assertNull(title.winner);
  assertEqual(title.menuIndex, title.titleIndex);
  assertEqual(title.menuIndex, 0);
});
