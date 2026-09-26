// instrumentation/buildings-report — buildings() reports the six of them.
//
// `specs/instrumentation.md` gives `buildings()` one job: "One entry per surface
// building, `{ id, x, y, w, h }`, with `id` the building's id and `x`, `y`, `w`,
// `h` its footprint in world units." `specs/world.md` names the six and their ids:
// `fuel-depot`, `ore-market`, `save-pad`, `upgrade-shop`, `supply-depot`,
// `launch-pad`.
//
// The reading is a deliverable rather than a convenience: `specs/world.md`
// deliberately leaves where the buildings stand to the build, so this is the only
// way a check can find one to walk to. A build that reported five, or reported
// them under names of its own, leaves every point about the camp's panels unable
// to reach the building it is about.
//
// WHAT IS READ HERE, AND WHAT IS NOT. That there are exactly six entries, that
// their ids are exactly the six the specification names, and that each carries a
// footprint made of four finite numbers with a positive width and height. Where
// those footprints sit — on the ground line, apart from each other, clear of the
// cave mouth — is fixed by `specs/world.md` and read by the camp's own points.

import { afterEach, beforeEach, it } from "vitest";
import { BUILDINGS } from "../constants";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtCamp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports one entry per surface building, with a numeric footprint", async () => {
  openScene(h);
  layCamp(h);
  standAtCamp(h);
  pinDrill(h);
  await h.advance(2);
  captureStill(h, "camp");

  const boxes = h.debug.buildings();
  assertLength(boxes, BUILDINGS.length, "entries buildings() reported");
  assertDeepEqual(
    [...boxes.map((box) => box.id)].sort(),
    [...BUILDINGS].sort(),
    "the ids buildings() reported",
  );

  for (const box of boxes) {
    for (const field of ["x", "y", "w", "h"] as const) {
      assertEqual(
        Number.isFinite(box[field]),
        true,
        `"${box.id}" reporting a numeric ${field}, and got ${String(box[field])}`,
      );
    }
    assertGreaterThan(box.w, 0, `the width of "${box.id}"`);
    assertGreaterThan(box.h, 0, `the height of "${box.id}"`);
  }
});
