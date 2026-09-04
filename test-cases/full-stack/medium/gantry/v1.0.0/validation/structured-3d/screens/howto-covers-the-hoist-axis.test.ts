// screens/howto-covers-the-hoist-axis — the how-to names the hoist axis.
//
// specs/ui.md, "How to play": "`howto` explains the game in a player's words:
// … writing a tape and what each axis does …". This point is the hoist axis's
// share of that item.
//
// THE AXES ARE A CLOSED, NAMED SET, which is what makes the point decidable:
// specs/program.md's axis table gives exactly four — `slew`, `trolley`, `hoist`
// and `grip` — with what each drives, and those names are the game's own rather
// than a description a build could word differently. Each axis is a check of
// its own, and the tape they are commanded from is
// `screens/howto-covers-the-tape`: a copy that explains three axes and forgets
// the fourth has to grade above a copy that names none, and one point over the
// four could not tell them apart.
//
// WHAT THE AXIS DOES IS NOT ASSERTED HERE, only that it is named: the copy is a
// player's words and specs/ui.md fixes no wording for the description, so a
// check that demanded one would be grading a phrasing rather than a
// requirement.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue } from "../assert";
import { drawnText, toDrawCall, type RecordedOp } from "../case-harness/index";
import { createHarness, type Harness } from "../harness";

/** The hoist axis, under the name specs/program.md gives it. */
const TERMS = [/\bhoist/i];

/* -------------------------------------------------------------------------- */
/* Reading the copy the how-to screen drew                                    */
/* -------------------------------------------------------------------------- */
//
// The how-to screen is words, so this point is decided on the words the frame
// actually drew. The harness records every operation the game makes on the
// screen layer — the 2D pass the engine composites over the WebGL yard — and
// `drawnText` folds a frame's `fillText` and `strokeText` runs out of it.
// `h.screenOps()` is where that record is read; it answers the last CLOSED
// frame, so a frame is advanced before it is read.
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
  const ops = (await h.screenOps()) as RecordedOp[];
  return drawnText(ops.map(toDrawCall)).join("\n");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names the hoist axis", async () => {
  const copy = await howtoCopy(h);
  await h.capture("howto-hoist", "The how-to copy on the hoist axis");

  assertGreaterThan(
    copy.length,
    0,
    "the length of the copy the how-to screen drew (specs/ui.md)",
  );

  assertTrue(
    TERMS.some((term) => term.test(copy)),
    "the how-to copy naming the hoist axis, one of the four specs/program.md gives (specs/ui.md); it drew " +
      JSON.stringify(copy),
  );
});
