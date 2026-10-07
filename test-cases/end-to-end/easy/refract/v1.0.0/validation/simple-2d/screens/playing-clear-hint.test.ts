// Refract — screens/playing-clear-hint: the playing screen names the clear
// key.
//
// specs/ui.md's `playing` table lists the clear control among what the player
// sees: the key bound to the `clear` action, named on screen — and
// specs/controls.md fixes that binding as KeyR. What is mechanically decidable
// is that some text draw on the playing frame carries a standalone R, matched
// at word boundaries so the R inside REFRACT, CRYSTAL, or CLEAR itself cannot
// stand in for it; whether the surrounding copy reads well is the reviewer's,
// from the captured frame.
//
// The frame's text is read as its COALESCED RUNS (the harness's `drawnTextLines`),
// never as the raw `fillText` split: a build that letter-spaces its copy draws
// one glyph per call, which is the only portable way to letter-space canvas
// text, and read call by call every glyph is a word of its own — the R inside a
// letter-spaced REFRACT would name the key, and a standalone R could sit in no
// run at all. The recorder measures every text call, so the harness's merge
// rule folds side-by-side glyphs on one baseline back into the string they
// spell, and the word boundary decides what it is meant to.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  drawnTextLines,
  loadBoard,
  resetTo,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a text draw on the playing frame names the clear key as a standalone R", async () => {
  await resetTo(h);
  await loadBoard(h, GEO_3X3);
  assertEqual(
    h.snapshot().screen,
    "playing",
    "posing: loadBoard moves to playing (specs/instrumentation.md)",
  );

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "playing");

  assertTrue(
    drawnTextLines(h.calls).some((text) => /\bR\b/i.test(text)),
    "a text draw on the playing frame names the key bound to the clear " +
      "action as a standalone R (specs/ui.md: the clear control; " +
      "specs/controls.md: clear is KeyR)",
  );
});
