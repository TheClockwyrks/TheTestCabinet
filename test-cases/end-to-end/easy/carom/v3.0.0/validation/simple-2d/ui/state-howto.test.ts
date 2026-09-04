// Carom — ui/state-howto: the how-to screen names the movement keys.
//
// specs/ui.md gives the how-to screen one job — it "names the controls and
// describes the spin and obstacle mechanics" — and fixes no copy for it beyond
// that. So what is read is that the frame's text names the movement keys the case
// binds: `W` and `S` as keys of their own, and the arrow keys by name or glyph.
// How the screen reads as a whole is the reviewer's, from the capture.
//
// The screen is POSED. `openHowTo` is `reset`, `setMenuIndex(0)` and
// `setScreen("howto")` — the three atomic poses that are exactly the state
// specs/ui.md says arriving there leaves — rather than the title menu walked with
// keys. Reaching this screen from the title is `navigation/title-howto` and
// `navigation/space-confirms`' point, and a build with a broken title menu and a
// perfectly good how-to page must fail those and pass this one.
//
// The field is left as the title state holds it behind the screen. Nothing
// advances on `howto` (specs/ui.md) and no ball and no obstacle can draw a run of
// text, so there is nothing here to remove. Nothing takes a paddle: this screen
// is not driven through one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertMatches } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  openHowTo,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a how-to-play screen naming the movement keys", async () => {
  openHowTo(h);
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "howto");

  assertEqual(h.snapshot().screen, "howto");

  const copy = drawnText(h.calls).join(" ");
  assertMatches(copy, /\bW\b/i);
  assertMatches(copy, /\bS\b/i);
  assertMatches(copy, /arrow|\bup\b|\bdown\b|\u2191|\u2193/i);
});
