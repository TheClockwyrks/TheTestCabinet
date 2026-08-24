// navigation/title-solo — confirming SOLO starts a Solo match.
//
// specs/ui.md: on the title, `confirm` on `SOLO` starts a Solo match, which
// sets `mode`, `screen = countdown`, both scores 0 and `winner` null. The
// confirm is a real Enter key at the title as the game opens, with `menuIndex`
// at 0.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts a Solo match on its countdown", async () => {
  await h.debug.reset();
  await h.tap("Enter");
  await captureStill(h, "countdown");

  const opened = await h.snapshot();
  assertEqual(opened.screen, "countdown");
  assertEqual(opened.mode, "solo");
  assertDeepEqual(opened.score, { p1: 0, p2: 0 });
  assertNull(opened.winner);
});
