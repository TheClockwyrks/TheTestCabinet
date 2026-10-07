// parts/track-costs-five-per-cell — a track is charged by the cell, so its cost
// rises by one cell's price with every cell laid.
//
// THE RULE. `PART_COSTS` charges `track` "`5` per cell" (`specs/parts.md`,
// Costs), which is the one entry of the table that is not a flat per-part price.
// `parts.ts` states the same reading: "a track costs its entry per cell", so a
// track's cost is `PART_COSTS.track` times the length of its path. The path is
// what is counted: "A `track` is an ordered path of distinct hexes, `cells`, laid
// one hex at a time in the editor" (`specs/parts.md`, Track). The figure read is
// the machine's cost, which `specs/instrumentation.md` derives as "`PART_COSTS`
// over the parts, as `specs/parts.md` computes it" and `specs/editor.md` shows in
// the heading.
//
// THE CONFIGURATION. One challenge open in the editor, an empty machine, and one
// track laid a cell at a time along `(0, 0)`, `(1, 0)`, `(2, 0)`, `(3, 0)` —
// four cells in a straight line east, every one of them on the field and every
// consecutive pair adjacent, so each step is a legal extension of a legal path.
// `specs/instrumentation.md` gives the laying one operation per step —
// `placeTrack` "places a one-cell open track" and `extendTrack` "appends `(q, r)`
// to that track's path at its `last` end" — and this check drives them one at a
// time, because the per-cell charge is only visible between two steps. Nothing
// else is on the machine, so every reading is a sum over this track alone. No run
// is started.
//
// THE VERDICT. The empty machine costs `0`; a track of `k` cells costs
// `PART_COSTS.track` times `k`, so the one-cell track costs `5` and the four-cell
// track costs `20`; and each cell appended raises the cost by exactly
// `PART_COSTS.track`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { PART_COSTS } from "../constants";
import { at, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  openChallengeDocument,
  placeTrack,
  type Harness,
} from "../harness";

/** The path, laid in this order: four cells running east from the origin. */
const CELLS: readonly Hex[] = [at(0, 0), at(1, 0), at(2, 0), at(3, 0)];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The machine's cost, off a fresh snapshot. */
async function cost(): Promise<number> {
  return (await h.snapshot()).editor.cost;
}

it("charges a track PART_COSTS.track per cell as its path is laid", async () => {
  await openChallengeDocument(h, BARE);

  // Index `k` of the readings is the machine's cost with `k` cells laid, so
  // index `0` is the empty machine.
  const readings = await captureReplay(
    h,
    "laying",
    async (): Promise<number[]> => {
      const seen: number[] = [];
      await h.debug.clearMachine();
      await h.advance(1);
      seen.push(await cost());

      const first = CELLS[0];
      if (first === undefined) fail("a first cell to lay", CELLS);
      const track = await placeTrack(h, [first]);
      await h.advance(1);
      seen.push(await cost());

      for (const cell of CELLS.slice(1)) {
        await h.debug.extendTrack(track, cell.q, cell.r);
        await h.advance(1);
        seen.push(await cost());
      }
      return seen;
    },
  );

  assertEqual(
    readings.length,
    CELLS.length + 1,
    "the machine was read once empty and once per cell laid",
  );
  assertEqual(readings[0], 0, "an empty machine costs 0");

  for (let cells = 1; cells <= CELLS.length; cells += 1) {
    const now = readings[cells];
    const before = readings[cells - 1];
    assertEqual(
      now,
      PART_COSTS.track * cells,
      `a track of ${cells} cell(s) costs PART_COSTS.track per cell`,
    );
    assertEqual(
      (now ?? Number.NaN) - (before ?? Number.NaN),
      PART_COSTS.track,
      `laying cell ${cells} raises the cost by PART_COSTS.track`,
    );
  }
});
