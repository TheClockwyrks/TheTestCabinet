// strait/bay-columns — the far shore opens at exactly the ten columns
// specs/strait.md gives the five bays, and a hop up from row `2` is accepted at
// every one of them.
//
// specs/strait.md fixes the pairs — bay `0` at columns `3`, `4`, bay `1` at `11`,
// `12`, bay `2` at `19`, `20`, bay `3` at `27`, `28`, bay `4` at `35`, `36` — and
// specs/bays.md makes "the two columns of an open bay ... the only tiles of the
// far shore a hop may land on". specs/hopping.md states the same from the other
// side: a hop is refused when its target is "on row `1` at a column no bay
// covers".
//
// THIS ITEM IS THE ACCEPTING HALF. `strait/far-shore-solid` is the refusing half
// and reads the other thirty columns of row `1`; between them they close every
// column of the row. Both are their own item because a build that opened the
// whole shore passes one and fails the other, and a build that closed the whole
// shore does the reverse — a single item over the row would grade them the same.
//
// WHAT "ACCEPTED" IS READ AS. specs/bays.md: "A crossing ends on the hop that
// lands the critter in an open bay, which is a hop up from row `2`. On that hop:
// that bay becomes filled". So the bay covering the column hopped into reads
// filled, and a refused hop leaves it open. The reading is the bay rather than
// the critter's own tile because the same paragraph takes the critter off the
// strait on that hop, so where it stands afterwards is the build's business.
// WHICH bays change is `bays/fill-on-entry`; what is read here is that this one
// did, at each of the ten columns in turn.
//
// EACH COLUMN IS POSED FROM SCRATCH. `startCrossing` re-opens all five bays and
// puts a fresh critter on the near shore before every column, so the tenth column
// is decided by the same world the first was and a bay filled at column `3`
// cannot make the hop at column `4` a refusal.
//
// THE CRITTER STANDS ON A FLOE, because a bay is entered by "a hop up from row
// `2`" and row `2` is the top row of the water band: a critter whose footing
// there is `water` falls in on that very tick (specs/water.md). `./harness.ts`'s
// `poseHopUpFromWater` lays the smallest floe the game has under exactly that
// tile and stops the lane, so it holds still and covers nothing else.
//
// THE HOP IS A REAL KEY. specs/hopping.md decides a hop by its target tile, and
// posing the critter onto row `1` would produce no hop at all and so no
// acceptance to read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  keyFor,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { BAY_COLUMNS, poseHopUpFromWater } from "./harness";

/**
 * Game time held after each hop, in seconds, for the replay alone.
 *
 * An eighth of a second: enough that the evidence shows the critter arriving in
 * the bay rather than a single frozen frame, and well inside the `BAYFILL_PAUSE`
 * (`0.5` s) hold specs/progression.md puts after a filled bay, so no fresh
 * crossing has begun by the time the next column is posed. Every reading is taken
 * before it runs.
 */
const AFTER_SECONDS = 0.125;

/** What one column's hop left the five bays as. */
interface Landing {
  col: number;
  bay: number;
  after: boolean[];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts a hop up from row 2 at every one of the ten bay columns", async () => {
  const landings: Landing[] = [];

  await captureReplay(h, "bays", async () => {
    for (const { col, bay } of BAY_COLUMNS) {
      // A world of its own for each column: five open bays, an emptied strait,
      // and the critter standing on a still floe at the mouth.
      startCrossing(h);
      poseHopUpFromWater(h, col);

      await h.tap(keyFor("up"));
      landings.push({ col, bay, after: h.snapshot().bays });
      await h.advance(ticksFor(AFTER_SECONDS));
    }
  });

  for (const { col, bay, after } of landings) {
    assertEqual(
      after[bay],
      true,
      `bay ${bay} filled by a hop up from row 2 at column ${col}, which ` +
        `specs/strait.md makes one of its two columns and specs/bays.md makes ` +
        `a tile of the far shore a hop may land on`,
    );
  }
});
