// screens/fallen-up-moves-highlight — `up` moves the fallen screen's menu
// highlight one item up.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`fallen` and `dawn`"):
// "`menuIndex` is `0` on arriving. `up` and `down` move the highlight and wrap,
// and `confirm` takes the highlighted item", over "Menu | `END_ITEMS`: `TRY
// AGAIN`, `TITLE`, in that order." specs/controls.md ("What each screen
// reads"), the `fallen`, `dawn` row: "`up`, `down` move the highlight,
// wrapping at both ends", read as press edges.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night ended at fallen: specs/world.md ("Fallen and dawn") ends a run "at the end of a tick, after
// every other phase of that tick has been applied", fallen when "`hp` is `0`
// or below",
// which this reaches through the health posed to `0` through `setHp`, whose "value at or below
// `0` ends the run fallen at the end of the next `playing` tick"
// (specs/instrumentation.md), and the tick that ends it. The surface carries no pose for
// `menuIndex`, so the second item is reached the only way it can be: one
// `ArrowDown`, with the index read back before the `ArrowUp` so that a build
// whose `down` is broken fails on the precondition rather than passing on a
// press that wrapped from `0`. Each press is a REAL key held across exactly one
// frame.
//
// THE TOLERANCE. None: an index is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressDown,
  pressUp,
  type Harness,
} from "../harness";
import { assertHighlight, endFallen, night } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the fallen menu highlight from 1 to 0 on ArrowUp", async () => {
  await night(h);
  await endFallen(h);
  const posed = await pressDown(h);
  assertEqual(
    posed.menuIndex,
    1,
    "menuIndex before the press, posed by one ArrowDown",
  );

  const after = await pressUp(h);
  await captureStill(h, "up");

  assertHighlight(after, "fallen", 0, "after ArrowUp on the fallen screen");
});
