// Refract — screens/playing-clear-hint: the playing screen names the key bound
// to the clear action.
//
// specs/ui.md's `playing` table requires "the key bound to the `clear` action,
// named on screen", and specs/controls.md fixes that binding as `KeyR` — the one
// key the case pins. So a text draw on the playing frame must carry a standalone
// `R`, matched at word boundaries; the boundary is what keeps `CRYSTAL`,
// `CLEAR`, or `TIER` from counting as naming the key. How the hint is worded and
// where it sits are the build's (the readouts' placement has its own point).
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
import { assertEqual, assertMatches } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  drawnTextLines,
  loadBoard,
  type Harness,
} from "../harness";

/** The clear key, named as a word of its own (specs/controls.md: `KeyR`). */
const NAMES_CLEAR_KEY = /\bR\b/;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a standalone R naming the clear key on the playing frame", async () => {
  await loadBoard(h, GEO_3X3);
  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "loadBoard moves to playing",
  );

  const calls = await h.frameCalls();
  await captureStill(h, "playing");

  assertMatches(
    drawnTextLines(calls).join(" ").toUpperCase(),
    NAMES_CLEAR_KEY,
    "the key bound to clear, named at word boundaries",
  );
});
