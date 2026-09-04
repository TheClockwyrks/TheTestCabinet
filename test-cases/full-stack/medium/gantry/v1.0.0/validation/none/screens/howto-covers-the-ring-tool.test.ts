// screens/howto-covers-the-ring-tool — the how-to names the ring and the tool
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
// places. This point is `tool-ring` alone, and the other five stand beside it
// as five checks of their own: a copy that names five tools and leaves one out
// has to grade above a copy that names none, and one point over the six could
// not tell them apart.
//
// The copy is asked for the name and for nothing about how it arranges it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue } from "../assert";
import {
  RECORDER_GLOBAL,
  drawnText,
  toDrawCall,
  type RecordedOp,
} from "../case-harness/index";
import { createHarness, type Harness } from "../harness";

/** The ring, in the words a player's own account of it would reach for. */
const TERMS = [/\bring\b/i];

/* -------------------------------------------------------------------------- */
/* Reading the copy the how-to screen drew                                    */
/* -------------------------------------------------------------------------- */
//
// The how-to screen is words, so this point is decided on the words the frame
// actually drew. The harness records every operation the build makes on its 2D
// context — where an engineless build draws its screen layer, the yard behind
// it being the WebGL half — and `drawnText` folds a frame's `fillText` and
// `strokeText` runs out of it. `h.page` is the harness's own door to
// Playwright, which that recorder is read through; the shared harness exposes
// no reading of its own on this case's `Harness`.
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
  const ops = (await h.page.evaluate(
    (rec) =>
      (window as unknown as Record<string, { last(): unknown[] }>)[rec]!.last(),
    RECORDER_GLOBAL,
  )) as RecordedOp[];
  return drawnText(ops.map(toDrawCall)).join("\n");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names the ring the ring tool places", async () => {
  const copy = await howtoCopy(h);
  await h.capture("howto-ring", "The how-to copy on the ring tool");

  assertGreaterThan(
    copy.length,
    0,
    "the length of the copy the how-to screen drew (specs/ui.md)",
  );

  assertTrue(
    TERMS.some((term) => term.test(copy)),
    "the how-to copy naming the ring, one of the six build tools " +
      "specs/controls.md gives (specs/ui.md); it drew " +
      JSON.stringify(copy),
  );
});
