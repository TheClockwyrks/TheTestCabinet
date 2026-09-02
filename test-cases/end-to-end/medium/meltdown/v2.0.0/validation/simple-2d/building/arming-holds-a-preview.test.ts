// building/arming-holds-a-preview — arming a type holds a preview, and disarming
// clears it.
//
// specs/building.md, Arming a type: "Arming a type holds a build preview. A held
// preview carries four things: the type held, the footprint's top-left tile, the
// rotation it is held at, and whether that footprint could be placed right now.
// Disarming clears the preview entirely."
//
// WHAT IS DECIDED HERE IS THE SHAPE OF WHAT ARMING HOLDS, and nothing about where
// it sits. The specification fixes the footprint's position relative to the
// POINTER, which `building/preview-follows-the-pointer` decides, so this check
// requires only that the footprint reported is a real footprint — a whole-number
// top-left with the whole of the held type's block on the grid — that the
// rotation is one of the four steps, and that the validity is a boolean. A build
// that arms with its own idea of a starting footprint is conformant, and passes.
//
// The second half is the one a build commonly gets wrong: `setArmed(null)` has to
// clear the preview ENTIRELY, so `build` is null rather than a preview carrying a
// null type or a stale footprint.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, ROWS } from "../constants";
import {
  assertBetween,
  assertContains,
  assertEqual,
  assertHasProperty,
  assertNull,
  assertTrue,
} from "../assert";
import { sizeOf } from "../geometry";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { heldPreview } from "./preview";

/** The type armed. An Arc is 2x2 and costs 15, so a run opens able to afford it. */
const HELD = "arc";

/** The four rotation steps specs/towers.md fixes, and the only ones. */
const ROTATIONS = [0, 1, 2, 3];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds a preview while a type is armed and clears it when disarmed", async () => {
  startRun(h);

  h.debug.setArmed(HELD);
  const build = heldPreview(h);

  // The frame that draws the held preview, kept as the item's evidence.
  await h.advance(1);
  captureStill(h, "armed");

  assertHasProperty(build, "type", "the held preview's members");
  assertHasProperty(build, "col", "the held preview's members");
  assertHasProperty(build, "row", "the held preview's members");
  assertHasProperty(build, "rotation", "the held preview's members");
  assertHasProperty(build, "valid", "the held preview's members");

  assertEqual(build.type, HELD, "the type held");

  const size = sizeOf(HELD);
  assertTrue(Number.isInteger(build.col), "the footprint's top-left column");
  assertTrue(Number.isInteger(build.row), "the footprint's top-left row");
  assertBetween(build.col, 0, COLS - size, "the footprint's top-left column");
  assertBetween(build.row, 0, ROWS - size, "the footprint's top-left row");

  assertContains(ROTATIONS, build.rotation, "the rotation it is held at");
  assertContains([true, false], build.valid, "whether it could be placed");

  h.debug.setArmed(null);
  assertNull(h.snapshot().build, "the preview after disarming");
});
