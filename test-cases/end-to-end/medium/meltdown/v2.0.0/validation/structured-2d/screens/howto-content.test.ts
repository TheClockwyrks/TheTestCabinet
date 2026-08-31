// Meltdown — screens/howto-content: the how-to screen covers the game.
//
// THE RULE. specs/screens.md, `howto`: "Covers the goal of the game, the
// controls, heat as power and the redline trip, the Forge and the Sink, the
// heat-averse Rime, flyers and the air-only Flak, that a Containment wave fields
// a single type, and the economy."
//
// WHAT A SCRIPT CAN DECIDE HERE. Whether an explanation explains well is a
// reviewer's judgement and no check's. What the specification states is a list of
// SUBJECTS the screen must cover, and a subject is covered by a screen that NAMES
// it — so each is looked for as a word on the screen, and the failure names the
// subject the build's how-to never mentioned. A build that draws a how-to screen
// with three lines on it fails naming the seven subjects it skipped; a build that
// covers all of them in its own words passes whatever those words are.
//
// THE VOCABULARY IS THE CASE'S, AND EVERY SUBJECT ACCEPTS ALTERNATIVES. Four of
// the subjects are proper nouns the case fixes — the Forge, the Sink, the Rime and
// the Flak are what those towers are CALLED (specs/towers.md), so a screen
// covering them says their names. The rest are looked for through a set of words
// any of which covers the subject, because specs/screens.md fixes the subject and
// not the sentence: a screen that says "trips" and one that says "redline" have
// both covered the redline trip, and a screen that says "bounty" and one that says
// "money" have both covered the economy. The stem is matched at a token boundary,
// so "REPAIR" is never mistaken for "AIR".
//
// WHY IT IS ONE ITEM AND NOT ELEVEN. specs/screens.md states the coverage as one
// requirement about one screen, and the manifest declares one item for it; a
// failure names the subject that was missing, which is what tells a build with a
// thorough how-to from one with a thin one.
//
// THE SCREEN IS POSED OUTRIGHT after a reset, so this reads what the how-to
// covers rather than the route that reaches it — `screens.title-to-howto` reads
// that — and no key is pressed: the way out is `screens.back-from-howto`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { captureStill, createHarness, resetTo, type Harness } from "../harness";
import { readScreen, saysAnyStem } from "./menu";

/**
 * One subject the how-to must cover, and the word stems that cover it.
 *
 * `needs` is a list of requirements, each a set of alternatives: the subject is
 * covered when the screen carries a word from EVERY set. Almost every subject has
 * one set; the wave rule has two, because "a wave fields a single type" is a
 * statement about waves AND about types and a screen that mentions waves without
 * ever saying what one carries has not covered it.
 */
interface Subject {
  readonly subject: string;
  readonly needs: readonly (readonly string[])[];
}

/** The subjects specs/screens.md lists, in the order it lists them. */
const SUBJECTS: readonly Subject[] = [
  {
    subject: "the goal of the game",
    needs: [["GOAL", "WIN", "SURVIV", "LIVES"]],
  },
  {
    subject: "the controls",
    needs: [["CONTROL", "KEY", "PRESS", "POINT", "TAP", "CLICK", "BUTTON"]],
  },
  { subject: "heat as power", needs: [["HEAT"]] },
  { subject: "the redline trip", needs: [["REDLINE", "TRIP", "OVERHEAT"]] },
  { subject: "the Forge", needs: [["FORGE"]] },
  { subject: "the Sink", needs: [["SINK"]] },
  { subject: "the heat-averse Rime", needs: [["RIME"]] },
  { subject: "the air-only Flak", needs: [["FLAK"]] },
  {
    subject: "flyers",
    needs: [["FLY", "FLIER", "FLIES", "AIR", "AERIAL", "DRIFT"]],
  },
  {
    subject: "that a wave fields a single type",
    needs: [["WAVE"], ["TYPE", "KIND"]],
  },
  {
    subject: "the economy",
    needs: [
      ["MONEY", "BOUNTY", "INTEREST", "CASH", "COIN", "SPEND", "PAY", "COST"],
    ],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("covers every subject the how-to screen is required to cover", async () => {
  resetTo(h);
  h.debug.setScreen("howto");

  const runs = await readScreen(h);
  captureStill(h, "howto");

  assertEqual(
    h.snapshot().screen,
    "howto",
    "the screen the scenario is posed on",
  );

  // The whole of a how-to screen is far too much text to put on a failure's
  // `Actual:` line, so what a missing subject reports is how much the screen drew
  // and that none of it named the subject — the reviewer has the still beside it.
  for (const { subject, needs } of SUBJECTS) {
    for (const alternatives of needs) {
      if (!saysAnyStem(runs, alternatives)) {
        fail(
          `the how-to screen to cover ${subject}, naming one of ` +
            `${alternatives.join(", ")} (specs/screens.md, \`howto\`)`,
          `${runs.length} runs of text, none of them naming it`,
        );
      }
    }
  }
});
