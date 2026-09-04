// screens/howto-covers-the-rail-tool — the how-to names the rail and the tool
// that places it.
//
// specs/ui.md, "How to play": "`howto` explains the game in a player's words:
// reading a site, the build tools and the parts they place, the ring and what
// the arm turns on, writing a tape and what each axis does, why speed loads the
// structure and swings the load, and setting a load down inside the
// tolerances." This point is the second item of that list.
//
// WHICH TOOLS THERE ARE IS FIXED ELSEWHERE, and that is what makes the point
// decidable: specs/controls.md's action table gives exactly six — `tool-strut`,
// `tool-cable`, `tool-rail`, `tool-ring`, `tool-counterweight` and
// `tool-delete` — and its "The build tools" section names the part each one
// places. This point is `tool-rail` alone, and the other five stand beside it
// as five checks of their own: a copy that names five tools and leaves one out
// has to grade above a copy that names none, and one point over the six could
// not tell them apart.
//
// The copy is asked for the name and for nothing about how it arranges it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue } from "../assert";
import { drawnText, toDrawCall } from "../case-harness/index";
import { createHarness, type Harness } from "../harness";

/** The rail, in the words a player's own account of it would reach for. */
const TERMS = [/\brails?\b/i];

/* -------------------------------------------------------------------------- */
/* Reading the copy the how-to screen drew                                    */
/* -------------------------------------------------------------------------- */
//
// The how-to screen is words, so this point is decided on the words the frame
// actually drew. `h.screenOps()` answers every operation the build made on the
// screen layer — the 2D layer `specs/overview.md` puts the readouts on, the
// yard behind it being the engine's WebGL half — and `drawnText` folds a
// frame's `fillText` and `strokeText` runs out of it.
//
// THIS IS THE ENGINE'S OWN READING OF THE SAME THING. Under `none` the
// operations come from a recorder injected into the page and are read over
// Playwright; here the engine states the seam outright — the game is handed
// "the screen layer's 2D context, exactly as the screen canvas returned it" —
// so the harness supplies a context that records what it is asked to draw
// before it draws it. What a check reads is the same list either way.
//
// MATCHING IS BY TERM, NEVER BY SENTENCE. specs/ui.md fixes WHAT the how-to
// screen explains and leaves every word of it to the build ("in a player's
// words"), so a check that wanted a phrase would fail a build that explained
// the same thing perfectly well in different words. What it looks for is the
// game's own vocabulary — the names specs/controls.md, specs/program.md and
// specs/structure.md give the things being explained — with the ordinary
// synonyms a player's words would reach for.

/** Every run of text the how-to screen drew, folded into one block. */
async function howtoCopy(h: Harness): Promise<string> {
  await h.debug.setScreen("howto");
  await h.advance(1);
  const ops = await h.screenOps();
  return drawnText(ops.map(toDrawCall)).join("\n");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names the rail the rail tool places", async () => {
  const copy = await howtoCopy(h);
  await h.capture("howto-rail", "The how-to copy on the rail tool");

  assertGreaterThan(
    copy.length,
    0,
    "the length of the copy the how-to screen drew (specs/ui.md)",
  );

  assertTrue(
    TERMS.some((term) => term.test(copy)),
    "the how-to copy naming the rail, one of the six build tools " +
      "specs/controls.md gives (specs/ui.md); it drew " +
      JSON.stringify(copy),
  );
});
