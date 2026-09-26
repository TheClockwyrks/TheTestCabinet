// screens/dawn-up-moves-highlight — `up` moves the dawn screen's menu
// highlight one item up.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`fallen` and `dawn`"):
// "`menuIndex` is `0` on arriving. `up` and `down` move the highlight and wrap,
// and `confirm` takes the highlighted item", over "Menu | `END_ITEMS`: `TRY
// AGAIN`, `TITLE`, in that order." specs/controls.md ("What each screen
// reads"), the `fallen`, `dawn` row: "`up`, `down` move the highlight,
// wrapping at both ends", read as press edges.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night ended at dawn: specs/world.md ("Fallen and dawn") ends a run "at the end of a tick, after
// every other phase of that tick has been applied", at dawn when "`tick` equals
// `DAWN_TIME x TICK_HZ` (`36000`)",
// which this reaches through the clock posed to `MAX_POSED_TICK` (`35999`), the greatest `setTick`
// accepts, and the tick that reaches `36000`. The surface carries no pose for
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
import { assertHighlight, endDawn, night } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the dawn menu highlight from 1 to 0 on ArrowUp", async () => {
  await night(h);
  await endDawn(h);
  const posed = await pressDown(h);
  assertEqual(
    posed.menuIndex,
    1,
    "menuIndex before the press, posed by one ArrowDown",
  );

  const after = await pressUp(h);
  await captureStill(h, "up");

  assertHighlight(after, "dawn", 0, "after ArrowUp on the dawn screen");
});
