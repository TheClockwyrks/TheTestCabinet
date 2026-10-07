// Facet — hud/hud-score: the playing screen draws the SCORE readout, and the
// figure beside the label is the score the state holds at that moment.
//
// specs/ui.md tables the readouts of the `playing` screen and gives this one a
// name of its own — `HUD_SCORE_LABEL` (`SCORE`) — against `state.score`. There
// are two halves to that, and a build can fail either: the label has to be on
// the frame, so a player knows what the figure beside it counts, and the figure
// has to BE the score rather than a caption drawn once. A build that prints
// `SCORE 0` for the whole round satisfies the first half and none of the point.
//
// WHY TWO POSED SCORES. One reading cannot tell a readout from a constant, and
// two can: the frame posed at 407 carries 407, and the frame posed at 912
// carries 912 and no longer carries 407. That second absence is what makes the
// pair a readout rather than a coincidence, and it is safe to read as an
// absence because the frame posed at 407 stands right beside it showing that
// this reading does find a score when one is on screen.
//
// WHY THESE TWO FIGURES. Three digits each, so no thousands separator a build
// is free to write can fall inside either figure and hide it from the reading.
// And neither occurs inside the other, nor inside the other figures the
// readouts around it are built from on this posed frame — the level (`1`), the
// level score (`0`) and the level target (`2000`) — so a `407` or a `912` on
// the frame came from the score and from nothing else.
//
// The board is posed rather than dealt because this point is not about what is
// on the board: the harness's `loadBoard` poses a board on `playing` with
// `phase` `idle` and leaves
// `score` where it stands, and `setScore` then writes the one figure under
// test. Nothing here settles a chain, so the round stays on `playing` for both
// readings even though the quiet filler carries no legal swap of its own.
//
// The copy is read off the frame's draw calls through the shared harness's
// `drewTextAnywhere`, which decides whether a string is among the runs of text
// they spell across every shape specs/ui.md leaves open — one call per line,
// one per word, one per glyph, or a figure drawn beside its label in a single
// run.

import { afterEach, beforeEach, it } from "vitest";
import { drawnTextLines, drewTextAnywhere } from "../case-harness/text";
import { assertEqual, fail } from "../assert";
import { quietBoard } from "../board";
import { HUD_SCORE_LABEL } from "../constants";
import {
  captureStill,
  createHarness,
  loadBoard,
  type DrawCall,
  type Harness,
} from "../harness";

/** The first posed score, and the second the readout has to follow to. */
const FIRST_SCORE = 407;
const SECOND_SCORE = 912;

let h: Harness;

/** The frame showed `wanted`, or the failure names it beside what it spelled. */
function requireCopy(
  frame: readonly DrawCall[],
  wanted: string,
  when: string,
): void {
  if (!drewTextAnywhere(frame, wanted)) {
    fail(
      `the frame at ${when} to show ${JSON.stringify(wanted)}`,
      drawnTextLines(frame),
    );
  }
}

/** The frame did not show `wanted`, or the failure names what it did spell. */
function refuseCopy(
  frame: readonly DrawCall[],
  wanted: string,
  when: string,
): void {
  if (drewTextAnywhere(frame, wanted)) {
    fail(
      `the frame at ${when} not to show ${JSON.stringify(wanted)}`,
      drawnTextLines(frame),
    );
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the score label and the score, and the figure follows the score", async () => {
  loadBoard(h, quietBoard());
  h.debug.setScore(FIRST_SCORE);

  // The state the frame below is read against: the playing screen, and the
  // score the surface was asked to pose. A build whose `setScore` did not take
  // fails here rather than at the reading, which says which of the two broke.
  const posed = h.snapshot();
  assertEqual(posed.screen, "playing", "the screen the readouts sit on");
  assertEqual(posed.score, FIRST_SCORE, "the posed score");

  // One frame, and everything it put on screen. The still is that same frame.
  const first = await h.frameCalls();
  captureStill(h, "hud");
  requireCopy(first, HUD_SCORE_LABEL, `a score of ${FIRST_SCORE}`);
  requireCopy(first, String(FIRST_SCORE), `a score of ${FIRST_SCORE}`);

  h.debug.setScore(SECOND_SCORE);
  assertEqual(h.snapshot().score, SECOND_SCORE, "the second score");

  // The readout followed: the new figure is on the frame and the old one has
  // left it, which a caption drawn once cannot do.
  const second = await h.frameCalls();
  requireCopy(second, HUD_SCORE_LABEL, `a score of ${SECOND_SCORE}`);
  requireCopy(second, String(SECOND_SCORE), `a score of ${SECOND_SCORE}`);
  refuseCopy(second, String(FIRST_SCORE), `a score of ${SECOND_SCORE}`);
});
