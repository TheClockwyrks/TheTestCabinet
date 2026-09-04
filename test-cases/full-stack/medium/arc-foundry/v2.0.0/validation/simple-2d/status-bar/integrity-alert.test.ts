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
// WHERE THE READ IS SAMPLED. Where the build drew it. `specs/hud.md` leaves every
// read's rectangle to the build, so `specs/instrumentation.md` has the build report
// each one through `statusReadouts`, and the sampling is the reported `integrity`
// rectangle and nothing else. A build that animates its Charge read, or that draws
// its wave read on a pulse, moves nothing this check reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  changedPoints,
  createHarness,
  DISTINCT,
  type Harness,
  lattice,
  maxDistance,
  openYard,
  sample,
  statusReadout,
} from "../harness";
import { INTEGRITY_ALERT } from "../constants";

/** The crossing, and a control that redraws the same digit ten above it. */
const CROSSING = [INTEGRITY_ALERT + 1, INTEGRITY_ALERT] as const;
const CONTROL = [INTEGRITY_ALERT + 11, INTEGRITY_ALERT + 10] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the Grid Integrity read differently at five and below", async () => {
  openYard(h, { charge: 473 });

  // The Grid Integrity read's own rectangle, as the build reported it.
  const read = statusReadout(h, "integrity");
  assertGreaterThan(
    read.w * read.h,
    0,
    "the area of the rectangle the build reports for its Grid Integrity read " +
      "(specs/instrumentation.md)",
  );
  const reads = lattice({ x: read.x, y: read.y, w: read.w, h: read.h }, 2);

  const readAt = async (integrity: number) => {
    h.debug.setIntegrity(integrity);
    return sample(h, reads);
  };

  const atSixteen = await readAt(CONTROL[0]);
  const atFifteen = await readAt(CONTROL[1]);
  const atSix = await readAt(CROSSING[0]);
  const atFive = await readAt(CROSSING[1]);
  captureStill(h, "alert");

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
