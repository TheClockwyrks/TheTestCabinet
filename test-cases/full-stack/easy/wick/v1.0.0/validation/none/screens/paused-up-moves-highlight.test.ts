// screens/paused-up-moves-highlight — `up` moves the pause menu's highlight one
// item up.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`paused`"): "`up` and `down`
// move the highlight and wrap at both ends". specs/controls.md ("What each
// screen reads"), the `paused` row: "`up`, `down` move the highlight,
// wrapping", read as press edges. specs/controls.md ("Actions and bindings"):
// "`up` | `ArrowUp`, `KeyW`".
//
// WHY THE WORLD IS POSED AS IT IS. The night is isolated and paused with a REAL
// `KeyP`, and the surface carries no pose for `menuIndex`, so the second item is
// reached the only way it can be: one `ArrowDown`, read back before the
// `ArrowUp` so that a build whose `down` is broken fails on the precondition
// rather than passing on a press that wrapped from `0`. Each press is a REAL
// key through Chromium's input pipeline held across exactly one frame, and the
// pause ticks nothing, so the frames change nothing but the highlight.
//
// THE TOLERANCE. None: an index is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressDown,
  pressPause,
  pressUp,
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

it("moves the pause menu highlight from 1 to 0 on ArrowUp", async () => {
  await night(h);
  const paused = await pressPause(h);
  assertEqual(paused.screen, "paused", "the screen the press is made on");
  const posed = await pressDown(h);
  assertEqual(
    posed.menuIndex,
    1,
    "menuIndex before the press, posed by one ArrowDown",
  );

  const after = await pressUp(h);
  await captureStill(h, "up");

  assertHighlight(after, "paused", 0, "after ArrowUp on the pause screen");
});
