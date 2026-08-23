// Carom — hud/score-p2: player two's score is drawn right of center.
//
// During a match the two scores are drawn, player one's left of the field's
// center and player two's right of it (specs/overview.md); where and how is the
// build's. So the scores are posed at 7-9 through `setScore` and a frame of the
// live match is rendered, and the frame's text draws are read back, each placed
// in logical units through the transform and alignment the build drew it with.
// The digit must be drawn as a run of its own — a label around it is fine, a
// second digit in the same run is not — with the run's midpoint on its side of
// the field's center.

import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CX } from "../../src/constants";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
  startPlaying,
  type Harness,
} from "../harness";

const P1_SCORE = 7;
const P2_SCORE = 9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws player two's score right of the field's center", async () => {
  await startPlaying(h, "versus");
  h.debug.setScore(P1_SCORE, P2_SCORE);
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "hud");

  expect(h.snapshot().score).toEqual({ p1: P1_SCORE, p2: P2_SCORE });
  const runs = drawnTextSpans(h).filter(
    (span) => span.text.replace(/\D/g, "") === String(P2_SCORE),
  );
  expect(runs.length).toBeGreaterThan(0);
  expect(runs.some((span) => (span.left + span.right) / 2 > FIELD_CX)).toBe(
    true,
  );
});
