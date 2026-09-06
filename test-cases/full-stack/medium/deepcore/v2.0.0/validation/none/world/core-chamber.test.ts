// world/core-chamber — the chamber is bedrock apart from the Core.
//
// `specs/world.md`: "The Core chamber is `row coreRow`. Every cell of it is
// bedrock border except the Core tile, which sits at `CORE_COL` (`16`)." The Core
// is what a Core Sample is drilled out of, so a chamber floored in plain bedrock
// has no rocket in it, and one floored in rock has a mine with no bottom.
//
// The reading is taken at every world size, because `coreRow` moves with the size
// and the chamber has to move with it; the row it is read at is the `coreRow` the
// game itself reports, so what is decided here is the chamber's contents rather
// than where the size puts it. It is taken on generated mines, since it is
// generation that lays the chamber.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  CORE_COL,
  WORLD_COLS,
  WORLD_SIZES,
  type WorldSize,
} from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { generatedMine, kindAt, look } from "../generation/mine-scan";

const MINES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lays the Core at column 16 and bedrock across the rest of the chamber", async () => {
  let deepest = 0;
  for (const size of WORLD_SIZES) {
    for (let mine = 1; mine <= MINES; mine += 1) {
      const at = `the ${size} mine, generation ${mine}`;
      const scan = await generatedMine(h, size as WorldSize);
      deepest = scan.coreRow;

      assertEqual(
        kindAt(scan, CORE_COL, scan.coreRow),
        "core",
        `the Core tile in ${at}`,
      );

      const wrong: string[] = [];
      for (let col = 0; col < WORLD_COLS; col += 1) {
        if (col === CORE_COL) continue;
        const kind = kindAt(scan, col, scan.coreRow);
        if (kind !== "bedrock")
          wrong.push(`(${col}, ${scan.coreRow}) is ${kind}`);
      }
      assertDeepEqual(wrong.slice(0, 5), [], `the chamber of ${at}`);
    }
  }

  // The picture: the chamber at the bottom of the mine last read.
  await look(h, CORE_COL, deepest - 1);
  await captureStill(h, "chamber");
});
