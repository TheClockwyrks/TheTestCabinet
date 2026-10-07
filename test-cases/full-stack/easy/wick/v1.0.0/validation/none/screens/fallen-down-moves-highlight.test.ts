// screens/fallen-down-moves-highlight — `down` moves the fallen screen's menu
// highlight one item down.
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
// (specs/instrumentation.md), and the tick that ends it. The end screen is reached the real way
// rather than posed, and no menu is touched on the road to it, so a build with
// a broken title menu fails the title points and is read here on the screen its
// own run reached. The index is read back before the press, and the press is a
// REAL `ArrowDown` through Chromium's input pipeline held across exactly one
// frame.
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
import { assertHighlight, endFallen, night } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the fallen menu highlight from 0 to 1 on ArrowDown", async () => {
  await night(h);
  const ended = await endFallen(h);
  assertEqual(ended.menuIndex, 0, "menuIndex before the press");

  const after = await pressDown(h);
  await captureStill(h, "down");

  assertHighlight(after, "fallen", 1, "after ArrowDown on the fallen screen");
});
