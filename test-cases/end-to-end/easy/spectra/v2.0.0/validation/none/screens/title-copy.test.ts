// Spectra — screens/title-copy: the title screen names the game.
//
// THE RULE. `specs/ui.md` gives the `title` screen two pieces of fixed copy: the
// title, `TITLE_TEXT` (`SPECTRA`), and the tagline, `TAGLINE_TEXT`
// (`TUNE TO SURVIVE`). Both are the specification's own words, so both are
// assertable exactly as written; the palette, the type and the layout of the
// screen are the build's and nothing here reads them.
//
// THE SCREEN IS THE ONE A FRESH PAGE OPENS ON. `specs/ui.md` says the game opens
// on `title`, and `createHarness` takes the game off the wall clock and `reset`s
// it, which `specs/instrumentation.md` says restores the screen to `title`.
// Nothing else is posed: this point wants the screen exactly as a player first
// meets it, so what it reads is the first thing a build shows anyone.
//
// WHAT IS READ. The runs of text the frame's render issued, through `fillText`
// and `strokeText`, matched as a substring and ignoring case. Substring rather
// than equality because how a build presents the two words is its own — a title
// drawn letter-spaced as one run, a tagline drawn inside a longer line — and
// requiring the exact run would fail a screen showing precisely the right copy.
// Nothing about the size, the position or the colour of either is asserted:
// `specs/ui.md` fixes none of them.
//
// WHAT IS NOT ASSERTED. The menu under the copy is `screens/title-menu-items`',
// which item is highlighted is `screens/title-menu-selection`', and whether the
// copy is LEGIBLE against what sits behind it is a reviewer's call from the
// captured image rather than a script's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { TAGLINE_TEXT, TITLE_TEXT } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { drewText } from "../case-harness/index";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the title and the tagline on the title screen", async () => {
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the game opens on the title screen (specs/ui.md)",
  );

  const calls = await h.frameCalls();
  await captureStill(h, "title");

  assertTrue(
    drewText(calls, TITLE_TEXT),
    `the title screen drawing TITLE_TEXT (${TITLE_TEXT}) — the title screen ` +
      "names the game (specs/ui.md)",
  );
  assertTrue(
    drewText(calls, TAGLINE_TEXT),
    `the title screen drawing TAGLINE_TEXT (${TAGLINE_TEXT}) — the tagline ` +
      "specs/ui.md fixes for the title screen",
  );
});
