// Refract — screens/howto-copy: the how-to screen draws text, and among the
// draws a standalone R names the key bound to the clear action.
//
// specs/ui.md's `howto` section requires the screen to explain the game and to
// name, among its points, the key bound to `clear` — which specs/controls.md
// fixes as KeyR. What is mechanically decidable is that the frame draws text
// at all and that some drawn run carries a standalone R, matched at word
// boundaries so the R inside REFRACT or CRYSTAL cannot stand in for it; whether
// the prose really teaches the game is the run-wide aesthetic rating's, not
// this point's, which is why this item's cap is `great` rather than a
// functional one.
//
// The screen is POSED with `setScreen`, not walked to through the title menu:
// a build with a broken `down` binding must fail `screens/title-down` and pass
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
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
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

it("draws its copy, naming the clear key as a standalone R", async () => {
  await resetTo(h);
  h.debug.setScreen("howto");
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "howto",
    "posing: the how-to screen is up (specs/instrumentation.md setScreen)",
  );

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "howto");

  const texts = drawnTextLines(h.calls);
  assertGreaterThan(
    texts.length,
    0,
    "the howto frame draws text explaining the game (specs/ui.md)",
  );
  assertTrue(
    texts.some((text) => /\bR\b/i.test(text)),
    "a standalone R among the drawn text names the key bound to the clear " +
      "action (KeyR, specs/controls.md; specs/ui.md: howto names it)",
  );
});
