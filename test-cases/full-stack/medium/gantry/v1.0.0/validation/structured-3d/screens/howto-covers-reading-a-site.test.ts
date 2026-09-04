// screens/howto-covers-reading-a-site — the how-to explains what a site puts in
// front of the player.
//
// specs/ui.md, "How to play": "`howto` explains the game in a player's words:
// reading a site, …". This point is the first item of that list.
//
// WHAT A SITE IS is fixed by specs/sites.md, which opens "This file is
// authoritative for every site: the build envelope, the anchors, the budget, the
// loads, the obstacles, and the par figures the results screen shows". Reading a
// site is reading those, so the copy is asked to name the ones a player acts on
// while building and running: the anchors the crane is fixed to, the budget the
// cost is held against, and the loads with the pads they have to reach.
//
// THE BUILD ENVELOPE IS DELIBERATELY NOT ASKED FOR. specs/ui.md says only
// "reading a site" and fixes no list, and while the envelope is one of a site's
// figures it is also the one a player meets as a drawn aid on the build screen
// rather than as a word — so requiring the word would be this check inventing a
// requirement rather than reading one.
//
// The whole of the copy is searched rather than one section of it: how the
// explanation is divided up is the build's, and a build that covered the budget
// under its building section has explained the budget.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { drawnText, toDrawCall, type RecordedOp } from "../case-harness/index";
import { createHarness, type Harness } from "../harness";

/** What a site gives the player, in the terms specs/sites.md gives them. */
const TOPICS = [
  {
    topic: "the anchors",
    terms: [/\banchors?\b/i, /\banchored\b/i, /\bmounts?\b/i, /\bfootings?\b/i],
  },
  {
    topic: "the budget",
    terms: [/\bbudgets?\b/i, /\ballowance\b/i, /\bspend\b/i],
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
// actually drew. The harness records every operation the game makes on the screen
// layer — the 2D pass the engine composites over the WebGL yard — and `drawnText`
// folds a frame's `fillText` and `strokeText` runs out of it. `h.screenOps()` is
// where that record is read; it answers the last CLOSED frame, so a frame is
// advanced before it is read.
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
  const ops = (await h.screenOps()) as RecordedOp[];
  return drawnText(ops.map(toDrawCall)).join("\n");
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

it("names the anchors, the budget, and the loads and their pads", async () => {
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
    "what the how-to copy leaves unnamed of the anchors, the budget, and the " +
      "loads and their pads (specs/ui.md, specs/sites.md)",
  );
});
