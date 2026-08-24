// navigation/pause-escape — Escape on the pause menu resumes the match.
//
// specs/ui.md: on `paused`, `back` resumes to `resumeScreen`, the screen that
// was paused. `Escape` drives both `pause` and `back`, and on the pause menu the
// build must read it as `back`. The match is paused from live play, so the
// screen resumed to is `playing`, and it keeps running after: the ball moves on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ball0, captureStill, createHarness, type Harness } from "../harness";
import { reachPaused } from "./screens";

const AFTER_TICKS = 12; // 0.1 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("resumes the paused match on Escape", async () => {
  await reachPaused(h, "versus");
  const paused = await h.snapshot();

  await h.tap("Escape");
  await captureStill(h, "resumed");
  const resumed = await h.snapshot();
  assertEqual(resumed.screen, "playing");

  await h.advance(AFTER_TICKS);
  const later = ball0(await h.snapshot());
  assertGreaterThan(
    Math.hypot(later.x - ball0(paused).x, later.y - ball0(paused).y),
    0,
  );
});
