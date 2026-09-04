// status-bar/integrity-alert — the Grid Integrity read goes to alert at five.
//
// `specs/hud.md`: the Grid Integrity read "reads as an alert once it falls to `5`
// or below", and `INTEGRITY_ALERT` is that `5`.
//
// HOW A DRAWN ALERT IS TOLD FROM A CHANGED DIGIT. Posing `6` and then `5` moves
// the pixels of the read whether or not a build has an alert treatment at all,
// because the digit itself changed. So the drop across the threshold is measured
// against a CONTROL that changes the same digit and crosses nothing: `16` to
// `15`. Both pairs redraw a `6` as a `5` in the same place; only one of them
// crosses `INTEGRITY_ALERT`. A build that draws the read differently in alert
// moves every point the read covers on the crossing — the ink shared by `6` and
// `5` included — and moves only the ink they differ in on the control, so the
// crossing moves strictly more. A build with no alert treatment moves the same
// points either way.
//
// WHERE THE READ IS SAMPLED. `specs/hud.md` orders the bar left to right, with
// the Charge, Grid Integrity, wave, and maze-length reads all left of the combos
// toggle, and `statusControls` reports where that toggle was drawn. So the strip
// of the bar left of it is where the four reads were drawn, and it is sampled
// whole rather than at a rectangle no reading reports.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  statusControl,
  type Harness,
} from "../harness";
import { BAR_H, INTEGRITY_ALERT } from "../constants";
import {
  DISTINCT,
  changedPoints,
  lattice,
  maxDistance,
  sample,
} from "./reading";

/** The crossing, and a control that redraws the same digit ten above it. */
const CROSSING = [INTEGRITY_ALERT + 1, INTEGRITY_ALERT] as const;
const CONTROL = [INTEGRITY_ALERT + 11, INTEGRITY_ALERT + 10] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the Grid Integrity read differently at five and below", async () => {
  await openYard(h, { charge: 473 });

  // Everything left of the first status control: the four reads of specs/hud.md.
  const combos = await statusControl(h, "combos");
  const reads = lattice({ x: 0, y: 0, w: Math.max(combos.x, 1), h: BAR_H }, 2);

  const readAt = async (integrity: number) => {
    await h.debug.setIntegrity(integrity);
    return sample(h, reads);
  };

  const atSixteen = await readAt(CONTROL[0]);
  const atFifteen = await readAt(CONTROL[1]);
  const atSix = await readAt(CROSSING[0]);
  const atFive = await readAt(CROSSING[1]);
  await captureStill(h, "alert");

  assertGreaterThan(
    maxDistance(atSix, atFive),
    DISTINCT,
    "how far the Grid Integrity read moves between 6 and 5, in RGB distance",
  );
  assertGreaterThan(
    changedPoints(atSix, atFive),
    changedPoints(atSixteen, atFifteen),
    "how many sampled points the drop into alert moves, against the same " +
      "digit redrawn ten above the threshold",
  );
});
