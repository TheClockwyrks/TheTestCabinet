// navigation/pause-resume — confirming RESUME on the pause menu resumes the
// match.
//
// specs/ui.md: on `paused`, `confirm` on `RESUME` sets `screen = resumeScreen`.
// The pause menu is posed over an EMPTIED field with `reachPaused`, which sets
// `resumeScreen = playing` and `menuIndex = 0` — what a `pause` edge sets — so
// the first entry is the one this confirm acts on, and it is confirmed with a
// real `Enter` pressed through Chromium's own input pipeline.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { reachPaused } from "./screens";

/** The pause menu's first entry (specs/ui.md, `PAUSE_ITEMS`). */
const RESUME = PAUSE_ITEMS.indexOf("RESUME");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("resumes the paused match on RESUME", async () => {
  await reachPaused(h, "versus");
  const paused = await h.snapshot();
  assertEqual(paused.menuIndex, RESUME);
  assertEqual(paused.resumeScreen, "playing");

  await h.tap("Enter");
  await captureStill(h, "resumed");

  const resumed = await h.snapshot();
  assertEqual(resumed.screen, paused.resumeScreen);
  assertEqual(resumed.screen, "playing");
});
