// screens/paused-down-moves-highlight — `down` moves the pause menu's highlight
// one item down.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`paused`"): "`menuIndex` is `0`
// on arriving. `up` and `down` move the highlight and wrap at both ends".
// specs/controls.md ("What each screen reads"), the `paused` row: "`up`, `down`
// move the highlight, wrapping", read as press edges. specs/controls.md
// ("Actions and bindings"): "`down` | `ArrowDown`, `KeyS`".
//
// WHY THE WORLD IS POSED AS IT IS. The night is isolated and paused with a REAL
// `KeyP` held across one frame, which is the real route onto the screen, and
// the index is read back before the press so that a build arriving on something
// other than `0` fails on the precondition rather than on the move. The press
// is a REAL `ArrowDown` through Chromium's input pipeline held across exactly
// one frame, and the pause ticks nothing, so the frame changes nothing but the
// highlight.
//
// THE TOLERANCE. None: an index is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressDown,
  pressPause,
  type Harness,
} from "../harness";
import { assertHighlight, night } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the pause menu highlight from 0 to 1 on ArrowDown", async () => {
  await night(h);
  const paused = await pressPause(h);
  assertEqual(paused.screen, "paused", "the screen the press is made on");
  assertEqual(paused.menuIndex, 0, "menuIndex before the press");

  const after = await pressDown(h);
  await captureStill(h, "down");

  assertHighlight(after, "paused", 1, "after ArrowDown on the pause screen");
});
