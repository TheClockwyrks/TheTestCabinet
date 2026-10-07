// presentation/overlay-shows-drag — the overlay reports the drag.
//
// THE RULE. specs/instrumentation.md, "Diagnostics": the build registers
// "whether a run is in hand and how many cards it holds" among the values the
// debug overlay shows. Under this engine registering it is the whole of
// Cascade's part; the panel is the engine's.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. That the panel reports the drag,
// and reports it as the drag CHANGES: a build whose line never moves has not
// reported it. The pile counts are `overlay-shows-pile-counts`, the screen is
// `overlay-shows-screen` and the cascade is `overlay-shows-cascade`.
//
// HOW BOTH HALVES OF THE ROW ARE READ AT ONCE. The panel is read twice over one
// board — once with nothing in hand, once with a run of five held — and what
// must carry the held count is a line the IDLE panel did not carry. So a build
// that prints a fixed `drag: none` fails on "whether a run is in hand", and a
// build that prints a live line but no count fails on "how many cards it holds",
// while a build that prints both passes. A single reading of the held board
// could have been answered by any line that happened to hold a five.
//
// FIVE IS THE DISTINGUISHING VALUE. The column is posed as a face-down card
// under a run of five, so the board carries a six before the press and a one
// after it, and every other pile is empty, so no figure the board gives the
// panel is five but the run in hand. A build reporting the column it came from,
// or the cards left behind, reads as a different number rather than as this one.
// The reading is over the lines the press ADDED, so a source of the build's own
// that happens to carry a five while idle is not what is read.
//
// THE RUN IS LIFTED BY A REAL PRESS on the run's topmost face-up card, which
// specs/controls.md has take that card and every face-up card below it, so the
// hand holds exactly the five the column's run has. Nothing here poses a drag.
//
// A CONTROL PAIR NAMES WHAT THE PANEL MOVES ON ITS OWN. specs/instrumentation.md
// fixes what the panel shows AT LEAST, so a build may register more, and a frame
// count or a frame time moves with nothing in hand: its line is new at every
// reading and would carry any figure sooner or later. So the idle panel is read
// twice, a second of the driven clock apart, and a line whose shape — its text
// with every run of digits blanked — differed between the two is set aside
// before the held panel's added lines are searched for the count.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles, and one column is
// posed. Nothing else is on the table.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  alternatingRun,
  captureStill,
  card,
  createHarness,
  framesFor,
  down,
  grabPoint,
  KING,
  openTable,
  poseColumn,
  pressAt,
  TEN,
  toggleOverlay,
  type Harness,
} from "../harness";
import {
  linesAdded,
  linesCarrying,
  overlayLines,
  restlessShapes,
  settledLines,
} from "./overlay";

/** The column posed, and where in it the press lands. */
const COLUMN = 0;

/**
 * How far apart the two control readings of the idle panel are taken: a second
 * of the driven clock, so a clock drawn to whole seconds moves inside it.
 */
const CONTROL_SPAN = 1;

/** How many cards the run holds: the figure the panel must carry. */
const RUN = 5;

/**
 * The column: a face-down card with a descending, colour-alternating run of five
 * face-up cards below it, which specs/tableau.md has move as a unit.
 */
const BURIED = down(card("spades", KING));
const FACE_UP = alternatingRun(TEN, RUN, "hearts");

/** The row the press lifts from: the topmost of the face-up cards. */
const GRAB_ROW = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the live drag and the cards it holds on the overlay", async () => {
  openTable(h);
  poseColumn(h, COLUMN, [BURIED, ...FACE_UP]);

  const beforeIdle = await h.drawFrame();
  const afterIdle = await toggleOverlay(h);
  const idle = overlayLines(beforeIdle, afterIdle);

  // The control pair: the same idle panel read again, a second of the driven
  // clock on, with nothing moved. Whatever differs is what the panel moves on
  // its own, and no line of that shape may carry the figure below, however it
  // happens to read at the moment.
  await h.advance(framesFor(CONTROL_SPAN));
  const beforeAgain = await toggleOverlay(h);
  const afterAgain = await toggleOverlay(h);
  const restless = restlessShapes(idle, overlayLines(beforeAgain, afterAgain));

  const grab = grabPoint(h.snapshot(), COLUMN, GRAB_ROW);
  pressAt(h, grab.x, grab.y);
  assertEqual(
    h.snapshot().drag?.cards.length,
    RUN,
    "the press to lift the whole face-up run (specs/tableau.md: a grab takes " +
      "the pressed face-up card and every face-up card below it)",
  );

  const beforeHeld = await toggleOverlay(h);
  const afterHeld = await toggleOverlay(h);
  captureStill(h, "overlay");
  const held = overlayLines(beforeHeld, afterHeld);

  const changed = settledLines(linesAdded(idle, held), restless);
  assertTrue(
    linesCarrying(changed, RUN) > 0,
    `a line the panel drew only once the run was in hand, carrying the ` +
      `${String(RUN)} cards it holds (specs/instrumentation.md: register ` +
      "whether a run is in hand and how many cards it holds) — the panel's " +
      `idle lines were ${JSON.stringify(idle)} and its lines with the run in ` +
      `hand were ${JSON.stringify(held)}; ${String(restless.size)} line ` +
      `shape(s) that moved with nothing in hand were set aside`,
  );
});
