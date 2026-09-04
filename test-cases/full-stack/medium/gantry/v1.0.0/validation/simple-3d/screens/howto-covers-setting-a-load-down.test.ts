// screens/howto-covers-setting-a-load-down — the how-to explains setting a load
// down on its pad, square to it.
//
// specs/ui.md, "How to play": "`howto` explains the game in a player's words:
// … and setting a load down inside the tolerances." This point is the last item
// of that list.
//
// WHAT THE TOLERANCES ARE is fixed by specs/rigging.md, whose "Releasing" table
// judges a set-down on three tests: the position ("distance from lift point to
// target position at most `PLACE_POS_TOL`"), the yaw ("the wrapped difference
// between load yaw and target yaw at most `PLACE_YAW_TOL` degrees") and the
// speed. This point is the position and the yaw, so the copy is asked for three
// things: the act of setting a load down, the pad the position is measured to,
// and the load being square to it.
//
// NO FIGURE IS ASKED FOR. specs/ui.md wants the how-to "in a player's words",
// and a player is told to put the load down on its pad and square, not to put it
// down within `0.5` units and `10` degrees — so a check that demanded the
// numbers would fail a build that explained the rule exactly as asked.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { drawnText, toDrawCall } from "../case-harness/index";
import { createHarness, type Harness } from "../harness";

/** Setting a load down, the pad it goes on, and being square to it. */
const TOPICS = [
  {
    topic: "setting the load down",
    terms: [/\breleases?\b/i, /\bsets? .{0,20}down\b/i, /\bsetting .{0,20}down\b/i, /\bputs? .{0,20}down\b/i, /\bset down\b/i, /\bdrops? it\b/i],
  },
  { topic: "the pad it goes on", terms: [/\bpads?\b/i, /\btargets?\b/i, /\bfootprints?\b/i] },
  {
    topic: "being square to the pad",
    terms: [/\bsquare/i, /\byaw\b/i, /\baligned?\b/i, /\blined up\b/i, /\bturned\b/i, /\bstraight\b/i, /\bangle\b/i, /\bfacing\b/i, /\borientation\b/i],
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Reading the copy the how-to screen drew                                    */
/* -------------------------------------------------------------------------- */
//
// The how-to screen is words, so this point is decided on the words the frame
// actually drew. `h.screenOps()` answers every operation the build made on the
// screen layer — the 2D layer `specs/overview.md` puts the readouts on, the yard
// behind it being the engine's WebGL half — and `drawnText` folds a frame's
// `fillText` and `strokeText` runs out of it.
//
// THIS IS THE ENGINE'S OWN READING OF THE SAME THING. Under `none` the operations
// come from a recorder injected into the page and are read over Playwright; here
// the engine states the seam outright — the game is handed "the screen layer's 2D
// context, exactly as the screen canvas returned it" — so the harness supplies a
// context that records what it is asked to draw before it draws it. What a check
// reads is the same list either way.
//
// MATCHING IS BY TERM, NEVER BY SENTENCE. specs/ui.md fixes WHAT the how-to
// screen explains and leaves every word of it to the build ("in a player's
// words"), so a check that wanted a phrase would fail a build that explained the
// same thing perfectly well in different words. What it looks for is the game's
// own vocabulary — the names specs/controls.md, specs/program.md and
// specs/structure.md give the things being explained — with the ordinary
// synonyms a player's words would reach for.

/** Every run of text the how-to screen drew, folded into one block. */
async function howtoCopy(h: Harness): Promise<string> {
  await h.debug.setScreen("howto");
  await h.advance(1);
  const ops = await h.screenOps();
  return drawnText(ops.map(toDrawCall)).join("\n");
}

/** The topics the copy does not name, in the order they are listed. */
function unnamed(
  copy: string,
  topics: readonly { readonly topic: string; readonly terms: readonly RegExp[] }[],
): string {
  return topics
    .filter(({ terms }) => !terms.some((term) => term.test(copy)))
    .map(({ topic }) => topic)
    .join(", ");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names setting a load down on its pad and square to it", async () => {
  const copy = await howtoCopy(h);
  assertGreaterThan(
    copy.length,
    0,
    "the length of the copy the how-to screen drew (specs/ui.md)",
  );

  assertEqual(
    unnamed(copy, TOPICS),
    "",
    "what the how-to copy leaves unnamed of setting a load down, the pad it " +
      "goes on, and being square to it (specs/ui.md, specs/rigging.md)",
  );

  await h.capture("howto-release", "The how-to copy on setting a load down");
});
