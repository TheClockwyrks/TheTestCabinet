// screens/howto-content — the how-to screen covers the eight subjects the case
// requires of it.
//
// THE RULE. specs/screens.md's `howto` section: it "Covers the goal of the game,
// the controls, heat as power and the redline trip, the Forge and the Sink, the
// heat-averse Rime, flyers and the air-only Flak, that a Containment wave fields a
// single type, and the economy."
//
// THE COPY IS THE BUILD'S; THE VOCABULARY IS THE CASE'S. specs/screens.md fixes no
// wording for this screen and specs/overview.md fixes no typeface or layout, so
// nothing here reads a sentence, a length or a position. What each subject is
// decided by is the case's OWN NAME for the thing: the Forge, the Sink, the Rime
// and the Flak are named towers of specs/towers.md; the redline and the trip are
// named in specs/heat.md; the vent, the exhaust, the lives, the interest and the
// bounty are named in specs/floor.md, specs/waves.md and specs/economy.md. A
// screen that covers a subject in this game names the thing the game calls it, and
// a screen that never says "Rime" has not told a player about the Rime.
//
// EACH SUBJECT IS ASSERTED ON ITS OWN, so a screen that covers seven of the eight
// fails naming the one it left out rather than failing as a whole.
//
// TWO SUBJECTS ARE COUNTED RATHER THAN REQUIRED WHOLE. "The controls" and "the
// economy" are each a handful of separate things, and specs/screens.md asks the
// screen to cover the subject, not to enumerate every member of it. So each of
// those is a list of the case's own names with a bar below its length: a screen
// naming most of the controls has covered the controls, and one naming none of
// them has not. The bar is stated with the subject and derived there.
//
// THE WHOLE FRAME'S TEXT IS ONE BODY. A build wraps its copy into lines however it
// likes, and a phrase can fall across two of them, so the runs of text the frame
// drew are joined with spaces before they are read. The screen is posed with
// `setScreen`, which runs no entry effect (specs/instrumentation.md); how the
// screen is reached is `screens.title-to-howto`'s requirement and how it is left is
// `screens.back-from-howto`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnText,
  type Harness,
} from "../harness";
import { poseMenu } from "./menu";

/** One subject specs/screens.md requires the screen to cover. */
interface Subject {
  /** The subject, as specs/screens.md names it. */
  name: string;
  /** The case's own names for the things that subject is made of. */
  names: readonly RegExp[];
  /** How many of them must appear. Defaults to all of them. */
  atLeast?: number;
}

/**
 * The eight subjects, in the order specs/screens.md lists them.
 *
 * Every pattern below is a word the specifications themselves use for the thing:
 * nothing here asks a build for a phrase the case never fixed.
 */
const SUBJECTS: readonly Subject[] = [
  {
    // "the goal of the game": specs/waves.md's run, entered at a vent
    // (specs/floor.md) and paid for in lives when a unit reaches its exhaust.
    name: "the goal",
    names: [/\bvent/i, /\bexhaust/i, /\blives?\b/i],
  },
  {
    // "the controls": the actions specs/controls.md names. Four of the seven is
    // the bar — a screen naming more than half the vocabulary has covered the
    // controls, and one naming three or fewer has left a player without the means
    // to build, sell or send.
    name: "the controls",
    names: [
      /\bplac/i,
      /\brotat/i,
      /\bsell/i,
      /\bupgrad/i,
      /\bsend/i,
      /\bpaus/i,
      /\bmut/i,
    ],
    atLeast: 4,
  },
  {
    // "heat as power and the redline trip": specs/heat.md's own three words.
    name: "heat as power and the redline trip",
    names: [/\bheat/i, /\bredline/i, /\btrip/i],
  },
  {
    // "the Forge and the Sink": the two movers of specs/towers.md, by name.
    name: "the Forge and the Sink",
    names: [/\bforge/i, /\bsink/i],
  },
  {
    // "the heat-averse Rime": the tower by name, and the fact that sets it apart
    // — specs/towers.md's Rime is at its strongest cold.
    name: "the heat-averse Rime",
    names: [/\brime/i, /\bcold|\bcool/i],
  },
  {
    // "flyers and the air-only Flak": specs/surge.md's flying units and the one
    // tower specs/combat.md lets shoot them.
    name: "flyers and the air-only Flak",
    names: [/\bflak/i, /\bair\b|\bfl(y|ies|ying|yer)/i],
  },
  {
    // "that a Containment wave fields a single type": specs/waves.md's rule, in
    // its own words.
    name: "that a wave fields one type",
    names: [/\bwave/i, /\b(a single|one) type/i],
  },
  {
    // "the economy": specs/economy.md's payments. Two of the three named payments
    // beside the money itself is the bar — a screen naming money and nothing it is
    // earned by has not covered the economy.
    name: "the economy",
    names: [/\bmoney/i, /\bbount/i, /\bbonus/i, /\binterest/i],
    atLeast: 3,
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
  poseMenu(h, "howto", 0);
  const calls = await drawFrame(h);
  captureStill(h, "howto");

  assertEqual(
    h.snapshot().screen,
    "howto",
    "posing: the screen the copy is read from (specs/screens.md)",
  );

  const copy = drawnText(calls).join(" ");
  for (const subject of SUBJECTS) {
    const found = subject.names.filter((pattern) => pattern.test(copy));
    const bar = subject.atLeast ?? subject.names.length;
    assertGreaterThanOrEqual(
      found.length,
      bar,
      `the how-to screen covers ${subject.name}: ${bar} of the ` +
        `${subject.names.length} names the case uses for it, ` +
        `[${subject.names.map(String).join(", ")}], drawn somewhere on the ` +
        `screen (specs/screens.md); the text drawn was ${JSON.stringify(copy)}`,
    );
  }
});
