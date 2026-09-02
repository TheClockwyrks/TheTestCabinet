// Wick — instrumentation/overlay-toggle: pressing the backtick key shows the
// debug overlay, and pressing it again hides it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Diagnostics": the game "registers the values it reports as diagnostic
// sources", and "Drawing the panel, toggling it with the backtick key
// (`KeyboardEvent.code` `Backquote`), and keeping it read-only are the
// engine's." `engine/diagnostics.md`: the shown panel is a column of lines,
// one `<name>: <value>` line per registered source, and a last line reading
// `frame: <mean> / <p95> / <p99> ms`; the engine toggles on an unrepeated
// `Backquote` keydown at its event target.
//
// WHAT THE PANEL IS READ BY, AND WHY IT IS THE BUILD'S. The detector is the
// BUILD's own registered names, read off `diagnostics()` — the list the build
// filled and this case fixes nothing about — and the panel counts as drawn on
// a frame when EVERY one of those names labels a line the frame painted. So
// the reading turns on what the build put into the registry the panel draws
// from: a build that registers nothing, registers into a registry the panel
// does not draw, or whose sources throw on the posed night draws no such
// column and fails. The engine's own `frame: … ms` line is asserted beside it
// as a second signal, never as the only one, so the point is not decided by
// engine chrome alone.
//
// The hidden frames are required only to fall SHORT of the whole column, not
// to be free of every labelled line: a HUD that writes `hp: 43` is a picture
// the specification permits, and it is drawing the whole registry every frame
// that overlay-off-at-start forbids.
//
// THE DRIVE. An isolated run, one frame (no panel), a tap of Backquote
// through the harness's event target (the panel on that frame), a second tap
// (gone).
//
// THE TOLERANCE. None: each reading is a set of line labels compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { OVERLAY_TOGGLE_CODE } from "../constants";
import {
  captureStill,
  createHarness,
  drawnText,
  isolate,
  tap,
  type Harness,
} from "../harness";

/** The panel's metrics line, which the engine draws on every shown frame. */
const PANEL_LINE = /^frame: .* ms$/;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The names the build registered with the engine's diagnostics registry. */
function registeredNames(): string[] {
  return [...new Set(h.diagnostics().map((reading) => reading.name))];
}

/** Whether the last frame drew a `<name>: …` line for every name in `names`. */
function wholeRegistryDrawn(names: readonly string[]): boolean {
  const lines = drawnText(h.lastCalls());
  return names.every((name) =>
    lines.some((line) => line.startsWith(`${name}: `)),
  );
}

/** Whether the last frame drew the engine's metrics line. */
function metricsLineDrawn(): boolean {
  return drawnText(h.lastCalls()).some((line) => PANEL_LINE.test(line));
}

it("shows the overlay on one press and hides it on the next", async () => {
  isolate(h);
  await h.frameDraw();
  const names = registeredNames();
  assertGreaterThan(
    names.length,
    0,
    "diagnostic sources the build registered, which the panel is read by",
  );
  assertEqual(
    wholeRegistryDrawn(names),
    false,
    "every registered reading drawn before any press",
  );
  assertEqual(metricsLineDrawn(), false, "the metrics line before any press");

  await tap(h, OVERLAY_TOGGLE_CODE);
  const shown = wholeRegistryDrawn(names);
  captureStill(h, "shown");
  assertEqual(
    shown,
    true,
    "every registered reading drawn on the frame after the first Backquote",
  );
  assertEqual(
    metricsLineDrawn(),
    true,
    "the metrics line on the frame after the first Backquote",
  );

  await tap(h, OVERLAY_TOGGLE_CODE);
  assertEqual(
    wholeRegistryDrawn(names),
    false,
    "every registered reading drawn on the frame after the second Backquote",
  );
  assertEqual(
    metricsLineDrawn(),
    false,
    "the metrics line on the frame after the second Backquote",
  );
});
