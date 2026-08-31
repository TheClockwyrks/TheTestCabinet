// Floe — screens/howto-contents: the how-to screen covers each of the six things
// the specification requires it to cover.
//
// `specs/ui.md` lists them, and the list is exhaustive: "The `howto` screen names
// each of these: the goal of filling the five far-shore bays, the keys the critter
// hops with, the bear that hunts the critter across the whole strait, the vehicles
// sliding along the ice band, the floes drifting along the water band, and the
// crossing timer." Six subjects, and a build that explains five of them has left a
// player without one of the six things the game asks them to know.
//
// WHAT A SCRIPT CAN DECIDE, AND WHAT IT LEAVES TO THE REVIEWER. Whether the prose
// actually TEACHES the game is a reading, and the still this check writes is what
// a reviewer reads it from. What a script can decide is that each of the six
// subjects is named at all, so each is looked for as an alternation of the words
// the game's own specification uses for it — the nouns the case names its parts
// with, plus the everyday synonyms a build writing "in a player's words" would
// reach for instead. The alternations are deliberately wide: the point is to catch
// a screen that never mentions the bear, not to insist on a phrasing. A build that
// covers a subject in words none of its alternation holds fails a point it
// deserved, so each alternation is written to be passed by any sentence that
// genuinely names the thing.
//
// THE HUD IS NOT PART OF THE SCREEN'S COPY. This matters more here than anywhere
// else: `specs/ui.md`'s HUD carries a timer readout and a level label, so a check
// that read the whole frame would find "the crossing timer" in a HUD drawn behind
// the how-to screen and pass a build that never mentioned it. `screenCopy` reads
// only what was drawn over the strait, where `specs/ui.md` puts the screens.
//
// THE SCREEN IS POSED. `setScreen("howto")` reaches the subject directly, so a
// build whose title menu cannot get here loses `screens.howto-opens` and still has
// its how-to screen graded.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertMatches } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  type Harness,
} from "../harness";
import { screenCopy, screenRuns } from "./screens";

/**
 * The six subjects `specs/ui.md` requires, each as the words that name it.
 *
 * Each alternation holds the specification's own noun for the subject first, then
 * the words a build is likely to use instead. None of them is read off the
 * reference implementation: they are the vocabulary the case's own specification
 * files use for these parts of the game (`specs/bays.md`, `specs/hopping.md`,
 * `specs/controls.md`, `specs/hunter.md`, `specs/ice.md`, `specs/water.md`,
 * `specs/progression.md`) together with the plain-English word for each.
 */
const SUBJECTS: readonly {
  readonly subject: string;
  readonly named: RegExp;
}[] = [
  {
    subject: "the goal of filling the five far-shore bays",
    named: /\bBAYS?\b|\bNESTS?\b|\bBERTHS?\b|\bSLOTS?\b/,
  },
  {
    subject: "the keys the critter hops with",
    named: /\bKEYS?\b|\bARROWS?\b|\bWASD\b|\bW\s*A\s*S\s*D\b/,
  },
  {
    subject: "the bear that hunts the critter",
    named: /\bBEARS?\b/,
  },
  {
    subject: "the vehicles sliding along the ice band",
    named:
      /\bICE\b|\bVEHICLES?\b|\bTRAFFIC\b|\bPLOWS?\b|\bDOGSLEDS?\b|\bCARS?\b|\bTRUCKS?\b|\bSLEDS?\b/,
  },
  {
    subject: "the floes drifting along the water band",
    named: /\bFLOES?\b|\bWATER\b|\bRAFTS?\b|\bPANS?\b|\bRIVER\b|\bCHANNEL\b/,
  },
  {
    subject: "the crossing timer",
    named: /\bTIMER?\b|\bTIMED\b|\bCLOCK\b|\bSECONDS?\b|\bCOUNTDOWN\b/,
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("names the bays, the hop keys, the bear, the vehicles, the floes and the timer", async () => {
  h.debug.reset();
  h.debug.setScreen("howto");

  const calls = await drawFrame(h);
  captureStill(h, "howto");

  const copy = screenCopy(h, calls);
  assertGreaterThan(
    screenRuns(h, calls).length,
    0,
    "the how-to screen to draw text over the strait at all (specs/ui.md)",
  );
  for (const { subject, named } of SUBJECTS) {
    assertMatches(
      copy,
      named,
      `the how-to screen names ${subject} (specs/ui.md)`,
    );
  }
});
