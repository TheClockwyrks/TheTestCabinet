// presentation/overlay-hides-on-backquote — the backtick key hides the debug
// overlay.
//
// THE RULE. `specs/controls.md`, The debug overlay: "The read-only debug overlay
// `specs/instrumentation.md` describes is shown and hidden by the backtick key,
// `KeyboardEvent.code` `Backquote`." `specs/instrumentation.md` says the same of
// the panel the build writes: "it is shown and hidden by the key
// `specs/controls.md` names".
//
// SCOPED TO THIS ENGINE, because under the other two the panel and its key are
// the engine's: the build registers sources and the engine draws and toggles the
// panel, so an item on the key could not fail on all three. Here the whole
// runtime layer is the build's.
//
// ONE END OF THE TOGGLE, ONE POINT. `presentation/overlay-shows-on-backquote` is
// the other: a key that shows a panel and cannot hide it again leaves a player
// looking at a panel over the game they were playing, which is a different defect
// from a key that never showed one, and bundled the two would score the same.
//
// HOW THE PANEL IS RECOGNISED WITHOUT KNOWING WHAT IT LOOKS LIKE. Its appearance
// is the build's — `specs/instrumentation.md` fixes what to register and no
// spelling, layout or punctuation — so the reading is a comparison of the text
// two frames drew, and what one frame carries that the other does not is the
// panel.
//
// THE BOARD IS POSED SO THE PANEL HAS SOMETHING TO SAY. An empty table leaves
// most of the registered sources reading nothing, and a build whose panel is a
// row of zeroes might draw nothing distinguishable at all; a dealt game gives
// every source a value, so the panel that comes up is one a reader can see.
//
// WHAT THIS DOES NOT DECIDE. WHICH values the panel carries, which is the four
// `presentation/overlay-shows-*` points; that watching it costs the game nothing,
// which is `presentation/overlay-changes-nothing`'s; and that it starts hidden,
// which is `presentation/overlay-off-at-start`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  toggleOverlay,
  type Harness,
} from "../harness";
import { overlayLines } from "./overlay";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hides the overlay again on a second press of Backquote", async () => {
  await openTable(h);
  // A dealt game, so every source the specification asks for has a value to
  // report and the panel the first press brings up is one a reader can see.
  await h.debug.deal();

  const before = await h.frameCalls();

  await toggleOverlay(h);
  await toggleOverlay(h);
  const hidden = await h.frameCalls();
  // Taken after the second press, so the picture beside the verdict is the table
  // the overlay was meant to have left.
  await captureStill(h, "hidden");

  assertEqual(
    overlayLines(before, hidden).join(" | "),
    "",
    "the lines still being drawn after a SECOND press of Backquote that the " +
      "frame before either press did not — the same key hides the overlay " +
      "again (specs/controls.md)",
  );
});
