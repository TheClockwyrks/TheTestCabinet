// status-bar/speed-reads-its-value — the speed control draws the multiplier it is on.
//
// `specs/hud.md`: the speed, pause, and mute controls "each read their own
// current value rather than merely being clickable, so what the bar draws changes
// when the value changes". `specs/instrumentation.md` adds that a control's
// reported rectangle is its real region and that its `state` and what it draws
// agree.
//
// So the multiplier is posed at each end of the cycle `specs/controls.md` fixes,
// `1` and `8`, and the pixels inside the rectangle the control reports are held
// against each other. The rectangle is read once and sampled at both multipliers,
// so what is compared is the same region of the stage rather than two regions a
// build happened to move.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  DISTINCT,
  type Harness,
  lattice,
  maxDistance,
  openYard,
  sample,
  statusControl,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the speed control differently at 1 and at 8", async () => {
  await openYard(h, { speed: 1 });

  const control = await statusControl(h, "speed");
  const inside = lattice(control, 1);

  const slow = await sample(h, inside);

  await h.debug.setSpeed(8);
  const fast = await sample(h, inside);
  await captureStill(h, "speed");

  assertGreaterThan(
    maxDistance(slow, fast),
    DISTINCT,
    "how far the speed control's pixels move between multiplier 1 and 8, in " +
      "RGB distance",
  );
});
