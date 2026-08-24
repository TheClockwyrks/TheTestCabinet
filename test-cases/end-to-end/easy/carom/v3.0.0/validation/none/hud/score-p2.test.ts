// hud/score-p2 — player two's score is drawn, right of center.
//
// specs/overview.md: during a match the two scores are drawn near the top of the
// field, player two's right of center. The scores are posed at 7-9 through the
// surface, so the two numbers are distinct and neither is the 0 a fresh match
// draws everywhere, and the next frame's text is read: a run whose digits are
// exactly `9`, anchored right of `FIELD_CX`. The anchor is mapped through
// whatever transform the build drew under (`textDraws`), so a HUD drawn at a
// translated origin reads the same as one drawn in field coordinates.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { FIELD_CX } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  textDraws,
  type Harness,
} from "../harness";

const SCORE = { p1: 7, p2: 9 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws player two's score right of center", async () => {
  await startPlaying(h, "versus");
  await h.debug.setScore(SCORE.p1, SCORE.p2);

  const calls = await h.frameCalls();
  await captureStill(h, "hud");

  const runs = textDraws(calls).filter(
    (run) => run.text.replace(/\D/g, "") === String(SCORE.p2),
  );
  assertGreaterThan(runs.length, 0);
  assertEqual(
    runs.some((run) => run.x > FIELD_CX),
    true,
  );
});
