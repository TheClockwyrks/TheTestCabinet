// generation/lava-clusters — lava forms pools rather than isolated cells.
//
// `specs/world.md`: "Lava cells cluster into pools rather than scattering as
// single cells." What that buys a player is a hazard that can be seen coming and
// routed around, rather than one cell of molten rock hidden in the middle of a
// face of plain rock.
//
// HOW A POOL IS READ. A lava cell is part of a pool when at least one of the four
// cells orthogonally beside it is lava as well. A scatter placed cell by cell
// leaves almost every lava cell alone: at the deepstone's stated share of about
// `0.0475`, an independent draw joins a neighbour under a fifth of the time, so
// the isolated cells outnumber the joined ones four to one. A build that places
// pools inverts that. So the reading is which of the two counts is larger, over
// the two bands that hold lava at all, which separates the two designs without
// fixing a pool size the specification does not state.

import { afterEach, beforeEach, it } from "vitest";
import { PLAYABLE_COL_MAX, PLAYABLE_COL_MIN } from "../constants";
import { assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { generatedMine, kindAt, look, type MineScan } from "./mine-scan";

const MINES = 4;

/** How many lava cells touch another lava cell, and how many stand alone. */
function pools(scan: MineScan): {
  joined: number;
  alone: number;
  example: { col: number; row: number } | null;
} {
  let joined = 0;
  let alone = 0;
  let example: { col: number; row: number } | null = null;
  for (let row = 1; row <= scan.coreRow - 1; row += 1) {
    for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col += 1) {
      if (kindAt(scan, col, row) !== "lava") continue;
      const touching =
        kindAt(scan, col + 1, row) === "lava" ||
        kindAt(scan, col - 1, row) === "lava" ||
        kindAt(scan, col, row + 1) === "lava" ||
        kindAt(scan, col, row - 1) === "lava";
      if (touching) {
        joined += 1;
        example ??= { col, row };
      } else {
        alone += 1;
      }
    }
  }
  return { joined, alone, example };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("places more lava cells beside another than standing alone", async () => {
  let last = null;
  for (let mine = 1; mine <= MINES; mine += 1) {
    const scan = generatedMine(h);
    last = pools(scan);
    assertGreaterThan(
      last.joined,
      last.alone,
      `generation ${mine}: ${last.joined} lava cells in pools against ${last.alone} alone`,
    );
  }

  // The picture: one pool, in the mine the last reading was taken from.
  await look(h, last?.example?.col ?? 16, last?.example?.row ?? 300);
  captureStill(h, "pool");
});
