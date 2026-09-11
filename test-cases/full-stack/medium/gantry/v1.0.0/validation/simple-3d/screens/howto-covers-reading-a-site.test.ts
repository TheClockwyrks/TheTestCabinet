// screens/howto-covers-reading-a-site — the how-to explains what a site puts in
// front of the player.
//
// specs/ui.md, "How to play": "`howto` explains the game in a player's words:
// reading a site, …". This point is the first item of that list.
//
// WHAT A SITE IS is fixed by specs/sites.md, which opens "This file is
// authoritative for every site: the build envelope, the anchors, the budget, the
// loads, the obstacles, and the par figures the results screen shows". Reading a
// site is reading those — and specs/ui.md FIXES NO LIST, it says "reading a site"
// and stops. So every item below is one this check chose, and what it chose is
// the least the copy can leave out and still have explained the job a site sets:
// what the crane is fixed to (the anchors), what has to be moved (the loads), and
// where it has to go (the pads they reach).
//
// THE OTHER THREE ARE LEFT OUT, EACH ON ITS OWN TERMS, said item by item so this
// is not one rule for the items a build happened to name and another for the one
// it missed:
//
//   - THE BUILD ENVELOPE and THE BUDGET are limits on what may be BUILT rather
//     than the job the site sets. A player meets the envelope as a drawn aid in
//     the yard and the budget as a figure on the build readout — specs/ui.md
//     § Build shows "the cost against the budget" — and the copy explains both
//     wherever it explains the tools and what they cost.
//   - THE OBSTACLES are in the yard, but a site may have none at all
//     (specs/sites.md, Site 1: "No obstacles."), so copy that never says the word
//     has still explained how to read a site.
//   - THE PAR FIGURES are shown beside a clear's score on the results screen and
//     "gate nothing" (specs/sites.md).
//
// Requiring any of those words HERE would be this check inventing a requirement
// rather than reading one.
//
// The whole of the copy is searched rather than one section of it: how the
// explanation is divided up is the build's, and a build that covered the pads
// under its setting-down section has explained the pads.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { drawnTextLines } from "../case-harness/index";
import { createHarness, type Harness } from "../harness";

/** What a site gives the player, in the terms specs/sites.md gives them. */
const TOPICS = [
  {
    topic: "the anchors",
    terms: [/\banchors?\b/i, /\banchored\b/i, /\bmounts?\b/i, /\bfootings?\b/i],
  },
  { topic: "the loads", terms: [/\bloads?\b/i] },
  {
    topic: "the pads",
    terms: [/\bpads?\b/i, /\btargets?\b/i, /\bdrop ?-?off/i],
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Reading the copy the how-to screen drew                                    */
/* -------------------------------------------------------------------------- */
//
// The how-to screen is words, so this point is decided on the words the frame
// actually drew. `h.screenCalls()` answers every operation the build made on
// the screen layer — the 2D layer `specs/overview.md` puts the readouts on, the
// yard behind it being the engine's WebGL half — with every text call measured,
// and `drawnTextLines` folds the frame's `fillText` and `strokeText` calls into
// the logical runs they spell. A build that letter-spaces a heading draws it a
// glyph per call, and the specification fixes the copy and not its spacing, so
// the copy is read off the runs and never off the call split.
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
// words"), so a check that wanted a phrase would fail a build that explained the
// same thing perfectly well in different words. What it looks for is the game's
// own vocabulary — the names specs/controls.md, specs/program.md and
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

/** The topics the copy does not name, in the order they are listed. */
function unnamed(
  copy: string,
  topics: readonly {
    readonly topic: string;
    readonly terms: readonly RegExp[];
  }[],
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

it("names the anchors, and the loads and their pads", async () => {
  const copy = await howtoCopy(h);
  await h.capture("howto-site", "The how-to copy on reading a site");

  assertGreaterThan(
    copy.length,
    0,
    "the length of the copy the how-to screen drew (specs/ui.md)",
  );

  assertEqual(
    unnamed(copy, TOPICS),
    "",
    "what the how-to copy leaves unnamed of the anchors, and the loads and " +
      "their pads (specs/ui.md, specs/sites.md)",
  );
});
