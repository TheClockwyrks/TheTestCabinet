// generation/ore-min-row — the first three rows of ground hold no ore.
//
// `specs/world.md`: "No ore appears above `ORE_MIN_ROW` (`4`), so the first three
// rows of ground are plain rock." So rows `1`, `2` and `3` of the playable
// columns carry no ore cell in any generated mine, and the first digs out of the
// camp yield nothing.
//
// Read on a fresh mine at every world size, and on generated mines rather than
// posed ones: `clearMine` opens the whole grid and would report
// no ore wherever generation put it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { ORE_MIN_ROW, WORLD_SIZES, type WorldSize } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { generatedMine, look } from "./mine-scan";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts no ore vein above row 4", async () => {
  for (const size of WORLD_SIZES) {
    const scan = await generatedMine(h, size as WorldSize);
    const shallow = scan.ores
      .filter((cell) => cell.row < ORE_MIN_ROW)
      .map((cell) => `${cell.ore} at (${cell.col}, ${cell.row})`);
    assertDeepEqual(shallow, [], `${size} mine`);
  }

  // The picture: the plain rock directly under the camp.
  await look(h, 8, 3);
  await captureStill(h, "shallow");
});
