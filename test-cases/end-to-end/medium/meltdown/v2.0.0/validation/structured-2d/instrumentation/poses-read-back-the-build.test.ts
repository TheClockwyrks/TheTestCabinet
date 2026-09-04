// Meltdown — instrumentation/poses-read-back-the-build — the selection, the shop hover and
// the held preview read back as they were posed.
//
// WHY THIS IS A POINT. specs/instrumentation.md says the snapshot carries every
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
// point of its own.
//
// THE READING IS TAKEN FROM THE POSE ITSELF, before any frame runs. `snapshot` is
// a pure read of the state (specs/instrumentation.md), so a pose is readable the
// moment it is made — which is what makes this a check of the OPERATION rather
// than of what a frame did to its result.
//
// EVERY POSED VALUE IS DISTINGUISHING. No two fields carry the same number and none
// of them carries a default, so a build that reports one field where another was
// posed, or that reports a constant, reads as the wrong number rather than
// coincidentally right.
//
// AND EACH OF THE THREE CLEARS. `setSelected(null)`, `setHoverShop(null)` and
// `setArmed(null)` are the same operations in their other direction
// (specs/instrumentation.md), so a build that reports a constant is caught by the
// second reading rather than passing on the first.
//
// THE ROTATION IS POSED AFTER THE TYPE IS ARMED, because "arming a second type
// replaces the held one, and the held rotation returns to `0`"
// (specs/building.md): posed the other way round the reading would be of one pose
// clearing another rather than of two poses landing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { quietSite } from "./ground";

/** The tile the held preview is posed on, and the rotation it is held at. */
const PREVIEW_COL = 10;
const PREVIEW_ROW = 20;
const PREVIEW_ROTATION = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the selection, the shop hover and the held preview as posed", async () => {
  startRun(h);
  const site = quietSite(0);
  h.debug.addTower("arc", site.col, site.row, 0);
  const towers = h.snapshot().towers;
  assertEqual(towers.length, 1, "the towers addTower left on the floor");
  const towerId = towers[towers.length - 1].id;

  h.debug.setSelected(towerId);
  assertEqual(h.snapshot().selected, towerId, "setSelected");
  h.debug.setHoverShop("lance");
  assertEqual(h.snapshot().hoverShop, "lance", "setHoverShop");

  h.debug.setArmed("bloom");
  h.debug.setPreview(PREVIEW_COL, PREVIEW_ROW);
  h.debug.setPreviewRotation(PREVIEW_ROTATION);
  const build = h.snapshot().build;
  assertNotNull(build, "build, after setArmed");
  if (build !== null) {
    assertEqual(build.type, "bloom", "setArmed");
    assertEqual(build.col, PREVIEW_COL, "setPreview: col");
    assertEqual(build.row, PREVIEW_ROW, "setPreview: row");
    assertEqual(build.rotation, PREVIEW_ROTATION, "setPreviewRotation");
  }

  await h.advance(1);
  captureStill(h, "posed");

  // And each of the three clears the way the specification says it does.
  h.debug.setSelected(null);
  h.debug.setHoverShop(null);
  h.debug.setArmed(null);
  const cleared = h.snapshot();
  assertEqual(cleared.selected, null, "setSelected(null)");
  assertEqual(cleared.hoverShop, null, "setHoverShop(null)");
  assertEqual(cleared.build, null, "setArmed(null) clears the preview");
});
