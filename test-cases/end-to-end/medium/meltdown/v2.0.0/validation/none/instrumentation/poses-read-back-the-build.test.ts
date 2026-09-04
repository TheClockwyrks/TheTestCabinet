// Meltdown — instrumentation/poses-read-back-the-build — the selection, the shop hover and
// the held preview read back as they were posed.
//
// WHY THIS IS A POINT. `specs/instrumentation.md` says the snapshot carries every
// field an operation can set, "so every operation is verifiable by setting a value
// and reading it back". That round trip is what every other group in this suite
// stands on: a check poses a heat of 60 and then asserts what one second of
// cooling did to it, and if the pose never landed the check is measuring something
// it did not arrange. A pose that silently does nothing, or that lands on a field
// the snapshot does not report, is caught here and nowhere else.
//
// ONE GROUP OF STATE, BECAUSE EACH POSE IS INDEPENDENTLY BREAKABLE. A build whose
// only broken pose is `setUnitSlow` must lose one point rather than every pose it
// got right, so the surface's poses are read as six items —
// `instrumentation.poses-read-back-the-run`, `-the-figures`, `-the-build`,
// `-a-tower`, `-a-unit` and `-the-pointer-and-the-gate` — and this one reads
// the five poses a player makes with the build panel.
//
// WHAT IS ASSERTED. That the value POSED comes back. Not what the game does with
// it afterwards, and not that a rule fired: `setLives` triggers no game over,
// `setScore` pays no bonus, `setScreen` runs no entry effect — each of those is a
// point of its own. Every value below is read back on the same frame it was posed,
// before anything has had a chance to run.
//
// EVERY POSED VALUE IS DISTINGUISHING. No two fields carry the same number and none
// of them carries a default, so a build that reports one field where another was
// posed, or that reports a constant, reads as the wrong number rather than
// coincidentally right.
//
// AND EACH OF THE THREE CLEARS. `setSelected(null)`, `setHoverShop(null)` and
// `setArmed(null)` are the same operations in their other direction
// (`specs/instrumentation.md`), so a build that reports a constant is caught by
// the second reading rather than passing on the first.
//
// THE ROTATION IS POSED AFTER THE TYPE IS ARMED, because "arming a second type
// replaces the held one, and the held rotation returns to `0`"
// (`specs/building.md`): posed the other way round the reading would be of one
// pose clearing another rather than of two poses landing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
} from "../harness";

/** The rotation the preview is held at: not `0`, which arming restores. */
const ROTATION = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the selection, the shop hover and the held preview as posed", async () => {
  await startRun(h);
  const site = freeSite(0);
  const id = await poseTower(h, "arc", site.col, site.row);

  await h.debug.setSelected(id);
  await h.debug.setHoverShop("lance");
  await h.debug.setArmed("bloom");
  const preview = freeSite(1);
  await h.debug.setPreview(preview.col, preview.row);
  await h.debug.setPreviewRotation(ROTATION);

  const s = await h.snapshot();
  assertEqual(s.selected, id, "setSelected");
  assertEqual(s.hoverShop, "lance", "setHoverShop");
  assertEqual(s.build?.type, "bloom", "setArmed");
  assertEqual(s.build?.col, preview.col, "setPreview's column");
  assertEqual(s.build?.row, preview.row, "setPreview's row");
  assertEqual(s.build?.rotation, ROTATION, "setPreviewRotation");

  await h.advance(1);
  await captureStill(h, "posed");

  // And each of the three clears the way the specification says it does.
  await h.debug.setSelected(null);
  await h.debug.setHoverShop(null);
  await h.debug.setArmed(null);
  const cleared = await h.snapshot();
  assertEqual(cleared.selected, null, "setSelected(null)");
  assertEqual(cleared.hoverShop, null, "setHoverShop(null)");
  assertEqual(cleared.build, null, "setArmed(null) clears the preview");
});
