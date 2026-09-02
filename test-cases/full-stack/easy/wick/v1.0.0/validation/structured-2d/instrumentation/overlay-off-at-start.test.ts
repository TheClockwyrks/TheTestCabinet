// Wick — instrumentation/overlay-off-at-start: a freshly started build draws
// no debug overlay until the backtick key first shows it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Diagnostics": the game "registers the values it reports as diagnostic
// sources", and drawing the panel is the engine's. `engine/diagnostics.md`:
// "The overlay is hidden when the engine is created. The backtick key
// (`Backquote`) toggles it"; the shown panel is a column carrying one
// `<name>: <value>` line per registered source and a `frame: … ms` line.
//
// WHAT IS READ, AND WHY IT IS THE BUILD'S. The detector is the BUILD's own
// registered names, read off `diagnostics()`: a boot frame that labels a line
// with EVERY name in that registry has put the whole panel's worth of readings
// on the screen before anything was pressed, whether it asked the engine for
// the panel or painted a column of its own. Both of the first two frames are
// read that way. The engine's `frame: … ms` line is asserted absent beside it
// as a second signal, never as the only one, so the point is not decided by
// engine chrome alone.
//
// A frame is only forbidden the WHOLE registry, not every labelled line: a
// HUD that writes `hp: 43` is a picture the specification permits, and it is
// the state dump that this point rules out.
//
// THE DRIVE. A fresh harness (the engine just built, the game just
// initialized, nothing pressed) and its first two frames on the title, read
// off the draw calls.
//
// THE TOLERANCE. None: each reading is a set of line labels compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
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

/** Whether `lines` carries a `<name>: …` line for every name in `names`. */
function wholeRegistryDrawn(
  lines: readonly string[],
  names: readonly string[],
): boolean {
  return names.every((name) =>
    lines.some((line) => line.startsWith(`${name}: `)),
  );
}

it("draws no panel on a fresh boot", async () => {
  const first = await h.frameCalls();
  await h.frameDraw();
  captureStill(h, "fresh");
  const second = h.lastCalls();
  const names = [...new Set(h.diagnostics().map((reading) => reading.name))];
  assertGreaterThan(
    names.length,
    0,
    "diagnostic sources the build registered, which the panel is read by",
  );

  assertEqual(
    wholeRegistryDrawn(drawnText(first), names),
    false,
    "every registered reading drawn on the first frame",
  );
  assertEqual(
    wholeRegistryDrawn(drawnText(second), names),
    false,
    "every registered reading drawn on the second frame",
  );
  assertEqual(
    drawnText(first).some((line) => PANEL_LINE.test(line)),
    false,
    "the metrics line on the first frame",
  );
  assertEqual(
    drawnText(second).some((line) => PANEL_LINE.test(line)),
    false,
    "the metrics line on the second frame",
  );
});
