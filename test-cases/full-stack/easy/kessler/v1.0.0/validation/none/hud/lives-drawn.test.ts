// hud/lives-drawn — a frame of the playing screen draws the lives remaining.
//
// specs/screens.md, the HUD table: "Lives — The lives remaining", drawn "on
// `playing`". Unlike the score, the spec does not fix digits — a build may
// draw a counter, a row of icons, or anything else that shows the lives — so
// the reading is differential: two frames of the same posed scene that differ
// only in the posed lives must render differently, because a readout that
// draws the lives remaining has different lives to draw. Frame-to-frame
// animation is subtracted with a same-value baseline pair.
//
// The lives are posed away from the boot value first (5), then changed (2),
// so the readout is shown following the pose rather than a hard-coded start.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { assertReadoutChanged, readFrame } from "./readouts";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the lives remaining", async () => {
  await isolate(h);
  await h.debug.setLives(5);
  const base = await readFrame(h);
  const again = await readFrame(h);

  await h.debug.setLives(2);
  const changed = await readFrame(h);
  await captureStill(h, "lives");

  assertReadoutChanged(
    base,
    again,
    changed,
    null,
    "a playing frame drawing the lives remaining (the readout follows the posed lives, 5 then 2)",
  );
});
