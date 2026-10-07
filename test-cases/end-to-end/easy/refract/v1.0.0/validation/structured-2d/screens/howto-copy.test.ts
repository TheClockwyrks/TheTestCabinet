// Refract — screens/howto-copy: the how-to frame draws text, and among the
// draws a standalone R names the key bound to the clear action.
//
// specs/ui.md requires the how-to screen to cover the controls, "naming the
// key bound to the `clear` action", and specs/controls.md binds `clear` to
// `KeyR` — so somewhere in the frame's text the letter R stands alone. The
// match is a word boundary on both sides, so prose that merely contains an R
// inside a word (REFRACT, CRYSTAL, PRESS) cannot satisfy it, while any
// phrasing that names the key — "R", "press R", "R clears the board",
// "[R] CLEAR" — does. What the rest of the copy says is the build's own
// writing: whether the prose really teaches the game is the run-wide aesthetic
// rating's, not this point's.
//
// The screen is POSED with `setScreen`, not walked to through the title menu: a
// build with a broken `down` binding must fail `screens/title-down` and pass
// this point.
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
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextLines,
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

it("draws how-to text naming the clear key as a standalone R", async () => {
  // Pose the how-to screen: `setScreen` sets its own field alone, and the
  // screen it sets behaves exactly as specs/ui.md states for it
  // (specs/instrumentation.md).
  await resetTo(h);
  h.debug.setScreen("howto");
  await h.advance(1);
  assertEqual(h.snapshot().screen, "howto", "the how-to screen is up");

  // One whole frame's draws, recorded from a clean log.
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "howto");

  const texts = drawnTextLines(h.calls);
  assertGreaterThan(texts.length, 0, "the how-to frame draws text");
  assertEqual(
    texts.some((text) => /\bR\b/.test(text)),
    true,
    "a drawn run names the clear key as a standalone R",
  );
});
