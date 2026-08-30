// handling/held-run-follows-pointer — a held run travels exactly as far as the
// pointer does, across a whole sweep of the table.
//
// `specs/controls.md` fixes it: "The run holds the position the pointer gives it:
// it keeps the offset between the press point and the leading card's top-left,
// so the run travels exactly as far as the pointer does".
//
// WHAT IS MEASURED, AND WHY IT IS THE FAIR READING. The offset is taken from the
// run the BUILD reports on the press, and every later sample is held against that
// offset. So this decides the rule the item names — that the run keeps whatever
// offset the press gave it — and charges nothing for where the build drew the
// card to begin with, which is `table/column-anchors` and `table/tableau-anchor-y`
// to grade.
//
// WHAT THE PRESS POINT DISTINGUISHES. It lands near the card's own corner rather
// than at its centre, so the offset is large. A build that recentres the run on
// the pointer reports a position `CARD_W / 2` and `CARD_H / 2` away from the rule's,
// which is far outside the tolerance below; a build that moves the run by some
// fraction of the pointer's travel drifts further from it at every sample.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, assertNotNull } from "../assert";
import {
  card,
  captureReplay,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { COLUMN_X, TABLEAU_Y } from "../constants";

/** The column the scenario poses, holding one card and nothing else. */
const COLUMN = 0;
const HELD = "KS";

/** Where the press lands, five units in from the card's own top-left corner. */
const PRESS_INSET = 5;

/** Where the sweep carries the pointer, well clear of where it started. */
const SWEEP_TO = { x: 1000, y: 480 };

/** How the sweep is delivered: samples, and the frames drawn between them. */
const SWEEP_SAMPLES = 24;
const FRAMES_PER_SAMPLE = 5;

/**
 * How far the run's reported top-left may sit from the offset the press gave it.
 *
 * `specs/controls.md` fixes the travel exactly, so the only slack a conformant
 * build needs is rounding: half a logical unit admits a build that keeps a card's
 * position in whole units, and is a five-hundredth of the `100 x 140` footprint
 * `specs/table.md` fixes, far too small to hide a run that is following the
 * pointer by any other rule.
 */
const POSITION_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the held run with the pointer, sample after sample", async () => {
  await openTable(h);
  await poseColumn(h, COLUMN, [card(HELD)]);

  const pressX = COLUMN_X[COLUMN] + PRESS_INSET;
  const pressY = TABLEAU_Y + PRESS_INSET;
  await h.debug.pointerDown(pressX, pressY);

  const lifted = (await h.snapshot()).drag;
  assertNotNull(lifted, "the run in hand on the press");
  if (lifted === null) return;
  // The offset the build itself took, which the rule says it keeps.
  const offsetX = pressX - lifted.x;
  const offsetY = pressY - lifted.y;

  await captureReplay(h, "sweep", async () => {
    for (let step = 1; step <= SWEEP_SAMPLES; step += 1) {
      const at = step / SWEEP_SAMPLES;
      const x = pressX + (SWEEP_TO.x - pressX) * at;
      const y = pressY + (SWEEP_TO.y - pressY) * at;
      await h.debug.pointerMove(x, y);
      await h.advance(FRAMES_PER_SAMPLE);

      const held = (await h.snapshot()).drag;
      assertNotNull(held, `the run still in hand at sample ${step}`);
      if (held === null) return;
      assertLessThanOrEqual(
        Math.abs(x - held.x - offsetX),
        POSITION_TOLERANCE,
        `sample ${step}: the run's x against the offset the press gave it`,
      );
      assertLessThanOrEqual(
        Math.abs(y - held.y - offsetY),
        POSITION_TOLERANCE,
        `sample ${step}: the run's y against the offset the press gave it`,
      );
    }
  });
});
