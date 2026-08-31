// hud/score-drawn — a frame of the playing screen draws the posed score in
// digits.
//
// specs/screens.md, the HUD table: "Score — The score, in digits, as
// specs/scoring.md fixes it", drawn "on `playing`". The score is posed to
// 12345 — five distinct digits no other readout of this posed scene can
// produce — and the frame must show them.
//
// The direct reading is the frame's text runs (digit grouping tolerated: the
// runs are compared with every non-digit stripped). A build that paints its
// digits as glyph sprites shows no text run at all, so it is read
// differentially instead: with everything else identical, the frame must
// change when the posed score does. That fallback cannot see WHICH glyphs the
// build drew — as far as the recorded surface reaches, it accepts any readout
// that follows the posed figure.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { assertReadoutChanged, digitsShown, readFrame } from "./readouts";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the posed score", async () => {
  isolate(h);
  h.debug.setScore(12345);
  const base = await readFrame(h);
  const again = await readFrame(h);
  captureStill(h, "score");

  if (digitsShown(again.calls, "12345")) return;

  h.debug.setScore(67890);
  const changed = await readFrame(h);
  assertReadoutChanged(
    base,
    again,
    changed,
    null,
    "a playing frame drawing the posed score (12345 in digits, or a readout that follows the posed figure)",
  );
});
