// Refract — campaign/campaign-starts: choosing CAMPAIGN from the title enters
// the campaign on a fresh course.
//
// specs/modes/campaign.md: "Choosing CAMPAIGN on the title menu sets state.mode
// to 'campaign' and goes to select", and "A fresh start begins with board 1
// unlocked and nothing solved". The choice is posed through the surface's
// `startMode`, which specs/instrumentation.md defines as acting "exactly as
// choosing its menu item does" — the title menu's own key bindings are the
// build's under this engine, and they get their checks in screens/, where the
// binding is the subject.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCampaign,
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
  await startCampaign(h);
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
