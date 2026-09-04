// screens/howto-covers-the-slew-axis — the how-to names the slew axis.
//
// specs/ui.md, "How to play": "`howto` explains the game in a player's words:
// … writing a tape and what each axis does …". This point is the slew axis's
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
import { drawnText, toDrawCall } from "../case-harness/index";
import { createHarness, type Harness } from "../harness";

/** The slew axis, under the name specs/program.md gives it. */
const TERMS = [/\bslew/i];

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

it("names the slew axis", async () => {
  const copy = await howtoCopy(h);
  await h.capture("howto-slew", "The how-to copy on the slew axis");

  assertGreaterThan(
    copy.length,
    0,
    "the length of the copy the how-to screen drew (specs/ui.md)",
  );

  assertTrue(
    TERMS.some((term) => term.test(copy)),
    "the how-to copy naming the slew axis, one of the four specs/program.md gives (specs/ui.md); it drew " +
      JSON.stringify(copy),
  );
});
