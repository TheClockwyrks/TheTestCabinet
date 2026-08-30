// cascade/hud-tier — the tier is on screen while playing.
//
// specs/modes/cascade.md "The count": during playing, show "the current tier
// beside HUD_TIER_LABEL (TIER)", sitting "clear of the board, whose extent is
// given in specs/board.md". The reading is a fresh sequence's first board: the
// frame's text draws must carry the label with the current tier's digit —
// whatever the snapshot reports it as — beside it (in the label's own run or
// in a digits run anchored within readouts.ts's adjacency), with both anchors
// outside the largest board's extent widened by NODE_R (constants.ts
// BOARD_EXTENT).
//
// The frame's text is read as COALESCED RUNS rather than as raw `fillText`
// calls, because a build is free to letter-space its HUD and canvas has no
// portable property for it, so tracked copy is drawn a glyph at a time.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HUD_TIER_LABEL } from "../constants";
import {
  captureStill,
  createHarness,
  drawnTextRuns,
  startCascade,
  type Harness,
} from "../harness";
import { findReadouts, outsideBoardExtent } from "./readouts";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws TIER with the current tier's digit beside it, clear of the board's extent", async () => {
  await startCascade(h);
  const playing = await h.snapshot();
  assertEqual(playing.screen, "playing", "precondition: a board in play");

  const calls = await h.frameCalls();
  await captureStill(h, "hud");

  const readouts = findReadouts(
    drawnTextRuns(calls),
    HUD_TIER_LABEL,
    playing.tier,
  ).filter(
    (readout) =>
      outsideBoardExtent(readout.label) && outsideBoardExtent(readout.value),
  );
  assertGreaterThan(
    readouts.length,
    0,
    `a ${HUD_TIER_LABEL} readout of ${playing.tier}, clear of the board's extent`,
  );
});
