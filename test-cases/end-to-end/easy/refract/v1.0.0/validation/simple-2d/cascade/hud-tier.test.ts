// Refract — cascade/hud-tier: the tier is on screen while playing.
//
// specs/modes/cascade.md "The count": during `playing`, show the current tier
// beside the label HUD_TIER_LABEL (TIER), clear of the board, whose extent
// specs/board.md gives. On a fresh cascade the tier is 1 — and the count is
// 0, so the tier's digit cannot be mistaken for it. A playing frame's text
// runs are read back, and one of them must be the label with the current
// tier's digit beside it, the pair clear of the board's extent. The adjacency
// and glyph-band figures are stated in cascade/hud.ts.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HUD_TIER_LABEL } from "../constants";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
  resetTo,
  startCascade,
  type Harness,
} from "../harness";
import { assertClearOfBoard, findLabelWithFigure } from "./hud";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws TIER with the current tier's digit beside it, clear of the board", async () => {
  await resetTo(h, 1);
  await startCascade(h);
  const tier = h.snapshot().tier;
  assertEqual(tier, 1, "a fresh cascade plays at tier 1 (precondition)");

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "hud");

  const found = findLabelWithFigure(
    drawnTextSpans(h),
    HUD_TIER_LABEL,
    tier,
    `a playing frame drawing HUD_TIER_LABEL (${HUD_TIER_LABEL}) with the ` +
      `current tier's digit (${tier}) adjacent (specs/modes/cascade.md: ` +
      "the tier is shown beside the label)",
  );
  assertClearOfBoard(h, found.label, `the ${HUD_TIER_LABEL} label`);
  assertClearOfBoard(h, found.figure, "the tier figure");
});
