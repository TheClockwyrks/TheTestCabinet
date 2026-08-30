// instrumentation/tile-at-outside-the-grid — a cell off the grid reads as bedrock.
//
// `specs/instrumentation.md`, under what `tileAt` returns: "A cell outside the
// grid reads as `bedrock` with every other field `null`." That is the one reading
// the specification defines outside the grid's own bounds, and it is defined
// rather than refused because it is what the rest of the game needs: collision
// against the world's edge, a scan that walks off the border, and a blast that
// reaches past the last column all ask about cells that are not there, and the
// answer is the same solid nothing the border is made of.
//
// So the reading is taken past each of the four edges — left of column `0`, right
// of the last column, above `row 0`, and below the Core chamber — and each is held
// against the whole documented shape rather than against its kind alone: a build
// that returns `bedrock` with a band and a health attached has invented a cell.

import { afterEach, beforeEach, it } from "vitest";
import { WORLD_COLS } from "../../src/constants";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  openScene,
  pinDrill,
  standOn,
  type Harness,
} from "../harness";

/** Where the miner stands while the reads are taken, beside the border. */
const COL = 2;
const ROW = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads bedrock with every other field null past each edge of the grid", async () => {
  openScene(h);
  h.debug.setTile(COL, ROW, "rock");
  standOn(h, COL, ROW);
  pinDrill(h);
  await h.advance(2);
  captureStill(h, "edge");

  const { coreRow } = h.snapshot();
  const outside: readonly [number, number][] = [
    [-1, ROW],
    [WORLD_COLS, ROW],
    [COL, -1],
    [COL, coreRow + 1],
    [-4, -4],
  ];

  for (const [col, row] of outside) {
    const at = `tileAt(${col}, ${row})`;
    const tile = h.tileAt(col, row);
    assertEqual(tile.kind, "bedrock", `the kind ${at} reports`);
    assertNull(tile.band, `the band ${at} reports`);
    assertNull(tile.ore, `the ore ${at} reports`);
    assertNull(tile.material, `the material ${at} reports`);
    assertNull(tile.health, `the health ${at} reports`);
    assertNull(tile.maxHealth, `the maxHealth ${at} reports`);
  }
});
