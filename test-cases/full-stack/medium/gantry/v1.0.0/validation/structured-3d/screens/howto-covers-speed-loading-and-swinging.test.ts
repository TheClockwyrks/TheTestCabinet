// screens/howto-covers-speed-loading-and-swinging — the how-to ties a command's
// speed to the load on the structure and to the swing.
//
// specs/ui.md, "How to play": "`howto` explains the game in a player's words:
// … why speed loads the structure and swings the load …". This point is that
// item, and the word "why" is what it turns on: the copy has to JOIN the speed
// to the two consequences rather than mention all three somewhere.
//
// THE TIE IS WHAT IS CHECKED, and it is checked as nearness. The game names a
// command's speed in two places and neither of them is this explanation —
// specs/program.md gives every command a `rate`, and specs/ui.md gives the run
// screen a watch speed cycled by `speed` — so a copy that mentioned "speed" in
// its list of keys and "swing" in its account of the rigging would satisfy any
// check that only asked whether both words appear. So a speed word and each
// consequence have to fall inside one WINDOW of the copy, which is long enough
// to hold a heading and the sentences under it and far short of the whole
// screen.
//
// THE CONSEQUENCES ARE THE SPECIFICATION'S. specs/statics.md makes a commanded
// axis's acceleration an inertial load on the structure and specs/rigging.md
// swings the bob on the pivot the trolley and the arm carry, so what the copy
// owes a player is that a brisker command works the structure harder and swings
// the load wider. Each is asked for as its own vocabulary — the structure, its
// members, the crane; the swing — with no wording imposed on either.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { drawnText, toDrawCall, type RecordedOp } from "../case-harness/index";
import { createHarness, type Harness } from "../harness";

/** A command's speed, however the copy names it. */
const SPEED = [
  /\bspeeds?\b/i,
  /\brates?\b/i,
  /\bfast(er)?\b/i,
  /\bbrisk(ly)?\b/i,
  /\bquick(ly|er)?\b/i,
  /\bhurry\b/i,
  /\bhard(er)?\b/i,
  /\bslow(ly|er)?\b/i,
];

/** The two consequences specs/ui.md names, in the game's own vocabulary. */
const CONSEQUENCES = [
  {
    topic: "the load a command's speed puts on the structure",
    terms: [
      /\bstructure\b/i,
      /\bmembers?\b/i,
      /\bcrane\b/i,
      /\bsteel\b/i,
      /\bstress/i,
      /\bstrain/i,
    ],
  },
  {
    topic: "the load swinging",
    terms: [/\bswing/i, /\bswung\b/i, /\bsways?\b/i, /\bswaying\b/i],
  },
];

/**
 * Characters two terms may stand apart and still be one explanation.
 *
 * A heading and the three or four lines under it, and a small fraction of a
 * screen of copy: on the copy this point reads it is the difference between two
 * words in one passage and two words on two different topics.
 */
const WINDOW = 320;

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

/** Every run of text the how-to screen drew, folded into one block. */
async function howtoCopy(h: Harness): Promise<string> {
  await h.debug.setScreen("howto");
  await h.advance(1);
  const ops = (await h.screenOps()) as RecordedOp[];
  return drawnText(ops.map(toDrawCall)).join("\n");
}

/** Where every one of `terms` matches in `copy`. */
function hits(copy: string, terms: readonly RegExp[]): number[] {
  const at: number[] = [];
  for (const term of terms) {
    const scan = new RegExp(term.source, `${term.flags.replace("g", "")}g`);
    for (const match of copy.matchAll(scan)) at.push(match.index ?? 0);
  }
  return at;
}

/** Whether some speed word and some `terms` word fall inside one window. */
function tied(copy: string, terms: readonly RegExp[]): boolean {
  const speeds = hits(copy, SPEED);
  return hits(copy, terms).some((there) =>
    speeds.some((speed) => Math.abs(speed - there) <= WINDOW),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ties a command's speed to the load on the structure and to the swing", async () => {
  const copy = await howtoCopy(h);
  assertGreaterThan(
    copy.length,
    0,
    "the length of the copy the how-to screen drew (specs/ui.md)",
  );

  const untied = CONSEQUENCES.filter(({ terms }) => !tied(copy, terms))
    .map(({ topic }) => topic)
    .join("; ");
  assertEqual(
    untied,
    "",
    "what the how-to copy leaves untied to a command's speed, of the load it " +
      "puts on the structure and the load swinging (specs/ui.md)",
  );

  await h.capture("howto-speed", "The how-to copy on speed");
});
