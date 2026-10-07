// controls/space-confirms — Space accepts the highlighted menu entry.
//
// WHAT THIS DECIDES. One thing: `Space`, the second key of `confirm`, takes
// the highlighted title entry exactly as `Enter` does. `Enter` itself is the
// screens' business, and what the fresh run it begins holds is the fresh-run
// point's; this point reads the screen the press left and nothing else.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "`confirm` | `Enter`, `Space`
//   | edge | accepts the highlighted item", and "The two keys bound to an
//   action are interchangeable: `KeyW` does exactly what `ArrowUp` does
//   wherever `up` is read."
//   specs/controls.md ("What each screen reads"): on `title`, "`confirm`
//   takes the highlighted item".
//   specs/ui.md ("`title`"): "`menuIndex` is `0` on arriving", and
//   "`LIGHT THE LAMP` | Starts a fresh run, defined below, and sets
//   `screen = playing`."
//
// THE DRIVE. `reset` puts the game on the title with `menuIndex` `0`, so
// LIGHT THE LAMP is the highlighted entry without any key having moved the
// highlight; the precondition is read back before the press. The press is a
// REAL `Space` dispatched at the engine's own input seam and delivered by one
// frame, so the registered binding, the edge, and the build's reading of it
// against the title are all on the path. Nothing else is touched: the title
// is the screen this action is read on, and no run is posed.
//
// THE TOLERANCE. None: a screen name is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, tap, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the game on playing after Space is pressed on the title", async () => {
  h.reset();
  const title = h.snapshot();
  assertEqual(title.screen, "title", "the screen the press is made from");
  assertEqual(title.menuIndex, 0, "the highlighted entry before the press");

  const after = await tap(h, "Space");
  captureStill(h, "space");

  assertEqual(after.screen, "playing", "the screen after Space on the title");
});
