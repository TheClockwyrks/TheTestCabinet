// Wick — instrumentation/overlay-off-at-start: a freshly started build draws
// no debug overlay until the backtick key first shows it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `engine/diagnostics.md`, which
// `specs/instrumentation.md` gives the overlay to: "The overlay is hidden
// when the engine is created. The backtick key (`Backquote`) toggles it";
// the shown panel draws a `frame: ... ms` line after the pipeline. A build
// that toggled the panel on for itself, or drew one of its own, would draw
// that line on its first frames.
//
// THE DRIVE. A fresh harness (the engine just built, the game just
// initialized, nothing pressed) and its first two frames on the title, read
// off the draw calls.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  type Harness,
} from "../harness";

const PANEL_LINE = /^frame: .* ms$/;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws no panel on a fresh boot", async () => {
  const first = await h.frameCalls();
  await h.frameDraw();
  captureStill(h, "fresh");
  const second = h.lastCalls();
  assertEqual(
    drawnText(first).some((line) => PANEL_LINE.test(line)),
    false,
    "the panel drawn on the first frame",
  );
  assertEqual(
    drawnText(second).some((line) => PANEL_LINE.test(line)),
    false,
    "the panel drawn on the second frame",
  );
});
