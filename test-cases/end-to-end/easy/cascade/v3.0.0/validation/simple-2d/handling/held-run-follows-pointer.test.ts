// handling/held-run-follows-pointer — a held run travels exactly as far as the
// pointer does.
//
// specs/controls.md: "The run holds the position the pointer gives it: it keeps the
// offset between the press point and the leading card's top-left, so the run travels
// exactly as far as the pointer does". `snapshot().drag.x`/`.y` are the top-left of
// `cards[0]` (specs/instrumentation.md), so the rule reads as an equation that must
// hold at every sample of a sweep:
//
//   drag.x = pointer.x - (press.x - top-left at the press)
//
// THE PRESS IS DELIBERATELY OFF-CENTER. Pressing a card at its center makes the
// offset the half-card `(50, 70)`, which is exactly what a build that CENTERS the
// run on the pointer would produce, and the two models would read the same number
// all the way across the sweep. The press below lands `(20, 30)` inside the card's
// top-left corner, so the three models a build might have implemented read three
// different positions: keeping the press offset gives `pointer - (20, 30)`,
// centering on the pointer gives `pointer - (50, 70)`, and snapping the card's
// corner to the pointer gives `pointer` itself.
//
// ONE CARD IS THE WHOLE WORLD, and the sweep crosses only bare table and empty
// slots, so nothing the run passes over can move it or take it. The sweep is driven
// a frame at a time so the recording shows the run travelling rather than jumping,
// and the reading is taken after each frame.
//
// WHAT THIS DOES NOT DECIDE. Which cards the press picked up
// (`handling/press-grabs-column-run`), what the run is drawn over
// (`presentation/held-run-drawn-above`), and where a release lands it
// (`handling/release-on-legal-completes`). This point reads the position alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertNotNull } from "../assert";
import { COLUMN_X, TABLEAU_Y } from "../constants";
import {
  captureReplay,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
  type Point,
} from "../harness";

/** The column the one card stands in, and that card. */
const COLUMN = 0;
const CARD = "5H";

/** Where the press lands inside the card, measured from its top-left. */
const PRESS_OFFSET = { x: 20, y: 30 };

/** Where the sweep ends: a long diagonal across the table, well clear of any pile. */
const SWEEP_TO: Point = { x: 900, y: 500 };

/** How many pointer samples the sweep is divided into, one frame apart. */
const STEPS = 8;

/**
 * How far the reported top-left may lie from the position the pointer gives it, in
 * logical units.
 *
 * The rule is exact arithmetic — a sum of the pointer's own displacements — so a
 * conforming build owes the figure to the last decimal. Half a unit is allowed
 * anyway, because a build is free to hold the run's position in whole units, and
 * nothing is lost by it: every wrong model of this rule is off by `20` units or
 * more, and a build that leaves the run behind is off by hundreds.
 */
const POSITION_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries the held run by the pointer's own displacement across a sweep", async () => {
  openTable(h);
  poseColumn(h, COLUMN, [CARD]);

  const press: Point = {
    x: COLUMN_X[COLUMN] + PRESS_OFFSET.x,
    y: TABLEAU_Y + PRESS_OFFSET.y,
  };
  h.debug.pointerDown(press.x, press.y);
  assertNotNull(
    h.snapshot().drag,
    `the run in hand after the press on the ${CARD}, which is what the sweep ` +
      "then carries (specs/controls.md)",
  );

  const samples = await captureReplay(h, "sweep", async () => {
    const seen: { at: Point; drag: Point | null }[] = [];
    for (let step = 1; step <= STEPS; step += 1) {
      const t = step / STEPS;
      const at: Point = {
        x: press.x + (SWEEP_TO.x - press.x) * t,
        y: press.y + (SWEEP_TO.y - press.y) * t,
      };
      h.debug.pointerMove(at.x, at.y);
      await h.advance(1);
      const drag = h.snapshot().drag;
      seen.push({ at, drag: drag === null ? null : { x: drag.x, y: drag.y } });
    }
    return seen;
  });

  for (const [step, sample] of samples.entries()) {
    const where = `sample ${step + 1} of ${STEPS}, pointer at (${sample.at.x}, ${sample.at.y})`;
    assertNotNull(
      sample.drag,
      `the run still in hand at ${where}: a move carries the run, it does not ` +
        "end the gesture (specs/controls.md)",
    );
    const drag = sample.drag ?? { x: Number.NaN, y: Number.NaN };
    const owed: Point = {
      x: sample.at.x - PRESS_OFFSET.x,
      y: sample.at.y - PRESS_OFFSET.y,
    };
    assertBetween(
      drag.x,
      owed.x - POSITION_TOLERANCE,
      owed.x + POSITION_TOLERANCE,
      `${where}: the leading card's top-left x, which keeps the ` +
        `${PRESS_OFFSET.x}-unit offset the press made (specs/controls.md)`,
    );
    assertBetween(
      drag.y,
      owed.y - POSITION_TOLERANCE,
      owed.y + POSITION_TOLERANCE,
      `${where}: the leading card's top-left y, which keeps the ` +
        `${PRESS_OFFSET.y}-unit offset the press made (specs/controls.md)`,
    );
  }
});
