// instrumentation/overlay-toggle — pressing the backtick key shows the debug
// overlay, and pressing it again hides it.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md (Diagnostics):
// "Drawing the panel, toggling it with the backtick key (`KeyboardEvent.code`
// `Backquote`), and keeping it read-only are the engine's". The engine's own
// diagnostics documentation has the panel drawn as text after the game's
// render.
//
// HOW IT IS READ. The panel is text over the frame, so showing it must ADD
// drawn text and hiding it must take that contribution away. The scene is an
// isolated run paused through the surface, so nothing changes between frames
// and the three frames differ by the panel alone. Shown is read as strictly
// more text than the baseline; hidden as the baseline's own lines again, with
// the panel's gone. What the panel says is `overlay-sources`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  minusLines,
  pressToggle,
  type Harness,
} from "../harness";
import { frameText } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shows on the first press and hides on the second", async () => {
  isolate(h);
  h.debug.setScreen("paused");
  const before = await frameText(h);

  await pressToggle(h);
  const shown = await frameText(h);
  captureStill(h, "shown");
  assertGreaterThan(
    shown.length,
    before.length,
    "text drawn with the overlay shown",
  );

  await pressToggle(h);
  const hidden = await frameText(h);
  assertEqual(
    hidden.length,
    before.length,
    "text drawn after the second press",
  );
  assertEqual(
    minusLines(hidden, before).length,
    0,
    "panel lines left after hiding",
  );
});
