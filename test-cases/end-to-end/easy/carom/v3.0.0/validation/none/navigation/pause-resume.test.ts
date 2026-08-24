// navigation/pause-resume — confirming RESUME on the pause menu resumes the
// match.
//
// specs/ui.md: on `paused`, `confirm` on `RESUME` sets `screen = resumeScreen`,
// and pausing sets `menuIndex = 0`, so the first entry is the one a fresh pause
// menu confirms. The match is paused from live play, so the screen resumed to
// is `playing`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { reachPaused } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("resumes the paused match on RESUME", async () => {
  await reachPaused(h, "versus");

  await h.tap("Enter");
  await captureStill(h, "resumed");

  assertEqual((await h.snapshot()).screen, "playing");
});
