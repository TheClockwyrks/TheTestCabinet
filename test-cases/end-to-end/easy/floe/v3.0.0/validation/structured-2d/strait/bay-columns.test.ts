// strait/bay-columns — the far shore opens at exactly the ten columns the five
// bays cover, and a hop up from row 2 is accepted at every one of them.
//
// specs/strait.md fixes the five bays as exact column PAIRS, left to right:
//
//     bay 0   columns 3, 4        bay 3   columns 27, 28
//     bay 1   columns 11, 12      bay 4   columns 35, 36
//     bay 2   columns 19, 20
//
// specs/hopping.md refuses a hop onto row `1` "at a column no bay covers", so a
// hop up from row `2` at one of those ten is accepted; specs/bays.md fixes what
// that hop does: "A crossing ends on the hop that lands the critter in an open
// bay, which is a hop up from row `2`. On that hop: that bay becomes filled, and
// no other bay changes."
//
// THE FILLED BAY IS THE VERDICT, and it is read off the five-entry array whole.
// It is the acceptance signal specs/bays.md states in so many words, and it is
// unambiguous where the critter's own tile is not: the critter has LEFT THE
// STRAIT by the time the hop returns, and specs/instrumentation.md then has its
// tile report "the last values it held", which is a build's own business. The
// array says three things at once — a refused hop leaves all five open, a hop
// that filled the wrong bay reads a different index, and a build that opened the
// whole row reads more than one.
//
// EACH COLUMN IS ITS OWN CASE, on its own strait. Every bay covers TWO columns
// and the two fail independently: a build that placed its bays one column off,
// or centred them on a single column, accepts one of each pair and refuses the
// other, and reading the ten separately says which. That is also why nothing is
// carried between them — a filled bay stays filled through every later crossing
// of the level (specs/bays.md), so a second hop on a reused strait would be
// asking a different question.
//
// The critter stands on a still one-tile floe at the mouth (`mouth.ts`), because
// row `2` is the top row of the water band and open water drowns it on the tick
// (specs/water.md). Nothing else is on the strait: no vehicle, no bear, no bonus
// catch, and the four world gates shut, so nothing but the hop can change a bay.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { BAYS, BAY_COUNT } from "../../src/constants";
import {
  bayAtColumn,
  captureReplay,
  createHarness,
  hop,
  startCrossing,
  type Harness,
} from "../harness";
import { poseOnRowTwo } from "./mouth";

/** The ten columns the five bays cover, left to right (specs/strait.md). */
const BAY_COLUMNS: readonly number[] = BAYS.flatMap((pair) => [...pair]);

/**
 * The column the replay is recorded on: the left column of the middle bay.
 *
 * One of the ten, because the output is one clip. The middle bay is the one
 * whose mouth is neither at an edge of the strait nor at the column the critter
 * starts a crossing on, so the picture shows the far shore either side of it.
 */
const RECORDED_COLUMN = BAYS[2][0];

/**
 * Frames of the bay-fill hold recorded after the hop, for the replay alone.
 *
 * A quarter of a second, so the clip shows the critter arriving and the strait
 * carrying on rather than one frozen frame. Every reading is taken before it.
 */
const AFTER_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it.each(BAY_COLUMNS)(
  "accepts a hop up from row 2 at bay column %i, and fills that bay alone",
  async (col) => {
    const bay = bayAtColumn(col);
    assertNotNull(bay, `column ${col} is a column of one of the five bays`);

    /** The five bays afterwards: that one filled, the other four untouched. */
    const expected = Array.from(
      { length: BAY_COUNT },
      (_unused, index) => index === bay,
    );

    startCrossing(h);
    poseOnRowTwo(h, col);

    const drive = async (): Promise<boolean[]> => {
      await hop(h, "up");
      const landed = h.snapshot().bays;
      await h.advance(AFTER_FRAMES);
      return landed;
    };
    const bays =
      col === RECORDED_COLUMN
        ? await captureReplay(h, "bays", drive)
        : await drive();

    assertDeepEqual(
      bays,
      expected,
      `a hop up from (${col}, 2) fills bay ${String(bay)} and no other ` +
        `(specs/bays.md)`,
    );
  },
);
