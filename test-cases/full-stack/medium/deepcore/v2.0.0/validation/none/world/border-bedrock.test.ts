// world/border-bedrock — columns 0 and 31 are the mine's bedrock border.
//
// `specs/world.md` fixes the grid at `WORLD_COLS` (`32`) columns, of which `1`
// through `30` are playable and `0` and `31` are border, and its tile table gives
// bedrock as holding "Columns `0` and `31`, and the Core chamber row apart from
// the Core tile". Bedrock is neither minable nor passable, so the border is what
// stops a prospector drilling out of the world sideways.
//
// The reading is taken over every row of both border columns, on generated mines
// at every world size, and it is taken on generation's own output rather than on
// a posed grid: `clearMine` leaves the border alone, so a build that generated
// rock at the edge and cleared it later would still read as bordered.
//
// The playable field is read alongside it, from the other direction: column `30`
// has to hold something other than bedrock somewhere down the mine, or a build
// that made the whole grid bedrock would satisfy the border by making the mine
// unplayable.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan } from "../assert";
import {
  PLAYABLE_COL_MAX,
  WORLD_COLS,
  WORLD_SIZES,
  type WorldSize,
} from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { generatedMine, kindAt, look } from "../generation/mine-scan";

/** The two columns the specification gives to the border. */
const BORDER_COLS = [0, WORLD_COLS - 1] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("makes every cell of column 0 and column 31 bedrock", async () => {
  for (const size of WORLD_SIZES) {
    const at = `the ${size} mine`;
    const scan = await generatedMine(h, size as WorldSize);

    const wrong: string[] = [];
    for (const col of BORDER_COLS) {
      for (let row = 0; row <= scan.coreRow; row += 1) {
        const kind = kindAt(scan, col, row);
        if (kind !== "bedrock") wrong.push(`(${col}, ${row}) is ${kind}`);
      }
    }
    assertDeepEqual(wrong.slice(0, 5), [], `the border of ${at}`);

    // And the field inside it is a field: the last playable column holds
    // something a prospector can work.
    let playable = 0;
    for (let row = 1; row <= scan.coreRow - 1; row += 1) {
      if (kindAt(scan, PLAYABLE_COL_MAX, row) !== "bedrock") playable += 1;
    }
    assertGreaterThan(playable, 0, `non-bedrock cells of column 30 in ${at}`);
  }

  // The picture: the border beside the playable field.
  await look(h, 2, 40);
  await captureStill(h, "border");
});
