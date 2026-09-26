// Refract — campaign/campaign-starts: choosing CAMPAIGN from the title enters
// the campaign on a fresh course.
//
// specs/modes/campaign.md: "Choosing CAMPAIGN on the title menu sets state.mode
// to 'campaign' and goes to select", and "A fresh start begins with board 1
// unlocked and nothing solved". The choice is really made, since the choice is
// what this point decides: CAMPAIGN is `TITLE_ITEMS[0]`, so the title's `menu-0`
// pointer target is pressed and released at its center, which specs/controls.md
// fixes as "the same as `confirm` with `state.menuIndex` at `i`". The pointer
// rather than a key: the title's target ids are the specification's, while the
// menu's key bindings are the build's own under this engine, and those get
// their checks in screens/ where the binding is the subject.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressRelease,
  targetById,
  targetCenter,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("enters the campaign on select with a fresh course", async () => {
  const campaign = targetCenter(targetById(await h.snapshot(), "menu-0"));
  await pressRelease(h, campaign);
  await captureStill(h, "select");

  const opened = await h.snapshot();
  assertEqual(opened.mode, "campaign", "choosing CAMPAIGN sets the mode");
  assertEqual(opened.screen, "select", "the campaign opens on select");
  assertEqual(
    opened.unlockedCount,
    1,
    "a fresh course starts with board 1 alone unlocked",
  );
  assertDeepEqual(
    opened.solvedBoards,
    [],
    "a fresh course starts with no board recorded solved",
  );
});
