// screens/program-lists-the-action-steps — the tape editor lists each action step
// in its place in the tape, its action legible.
//
// specs/ui.md § Program: "`program` shows the same yard and readouts, with the
// tape editor over it: the steps in order, each move's commands and each action
// legible, and the editing the tape editor offers". specs/program.md gives the
// two actions a tape step can carry, `attach` and `release`.
//
// THE READING IS A SWAP, and that is what makes it decide the point. The same
// screen draws add-a-step widgets that carry those very words, so "the word
// attach is on the screen somewhere" would pass a build whose tape list is
// empty. So the tape is read twice — an `attach` then a `release`, and then a
// `release` then an `attach` behind the same move step — and what is looked for
// is a pair of places on the screen whose words SWAPPED with the steps: the
// place the second step is listed at says attach in one tape and release in the
// other, and the place the third step is listed at says the opposite. Only a
// screen that lists each action step where that step stands in the tape does
// that; a palette of buttons does not move.
//
// The move step in front of them is there so the actions are not the tape's
// first steps, and the tape is posed through the tape operations rather than
// through the widgets, so what is read is the listing and not the editing.

import { afterEach, beforeEach, it } from "vitest";
import { drawnTextRuns } from "../case-harness/index";
import { fail } from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Two runs are drawn in the same place when their anchors sit this close. */
const ANCHOR_TOL = 3;

/** Two runs are on one line when their anchors sit this close in `y`. */
const LINE_TOL = 4;

/** The move step the two action steps follow. */
const MOVE: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 90, rate: 30 }],
};

/**
 * Every run of text the last closed frame drew, with where it landed.
 *
 * The runs are the LOGICAL ones the frame spells, each placed where its first
 * draw was, never the `fillText` split: a build that letter-spaces a label or
 * a figure draws a glyph per call, which is the only portable way to
 * letter-space canvas text, and a line assembled from those glyphs reads `1 2`
 * where the screen says `12`. `screenCalls` carries the measured geometry the
 * shared merge rule (`case-harness/text.ts`) needs to put side-by-side glyphs
 * on one baseline back together, and every raw string is a substring of its
 * run, so coalescing can only add a match.
 */
async function frameDraws(harness: Harness) {
  return drawnTextRuns(await harness.screenCalls()).sort((a, b) =>
    Math.abs(a.y - b.y) > LINE_TOL ? a.y - b.y : a.x - b.x,
  );
}

/** Letters and digits alone, lowercased. */
function bare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Whether a run names that action and not the other. */
function names(text: string, action: "attach" | "release"): boolean {
  const other = action === "attach" ? "release" : "attach";
  return bare(text).includes(action) && !bare(text).includes(other);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lists each action step where that step stands in the tape", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await poseTape(h, [
    MOVE,
    { kind: "action", action: "attach" },
    { kind: "action", action: "release" },
  ]);
  await h.debug.setScreen("program");
  await h.advance(1);
  const attachFirst = await frameDraws(h);
  await h.capture("program-actions", "The action steps listed");

  await h.debug.clearProgram();
  await poseTape(h, [
    MOVE,
    { kind: "action", action: "release" },
    { kind: "action", action: "attach" },
  ]);
  await h.advance(1);
  const releaseFirst = await frameDraws(h);

  const samePlace = (
    one: { x: number; y: number },
    two: { x: number; y: number },
  ): boolean =>
    Math.abs(one.x - two.x) <= ANCHOR_TOL &&
    Math.abs(one.y - two.y) <= ANCHOR_TOL;

  const listed = attachFirst.some((second, at) =>
    attachFirst
      .slice(at + 1)
      .some(
        (third) =>
          names(second.text, "attach") &&
          names(third.text, "release") &&
          releaseFirst.some(
            (swapped) =>
              samePlace(swapped, second) && names(swapped.text, "release"),
          ) &&
          releaseFirst.some(
            (swapped) =>
              samePlace(swapped, third) && names(swapped.text, "attach"),
          ),
      ),
  );

  if (!listed) {
    fail(
      "the tape editor to list each action step where that step stands in " +
        "the tape, so the two places the second and third steps are listed " +
        "at name attach then release for one tape and release then attach " +
        "for the other (specs/ui.md § Program)",
      `with attach then release it drew ${JSON.stringify(
        attachFirst.map((draw) => draw.text),
      )}, and with release then attach ${JSON.stringify(
        releaseFirst.map((draw) => draw.text),
      )}`,
    );
  }
});
