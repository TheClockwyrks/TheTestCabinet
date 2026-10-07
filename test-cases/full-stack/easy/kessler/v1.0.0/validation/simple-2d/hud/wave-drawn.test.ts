// hud/wave-drawn — a frame of the playing screen draws the number of the wave
// in play.
//
// specs/screens.md, the HUD table: "Wave — The number of the wave in play",
// drawn "on `playing`". The spec fixes no glyphs or layout for it, so the
// reading is differential: two frames of the same posed scene that differ
// only in the posed wave must render differently, because a readout that
// draws the wave's number has different numbers to draw. Frame-to-frame
// animation is subtracted with a same-value baseline pair.
//
// setWave also rewrites the ring speeds from the wave formulas, but the field
// is isolated — no targets, no balls, no pods — so a ring's speed changes
// nothing any frame draws, and only the readout can answer.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { assertReadoutChanged, readFrame } from "./readouts";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the number of the wave in play", async () => {
  isolate(h);
  h.debug.setWave(2);
  const base = await readFrame(h);
  const again = await readFrame(h);

  h.debug.setWave(7);
  const changed = await readFrame(h);
  captureStill(h, "wave");

  assertReadoutChanged(
    base,
    again,
    changed,
    null,
    "a playing frame drawing the number of the wave in play (the readout follows the posed wave, 2 then 7)",
  );
});
