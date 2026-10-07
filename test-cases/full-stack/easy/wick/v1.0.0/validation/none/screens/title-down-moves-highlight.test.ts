// screens/title-down-moves-highlight — `down` moves the title menu's highlight
// one item down.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`title`"): "`menuIndex` is `0`
// on arriving. `up` and `down` move the highlight by one item and wrap at both
// ends". specs/controls.md ("What each screen reads"), the `title` row: "`up`,
// `down` move the highlight, wrapping", read as press edges.
// specs/controls.md ("Actions and bindings"): "`down` | `ArrowDown`, `KeyS`".
//
// WHY THE WORLD IS POSED AS IS. Nothing is posed. The harness's opening reset
// leaves the game on `title` with `menuIndex` `0`, which is the state the
// requirement is stated over, and the index is read back before the press so
// that a build standing somewhere else fails on the precondition rather than
// on the move. The press is a REAL `ArrowDown` through Chromium's input
// pipeline, held across exactly one frame, which is the whole of the drive:
// nothing else on the title is touched.
//
// THE TOLERANCE. None: an index is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressDown,
  type Harness,
} from "../harness";
import { assertHighlight } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the title highlight from 0 to 1 on ArrowDown", async () => {
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the press is made on");
  assertEqual(title.menuIndex, 0, "menuIndex before the press");

  const after = await pressDown(h);
  await captureStill(h, "down");

  assertHighlight(after, "title", 1, "after ArrowDown on the title");
});
