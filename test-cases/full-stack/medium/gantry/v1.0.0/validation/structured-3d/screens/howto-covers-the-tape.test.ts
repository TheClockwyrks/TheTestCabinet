// screens/howto-covers-the-tape — the how-to explains writing a tape.
//
// specs/ui.md, "How to play": "`howto` explains the game in a player's words: …
// writing a tape and what each axis does …". This point is the tape's share of
// that item; the four axes it commands are four checks beside this one, so a
// copy that explains the tape and forgets an axis grades above a copy that does
// neither.
//
// THE TAPE IS ASKED FOR UNDER ITS OWN NAME, which is what makes the point
// decidable: specs/program.md calls the program a build writes a tape
// throughout, so it is the game's own word for the thing rather than a
// description a build could word differently.
//
// WHAT WRITING ONE INVOLVES IS NOT ASSERTED HERE, only that it is named: the
// copy is a player's words and specs/ui.md fixes no wording for the
// explanation, so a check that demanded one would be grading a phrasing rather
// than a requirement.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue } from "../assert";
import { drawnText, toDrawCall, type RecordedOp } from "../case-harness/index";
import { createHarness, type Harness } from "../harness";

/** The tape, under the name specs/program.md gives it. */
const TERMS = [/\btapes?\b/i];

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

it("names the tape", async () => {
  const copy = await howtoCopy(h);
  await h.capture("howto-tape", "The how-to copy on the tape");

  assertGreaterThan(
    copy.length,
    0,
    "the length of the copy the how-to screen drew (specs/ui.md)",
  );

  assertTrue(
    TERMS.some((term) => term.test(copy)),
    "the how-to copy naming the tape, the thing a run is written on (specs/program.md) (specs/ui.md); it drew " +
      JSON.stringify(copy),
  );
});
