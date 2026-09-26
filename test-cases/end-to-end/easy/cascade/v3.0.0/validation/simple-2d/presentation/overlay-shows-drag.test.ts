// presentation/overlay-shows-drag — the overlay reports the run in hand.
//
// THE RULE. specs/instrumentation.md, "Diagnostics", lists among the sources the
// build registers: "whether a run is in hand and how many cards it holds". Under
// this engine "Registering those values is the whole of Cascade's part, through
// `InitApi.diagnostics`", so what this point decides is that the build registered
// those two.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. That the panel reports the drag, and
// reports it as the drag CHANGES: a build whose line never moves has not reported
// it. The screen and the mode are `presentation/overlay-shows-screen`, the pile
// counts `presentation/overlay-shows-pile-counts`, and the cascade
// `presentation/overlay-shows-cascade`. That watching the panel costs the game
// nothing is the engine's under this engine and is graded on `none` alone. What
// the run in hand LOOKS like is `presentation/held-run-drawn-above`, and what a
// press lifts is `handling.press-grabs-column-run`.
//
// HOW BOTH HALVES OF THE RULE ARE READ AT ONCE. The panel is read twice over one
// board — once with nothing in hand, once with the run held — and what must carry
// the held count is a line the IDLE panel did not carry. So a build that prints a
// fixed `drag: none` and no count fails on "whether a run is in hand", a build
// that prints a live line but no count fails on "how many cards it holds", and a
// build that prints both passes — whether it registered a boolean the engine
// draws as `true` beside a count, a word of its own, or one value reading
// `4 cards`. specs/instrumentation.md fixes no spelling and no split into two
// sources, so the reading asks for the dependence and never for a word. A single
// reading of the held board could have been answered by any line that happened
// to hold the figure.
//
// FOUR IS THE DISTINGUISHING VALUE. The column is posed as a face-down card under
// a run of four, so the board carries a five before the press and a one after it,
// and every other pile is empty, so no figure the board gives the panel is four
// but the run in hand. A build reporting the column it came from, or the cards
// left behind, reads as a different number rather than as this one, and a run of
// one card would have been a figure a build could carry by accident. The reading
// is over the lines the press ADDED, so a source of the build's own that happens
// to carry a four while idle is not what is read.
//
// THE PRESS LANDS IN THE RUN'S TOP CARD'S EXPOSED BAND. specs/controls.md
// resolves a press to "the card drawn over every other card at the press point,
// which in a column is the lowest of the cards whose footprint contains that
// point", so a press at that card's CENTRE would land on the card fanned below it
// and lift a shorter run. The press is therefore aimed at the band of the run's
// first card that the second does not cover, which the harness's column geometry
// gives; that is aiming, and nothing about the fan is graded here.
//
// THE VALUE IS READ, NEVER THE NAME. The engine draws a line as `${name}: ${value}`
// and the name is the build's own word, so a build whose sources are named
// `col4` or `four` does not have its names counted as figures.
//
// A CONTROL PAIR NAMES WHAT THE PANEL MOVES ON ITS OWN. specs/instrumentation.md
// fixes what the panel shows AT LEAST, so a build may register more, and a frame
// count or a frame time moves with nothing in hand: its line is new at every
// reading and would carry any figure sooner or later. So the idle panel is read
// twice, a second of the driven clock apart, and a line whose shape — its text
// with every run of digits blanked — differed between the two is set aside
// before the held panel's added lines are searched for the count.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles; one column is posed
// and its face-up run is lifted by a real press through the debug surface, which
// specs/instrumentation.md feeds into the same input path a player's pointer
// feeds. Nothing else is on the table, and nothing here poses a drag.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { CARD_W } from "../constants";
import {
  captureStill,
  columnCardTopLeft,
  createHarness,
  framesFor,
  drawFrame,
  faceUpGap,
  facesOf,
  openTable,
  pileOf,
  poseColumn,
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

/** The card buried under the run, so the column's idle count is not the run's. */
const BURIED = "#2C";

/** The run posed, in run order: each card one lower and the other colour. */
const RUN = ["KS", "QH", "JC", "10D"];
const COLUMN = 0;

/**
 * How far apart the two control readings of the idle panel are taken: a second
 * of the driven clock, so a clock drawn to whole seconds moves inside it.
 */
const CONTROL_SPAN = 1;

/** The row the press lifts from: the run's topmost card, under the buried one. */
const GRAB_ROW = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws whether a run is in hand and how many cards it holds", async () => {
  openTable(h);
  poseColumn(h, COLUMN, [BURIED, ...RUN]);

  const beforeIdle = await drawFrame(h);
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

  // The band of the run's first card that the card fanned below it does not
  // cover, so the press lifts the whole run rather than part of it.
  const faces = facesOf(pileOf(h.snapshot(), "tableau", COLUMN));
  const top = columnCardTopLeft(COLUMN, GRAB_ROW, faces);
  h.debug.pointerDown(top.x + CARD_W / 2, top.y + faceUpGap(faces) / 2);

  const held = h.snapshot().drag;
  assertEqual(
    held?.cards.length,
    RUN.length,
    `the cards a press at the top of column ${String(COLUMN)}'s run lifted ` +
      "(specs/controls.md: a press on a face-up card in a column lifts that " +
      "card and every card below it) — the board this point reads is one with " +
      "the whole run in hand",
  );

  // The panel is up from the idle reading; one toggle takes it down, the next
  // brings it back over the held board.
  const beforeHeld = await toggleOverlay(h);
  const afterHeld = await toggleOverlay(h);
  captureStill(h, "overlay");
  const lines = overlayLines(beforeHeld, afterHeld);

  const changed = settledLines(linesAdded(idle, lines), restless);
  assertTrue(
    linesCarrying(changed, RUN.length) > 0,
    "a line the panel drew only once the run was in hand, carrying the " +
      `${String(RUN.length)} cards it holds (specs/instrumentation.md: register ` +
      "whether a run is in hand and how many cards it holds) — the panel's " +
      `idle lines were ${JSON.stringify(idle)} and its lines with the run in ` +
      `hand were ${JSON.stringify(lines)}; ${String(restless.size)} line ` +
      `shape(s) that moved with nothing in hand were set aside`,
  );
});
