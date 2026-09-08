// Carom — ui/state-howto: the How to Play screen names the movement keys.
//
// The screen is POSED with `setScreen` (`openHowTo`) rather than reached by
// confirming HOW TO PLAY on the title menu: that confirm is
// navigation/title-howto's own point to grade, and a build with a broken title
// menu and a correct how-to screen has to fail there and pass here. What this
// point reads is the screen itself.
//
// The specification fixes no copy for it beyond that it "names the controls"
// (specs/ui.md, specs/overview.md), so what is read is that the frame's text
// names the movement keys the case binds: `W` and `S` as keys of their own, and
// the arrow keys by name or glyph. How the screen reads is the reviewer's, from
// the capture.
//
// The copy is the LOGICAL runs the frame spelled (`drawnTextLines`) AND the raw
// `fillText` strings (`drawnText`) together. The runs are needed because a build
// that letter-spaces its copy draws one glyph per call, and `U`, `P` joined by a
// space would never read as `UP`. The raw split is kept beside them because the
// patterns are boundary-anchored: `W` is one glyph, so a build that draws it and
// its action as two calls close together (`W`, then `UP` a few units on) can
// coalesce into `WUP` and lose the boundary the raw string still has. The union
// reads both, so neither presentation is fed back as a failure.
//
// The frame that is READ is advanced with the call list cleared, after the pose
// has settled, so what is inspected is one whole render of the how-to screen.
// Nothing on the field is posed or removed: specs/ui.md advances nothing on the
// how-to screen, so nothing on it can move between the two frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertMatches } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  drawnTextLines,
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
  await openHowTo(h);

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "howto");

  assertEqual(h.snapshot().screen, "howto");

  const copy = [...drawnText(h.calls), ...drawnTextLines(h.calls)].join(" ");
  assertMatches(copy, /\bW\b/i);
  assertMatches(copy, /\bS\b/i);
  assertMatches(copy, /arrow|\bup\b|\bdown\b|\u2191|\u2193/i);
});
