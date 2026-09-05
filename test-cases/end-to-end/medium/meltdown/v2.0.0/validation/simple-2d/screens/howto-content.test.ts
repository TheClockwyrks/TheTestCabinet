// screens/howto-content — the how-to screen covers every subject the case says it
// covers.
//
// THE RULE. specs/screens.md, `howto`: the screen "Covers the goal of the game,
// the controls, heat as power and the redline trip, the Forge and the Sink, the
// heat-averse Rime, flyers and the air-only Flak, that a Containment wave fields
// a single type, and the economy." Eleven subjects, and the screen is read for
// all eleven.
//
// A SUBJECT IS COVERED BY A SCREEN THAT NAMES IT, and that is the whole reading.
// specs/screens.md fixes the subjects and fixes no wording for any of them, so
// nothing here reads a sentence, a length, a position or a layout. What each
// subject is looked for by is the CASE'S OWN vocabulary — the proper nouns
// specs/towers.md fixes for the four towers, and for the rest a set of
// alternatives every one of which names the subject — so a build is free to write
// its how-to in its own words and still be read as covering the subject. No
// alternative below is a word the specifications do not themselves use.
//
// EACH SUBJECT IS ASSERTED ON ITS OWN, so a screen that covers ten of the eleven
// fails naming the one it skipped rather than failing as a whole.
//
// A STEM RATHER THAN A WHOLE WORD, because English inflects and a specification
// names a subject rather than a sentence: a screen covering the redline TRIP may
// say "trips", "tripped" or "the trip". The token boundary is what keeps it
// honest — a stem of `AIR` is not answered by `REPAIR`.
//
// ONE SUBJECT TAKES TWO WORDS, and it is the one whose whole content is a
// relation: "that a Containment wave fields a single type" is not covered by a
// screen that merely says `wave`, which any screen about this game says somewhere,
// so it asks for a wave AND for a type. Every other subject is one set.
//
// THE SCREEN IS POSED, because what it DRAWS does not depend on how a player got
// to it: reaching it is `screens.title-to-howto`'s reading and leaving it is
// `screens.back-from-howto`'s.
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnText,
  type Harness,
} from "../harness";
import { poseMenu } from "./menu";

/**
 * One subject the how-to must cover, and the word stems that cover it.
 *
 * `needs` is a list of requirements, each a set of alternatives: the subject is
 * covered when the screen carries a word beginning with a stem from EVERY set.
 * Almost every subject has one set, so one word covers it.
 */
interface Subject {
  readonly subject: string;
  readonly needs: readonly (readonly string[])[];
}

/** The subjects specs/screens.md lists, in the order it lists them. */
const SUBJECTS: readonly Subject[] = [
  {
    subject: "the goal of the game",
    needs: [
      ["GOAL", "WIN", "SURVIV", "CONTAIN", "LIVES", "LIFE", "LEAK", "EXHAUST"],
    ],
  },
  {
    subject: "the controls",
    needs: [
      [
        "CONTROL",
        "KEY",
        "PRESS",
        "POINT",
        "TAP",
        "CLICK",
        "BUTTON",
        "MOUSE",
        "ARROW",
        "ESC",
      ],
    ],
  },
  { subject: "heat as power", needs: [["HEAT", "HOTTER", "THERMAL"]] },
  { subject: "the redline trip", needs: [["REDLINE", "TRIP", "OVERHEAT"]] },
  { subject: "the Forge", needs: [["FORGE"]] },
  { subject: "the Sink", needs: [["SINK"]] },
  { subject: "the heat-averse Rime", needs: [["RIME"]] },
  { subject: "the air-only Flak", needs: [["FLAK"]] },
  {
    subject: "flyers",
    needs: [
      ["FLY", "FLIER", "FLIES", "FLYER", "AIR", "AERIAL", "AIRBORNE", "DRIFT"],
    ],
  },
  {
    subject: "that a Containment wave fields a single type",
    needs: [["WAVE"], ["TYPE", "KIND"]],
  },
  {
    subject: "the economy",
    needs: [["MONEY", "BOUNTY", "INTEREST", "CASH", "COIN", "EARN", "INCOME"]],
  },
];

/**
 * Whether some run carries a token beginning with `stem`, ignoring case.
 *
 * The token boundary is what keeps a stem honest: a stem of `AIR` is not answered
 * by `REPAIR`.
 */
function saysStem(texts: readonly string[], stem: string): boolean {
  const escaped = stem.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^A-Za-z0-9])${escaped}[A-Za-z]*`, "i");
  return texts.some((text) => pattern.test(text));
}

/** Whether some run carries a token beginning with ANY of `stems`. */
function saysAnyStem(
  texts: readonly string[],
  stems: readonly string[],
): boolean {
  return stems.some((stem) => saysStem(texts, stem));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("covers every subject the how-to screen is required to cover", async () => {
  poseMenu(h, "howto", 0);
  const calls = await drawFrame(h);
  captureStill(h, "howto");

  assertEqual(
    h.snapshot().screen,
    "howto",
    "posing: the screen the copy is read from (specs/screens.md)",
  );

  const copy = drawnText(calls);

  for (const { subject, needs } of SUBJECTS) {
    for (const alternatives of needs) {
      assertTrue(
        saysAnyStem(copy, alternatives),
        `the how-to screen to cover ${subject}, naming one of ` +
          `${alternatives.join(", ")} (specs/screens.md, \`howto\`); the text ` +
          `drawn was ${JSON.stringify(copy.join(" "))}`,
      );
    }
  }
});
