// Wick — instrumentation/overlay-toggle: pressing the backtick key shows the
// debug overlay, and pressing it again hides it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Diagnostics": "Drawing the panel, toggling it with the backtick key
// (`KeyboardEvent.code` `Backquote`), and keeping it read-only are the
// engine's." `engine/diagnostics.md`: the panel's last line reads
// `frame: <mean> / <p95> / <p99> ms`, drawn after the pipeline, and the
// engine toggles on an unrepeated `Backquote` keydown at its event target.
// So the panel is read off the frame's draw calls: a `frame: ... ms` line
// is drawn exactly while the overlay is shown.
//
// THE DRIVE. An isolated run, one frame (no panel line), a tap of Backquote
// through the harness's event target (the panel line drawn on that frame),
// a second tap (gone).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

function panelDrawn(): boolean {
  return drawnText(h.lastCalls()).some((line) => PANEL_LINE.test(line));
}

it("shows the overlay on one press and hides it on the next", async () => {
  isolate(h);
  await h.frameDraw();
  assertEqual(panelDrawn(), false, "the panel drawn before any press");

  await tap(h, OVERLAY_TOGGLE_CODE);
  const shown = panelDrawn();
  captureStill(h, "shown");
  assertEqual(
    shown,
    true,
    "the panel drawn on the frame after the first Backquote",
  );

  await tap(h, OVERLAY_TOGGLE_CODE);
  assertEqual(
    panelDrawn(),
    false,
    "the panel drawn on the frame after the second Backquote",
  );
});
