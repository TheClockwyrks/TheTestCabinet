// handling/drop-target-highlights — the pile a held run would land on is reported.
//
// specs/controls.md: "While a run is held, the pile that would accept it, if any, is
// the drop target, and it is drawn as highlighted. A pile is the drop target only
// while the release rule below would resolve the run to it and that pile accepts the
// run. The target is recomputed as the pointer moves."
// specs/instrumentation.md reports it as `dropTarget`, `{ pile, index }` or `null`.
//
// THE SWEEP CARRIES THE RUN ONTO THE TARGET, so what is read is the target the run
// is over at the end of it rather than a target reported from the moment of the
// press. The run starts over its own column, which cannot be the target — the run
// left it as it entered the hand (specs/controls.md), so the column is empty and an
// empty column takes a King alone (specs/tableau.md) — and arrives over a column
// whose lowest card accepts it.
//
// THE TARGET ACCEPTS BY THE TABLEAU RULE. specs/tableau.md has a column whose lowest
// card is the black six accept a run led by the red five, which is the pair posed
// here; the same pair released one item along, in
// `handling/release-on-legal-completes`, is what makes the reported target and the
// completed move two readings of one rule rather than one.
//
// WHERE THE RUN IS RELEASED FROM. The press is at the card's center and the sweep
// ends at the center of the target's drop rectangle (specs/table.md), so the leading
// card's center lands on that rectangle's center — as far inside it as a point can
// be, which is what keeps this point about the REPORT rather than about the edge of
// a rectangle. `handling/drop-target-by-position` is the item that grades the edge.
//
// WHAT THIS DOES NOT DECIDE. That the highlight is drawn is
// `presentation/drop-highlight-visible`; that a pile which refuses the run is not
// reported is `handling/no-highlight-illegal`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import {
  captureReplay,
  createHarness,
  openTable,
  poseColumn,
  pressPoint,
  releasePoint,
  type Harness,
  type Point,
} from "../harness";

/** The column the run is lifted from, and the run: one red five. */
const FROM_COLUMN = 0;
const RUN = "5H";

/** The column it is carried to, and its lowest card: a black six, which accepts. */
const TO_COLUMN = 3;
const TARGET = "6S";

/** How many pointer samples the sweep is divided into, one frame apart. */
const STEPS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the column under the held run as the drop target", async () => {
  openTable(h);
  poseColumn(h, FROM_COLUMN, [RUN]);
  poseColumn(h, TO_COLUMN, [TARGET]);

  const press = pressPoint(h.snapshot(), "tableau", FROM_COLUMN, 0);
  const over = releasePoint(h.snapshot(), "tableau", TO_COLUMN);
  h.debug.pointerDown(press.x, press.y);

  const held = await captureReplay(h, "highlight", async () => {
    for (let step = 1; step <= STEPS; step += 1) {
      const t = step / STEPS;
      const at: Point = {
        x: press.x + (over.x - press.x) * t,
        y: press.y + (over.y - press.y) * t,
      };
      h.debug.pointerMove(at.x, at.y);
      await h.advance(1);
    }
    return h.snapshot();
  });

  assertNotNull(
    held.drag,
    `the run in hand over column ${TO_COLUMN}: the target is the pile a HELD ` +
      "run would land on (specs/controls.md)",
  );
  assertDeepEqual(
    held.dropTarget,
    { pile: "tableau", index: TO_COLUMN },
    `the drop target while the ${RUN} is over column ${TO_COLUMN}, whose ` +
      `lowest card is the ${TARGET} and which therefore accepts it ` +
      "(specs/controls.md, specs/tableau.md)",
  );
});
