// Refract — campaign/campaign-starts: choosing CAMPAIGN from the title sets
// mode to campaign and goes to select with a fresh course.
//
// The entry is the player's own, since making the choice is what this point
// decides: CAMPAIGN is `TITLE_ITEMS[0]`, so the title's `menu-0` pointer target
// is pressed and released at its center, which specs/controls.md fixes as "the
// same as `confirm` with `state.menuIndex` at `i`". The pointer rather than a
// key: the title's target ids are the specification's, while the menu's key
// bindings are the build's own, and those get their checks in screens/ where
// the binding is the subject. What a fresh course means is what the check reads
// back: unlockedCount 1 — board 1 open, every other board locked — and no board
// recorded solved.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressRelease,
  resetTo,
  targetById,
  targetCenter,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets mode to campaign and lands on select with a fresh course", async () => {
  await resetTo(h);
  const campaign = targetCenter(targetById(h.snapshot(), "menu-0"));
  await pressRelease(h, campaign);
  captureStill(h, "select");

  const arrived = h.snapshot();
  assertEqual(arrived.mode, "campaign", "choosing CAMPAIGN sets the mode");
  assertEqual(arrived.screen, "select", "choosing CAMPAIGN goes to select");
  assertEqual(
    arrived.unlockedCount,
    1,
    "a fresh course opens with board 1 alone unlocked",
  );
  assertDeepEqual(
    arrived.solvedBoards,
    [],
    "a fresh course records no board solved",
  );
});
