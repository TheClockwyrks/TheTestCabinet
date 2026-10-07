// presentation/overlay-off-at-start — the game starts with the debug overlay
// hidden.
//
// THE RULE. `specs/controls.md`, The debug overlay: "The read-only debug overlay
// `specs/instrumentation.md` describes is shown and hidden by the backtick key,
// `KeyboardEvent.code` `Backquote`. It is off when the game starts."
// `specs/instrumentation.md` says the same of the panel the build writes: "it is
// off when the game starts".
//
// SCOPED TO THIS ENGINE, because under the other two the panel and its key are
// the engine's: the build registers sources and the engine draws and toggles the
// panel, so an item on the default state could not fail on all three. Here the
// whole runtime layer is the build's.
//
// HOW "OFF" IS READ WITHOUT KNOWING WHAT THE PANEL LOOKS LIKE. The panel's
// appearance is the build's — `specs/instrumentation.md` fixes what to register
// and no spelling, layout or punctuation — so the only honest reading is a
// comparison: the text a frame draws before the key is pressed, against the text
// a frame draws after it. What the FIRST frame drew and the second did not is
// what a panel that was already up would have contributed, and on a build that
// starts hidden that is nothing.
//
// AND THE PRESS IS REQUIRED TO HAVE DONE SOMETHING, because a build whose key is
// dead draws the same two frames and would otherwise pass this reading for the
// wrong reason. `presentation/overlay-toggles-on-backquote` is the point that
// grades the key; the reading here only has to be sure the comparison it made was
// against a panel that came up at all.
//
// THE HARNESS'S OPENING RESET CANNOT HIDE THE ANSWER. `reset` restores the
// declared fields of the game's STATE (`specs/instrumentation.md`), and the panel
// belongs to the runtime layer beside it, so what this point reads is the state
// the build stood its own runtime up in.
//
// THE TABLE IS LEFT EXACTLY AS THE BUILD OPENED IT, with nothing posed on it: the
// requirement is about the first thing a player sees.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
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

it("draws no overlay over the table the build started on", async () => {
  // The frame the build stands up on, before any key has been pressed.
  const started = await h.frameCalls();
  // Before the toggle, so the picture beside the verdict is the clean table this
  // point is about.
  await captureStill(h, "clean");

  await toggleOverlay(h);
  const shown = await h.frameCalls();

  assertGreaterThan(
    overlayLines(started, shown).length,
    0,
    "the lines the frame after one press of Backquote drew that the frame " +
      "before it did not — without a panel that came up, the reading below " +
      "would pass on a build whose key does nothing rather than on one whose " +
      "overlay starts hidden (specs/controls.md)",
  );

  assertEqual(
    overlayLines(shown, started).join(" | "),
    "",
    "the lines the STARTING frame drew that the frame with the overlay up did " +
      "not — the overlay is off when the game starts (specs/controls.md), so " +
      "a build that opened with its panel up carries lines here that the " +
      "toggled frame no longer has",
  );
});
