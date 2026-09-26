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
import { drawnTextLines } from "../case-harness/index";
import { createHarness, type Harness } from "../harness";

/** The rail, in the words a player's own account of it would reach for. */
const TERMS = [/\brails?\b/i];

/* -------------------------------------------------------------------------- */
/* Reading the copy the how-to screen drew                                    */
/* -------------------------------------------------------------------------- */
//
// The how-to screen is words, so this point is decided on the words the frame
// actually drew. The harness records every operation the game makes on the
// screen layer — the 2D pass the engine composites over the WebGL yard — and
// `h.screenCalls()` hands that record back with every text call measured, so
// `drawnTextLines` can fold the frame's `fillText` and `strokeText` calls into
// the logical runs they spell. A build that letter-spaces a heading draws it a
// glyph per call, and the specification fixes the copy and not its spacing, so
// the copy is read off the runs and never off the call split. It answers the
// last CLOSED frame, so a frame is advanced before it is read.
//
// MATCHING IS BY TERM, NEVER BY SENTENCE. specs/ui.md fixes WHAT the how-to
// screen explains and leaves every word of it to the build ("in a player's
// words"), so a check that wanted a phrase would fail a build that explained
// the same thing perfectly well in different words. What it looks for is the
// game's own vocabulary — the names specs/controls.md, specs/program.md and
// specs/structure.md give the things being explained — with the ordinary
// synonyms a player's words would reach for.

/**
 * Every run of text the how-to screen drew, folded into one block.
 *
 * Read off the LOGICAL RUNS the frame spells, never off the `fillText` split:
 * a build that letter-spaces its copy draws a glyph per call, which is the only
 * portable way to letter-space canvas text, and the specification fixes the
 * words a screen shows while leaving their spacing to the build. `screenCalls`
 * carries the measured geometry the shared merge rule (`case-harness/text.ts`)
 * needs to put side-by-side glyphs on one baseline back together, and every
 * raw string is a substring of its run, so coalescing can only add a match.
 */
async function howtoCopy(h: Harness): Promise<string> {
  await h.debug.setScreen("howto");
  await h.advance(1);
  return drawnTextLines(await h.screenCalls()).join("\n");
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
