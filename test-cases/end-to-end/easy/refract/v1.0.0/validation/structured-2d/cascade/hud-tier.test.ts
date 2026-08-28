// Refract — cascade/hud-tier: the tier is on screen while playing.
//
// specs/modes/cascade.md "The count": during playing, show the current tier
// beside the label HUD_TIER_LABEL (TIER), clear of the board, whose extent
// specs/board.md gives. A fresh sequence opens at tier 1, and the playing
// frame's text draws are read back: a run carrying the label, a run reading 1
// beside it — within one CELL_PITCH, the spec's own unit of adjacent
// placement, or in the label's own run — and both clear of the current
// board's extent widened by NODE_R. The fresh sequence's other readout reads
// "SOLVED 0", so no other digit on the frame reads 1 by accident.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_TIER_LABEL } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
  startCascade,
  type Harness,
} from "../harness";
import { assertLabeledDigitClear, boardKeepOut } from "./helpers";

const SEED = 1;
/** A fresh sequence opens at tier 1 (specs/modes/cascade.md). */
const OPENING_TIER = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws TIER with the current tier's digit beside it, clear of the board", async () => {
  await startCascade(h, SEED);
  const snapshot = h.snapshot();
  assertEqual(snapshot.screen, "playing", "the fresh sequence is playing");
  assertEqual(
    snapshot.tier,
    OPENING_TIER,
    "the fresh sequence opens at tier 1",
  );

  h.calls.length = 0;
  await h.advance(1);
  // The tier drawn beside its label.
  captureStill(h, "hud");

  assertLabeledDigitClear(
    drawnTextSpans(h),
    HUD_TIER_LABEL,
    OPENING_TIER,
    boardKeepOut(snapshot.board),
  );
});
