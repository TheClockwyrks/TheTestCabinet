// Refract — screens/howto-copy: the how-to frame draws its explanation, and
// among the draws the key bound to `clear` is named.
//
// specs/ui.md's `howto` screen covers the rules "in a player's words" and, last
// on its list, "the controls, naming the key bound to the `clear` action" —
// which specs/controls.md fixes as `KeyR`, the one binding the case pins. What a
// script can decide is that the frame draws text at all and that a standalone
// `R`, matched at word boundaries, appears among it; whether the prose really
// teaches the game is the run-wide aesthetic rating's, not this point's. The word
// boundary is what keeps `REFRACT`, `CRYSTAL`, or `CLEAR` from counting as
// naming the key.
//
// The frame's text is read as its COALESCED RUNS (the harness's `drawnTextLines`),
// never as the raw `fillText` split: a build that letter-spaces its copy draws
// one glyph per call, which is the only portable way to letter-space canvas
// text, and read call by call every glyph is a word of its own — the R inside a
// letter-spaced REFRACT would name the key, and a standalone R could sit in no
// run at all. The merge rule (`case-harness/text.ts`) folds side-by-side glyphs
// on one baseline back into the string they spell, so the word boundary decides
// what it is meant to.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertMatches } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextLines,
  type Harness,
} from "../harness";
import { reachHowto } from "./screens";

/** The clear key, named as a word of its own (specs/controls.md: `KeyR`). */
const NAMES_CLEAR_KEY = /\bR\b/;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws its text and names the clear key as a standalone R", async () => {
  await reachHowto(h);

  const calls = await h.frameCalls();
  await captureStill(h, "howto");

  const runs = drawnTextLines(calls);
  assertGreaterThan(runs.length, 0, "the howto frame draws text");
  assertMatches(
    runs.join(" ").toUpperCase(),
    NAMES_CLEAR_KEY,
    "the key bound to clear, named at word boundaries",
  );
});
