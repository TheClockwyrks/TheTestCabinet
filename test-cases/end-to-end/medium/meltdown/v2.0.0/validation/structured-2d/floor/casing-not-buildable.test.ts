// floor/casing-not-buildable — nothing is ever built on the casing.
//
// THE RULE, AND WHY IT TAKES THIS SHAPE. specs/floor.md states the invariant
// plainly — "no tower footprint ever covers any part of it" — and
// specs/building.md states the two mechanisms that hold it: the held footprint is
// "clamped so that the whole footprint stays on the grid", and a footprint is
// valid only when "Every tile of the footprint is on the grid", with the closing
// note that "The casing is not part of the grid, so no footprint reaches it."
//
// So a conforming build has TWO defences, and this check has to decide the
// invariant whichever of them is doing the work. It asks for the casing along
// both routes a footprint can be aimed — `setPreview` at an anchor whose
// footprint would hang over the wall, and the pointer itself moved into the band
// — and then, for each attempt, requires:
//
//   - that the footprint the build reports covers no casing tile (the clamp
//     held), OR, if it does reach out there, that it reads INVALID (the placement
//     check held); and
//   - that `place` afterwards leaves no tower whose footprint covers a casing
//     tile, whichever of the two happened.
//
// The second is the requirement; the first is what makes a failure legible,
// because it says which defence gave way. A build with neither defence puts a
// tower on the wall and fails both.
//
// WHY THE MONEY IS RAISED FIRST. specs/building.md makes affordability one of the
// six conditions a footprint is valid against, and a refusal this check read as
// "the casing was refused" when it was really "the tower was unaffordable" would
// grade nothing. So the money is put far above any tower's cost, leaving the grid
// condition as the only one in play.
//
// WHY THE FLOOR IS CLEARED BETWEEN ATTEMPTS. Occupancy is another of the six.
// After an attempt in which the clamp held, a tower stands where the clamp put
// it, and the next attempt's footprint could then be refused for landing on it —
// a refusal that says nothing about the casing. `clearTowers` costs nothing and
// pays nothing (specs/instrumentation.md), so each attempt starts on open floor.
//
// WHY BOTH FOOTPRINT SIZES. The Arc's 2x2 and the Lance's 4x4 are the smallest
// and largest footprints in the roster (specs/towers.md), and a clamp written
// against one size — `COLS - 1` rather than `COLS - size` — holds for the small
// one and hangs the large one over the wall.

import { afterEach, beforeEach, it } from "vitest";
import {
  CASING,
  COLS,
  PANEL_X,
  ROWS,
  STAGE_H,
  inBounds,
  tileCX,
  tileCY,
} from "../constants";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  footprintTiles,
  sizeOf,
  startRun,
  tilesOf,
  type Harness,
  type MeltdownSnapshot,
  type TowerType,
} from "../harness";

/**
 * The money every attempt is made with.
 *
 * Far above the roster's dearest tower, the Lance and the Bloom at `150`
 * (specs/towers.md), so affordability — one of the six conditions of
 * specs/building.md — cannot be what refuses a footprint here.
 */
const AMPLE_MONEY = 100_000;

/** The two footprint sizes the roster spans: the Arc's 2x2 and the Lance's 4x4. */
const TYPES: readonly TowerType[] = ["arc", "lance"];

/** The row and column an attempt aims at along the wall it is not reaching over. */
const ALONG_ROW = 10;
const ALONG_COL = 10;

/** One attempt: where a footprint is aimed, and what to call it in a failure. */
interface Aim {
  name: string;
  anchor: { col: number; row: number };
}

/**
 * Anchors whose footprint would hang over each of the four walls, at a given
 * footprint size: one reaching a single rank of tiles over the wall, and one
 * standing entirely outside the grid.
 */
function aimsFor(size: number): Aim[] {
  return [
    {
      name: "one column over the left casing",
      anchor: { col: -1, row: ALONG_ROW },
    },
    { name: "wholly left of the grid", anchor: { col: -size, row: ALONG_ROW } },
    {
      name: "one row over the top casing",
      anchor: { col: ALONG_COL, row: -1 },
    },
    { name: "wholly above the grid", anchor: { col: ALONG_COL, row: -size } },
    {
      name: "one column over the right casing",
      anchor: { col: COLS - size + 1, row: ALONG_ROW },
    },
    { name: "wholly right of the grid", anchor: { col: COLS, row: ALONG_ROW } },
    {
      name: "one row over the bottom casing",
      anchor: { col: ALONG_COL, row: ROWS - size + 1 },
    },
    { name: "wholly below the grid", anchor: { col: ALONG_COL, row: ROWS } },
  ];
}

/** The pointer, deep inside each of the four bands of the casing. */
const BAND_POINTS: readonly { name: string; x: number; y: number }[] = [
  { name: "the left band", x: CASING / 2, y: tileCY(ALONG_ROW) },
  { name: "the top band", x: tileCX(ALONG_COL), y: CASING / 2 },
  { name: "the right band", x: PANEL_X - CASING / 2, y: tileCY(ALONG_ROW) },
  { name: "the bottom band", x: tileCX(ALONG_COL), y: STAGE_H - CASING / 2 },
];

/** Every tile of the reported preview footprint that is not on the grid. */
function offGrid(snapshot: MeltdownSnapshot, type: TowerType): string[] {
  const build = snapshot.build;
  if (build === null) return [];
  return footprintTiles(build.col, build.row, sizeOf(type))
    .filter((tile) => !inBounds(tile.col, tile.row))
    .map((tile) => `(${tile.col}, ${tile.row})`);
}

/** Every tower standing with part of its footprint off the grid, named. */
function onTheCasing(snapshot: MeltdownSnapshot): string[] {
  const standing: string[] = [];
  for (const tower of snapshot.towers) {
    const out = tilesOf(tower).filter((tile) => !inBounds(tile.col, tile.row));
    if (out.length > 0) {
      standing.push(
        `${tower.type} ${tower.id} at (${tower.col}, ${tower.row}) covering ` +
          out.map((tile) => `(${tile.col}, ${tile.row})`).join(", "),
      );
    }
  }
  return standing;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses every footprint aimed over the casing", async () => {
  startRun(h);
  h.debug.setMoney(AMPLE_MONEY);

  let captured = false;
  for (const type of TYPES) {
    for (const aim of aimsFor(sizeOf(type))) {
      h.debug.clearTowers();
      h.debug.setArmed(type);
      h.debug.setPreview(aim.anchor.col, aim.anchor.row);
      await h.advance(1);

      if (!captured) {
        // The first aim, kept as the item's evidence: a footprint held against
        // the casing, before anything is asked of `place`.
        captureStill(h, "refused");
        captured = true;
      }

      const held = h.snapshot();
      const at = `${type} aimed ${aim.name}`;
      assertNotNull(held.build, `${at}: the preview the build is holding`);
      const reaching = offGrid(held, type);
      if (reaching.length > 0) {
        // The clamp let the footprint out onto the wall, so the placement check
        // is the defence left, and specs/building.md requires it to refuse.
        assertEqual(
          held.build?.valid,
          false,
          `${at}: a footprint covering casing tiles ${reaching.join(", ")} ` +
            `reads invalid (specs/building.md)`,
        );
      }

      h.debug.place();
      const built = onTheCasing(h.snapshot());
      assertTrue(
        built.length === 0,
        `${at}: no tower stands on the casing after place (specs/floor.md); ` +
          `found ${built.join("; ")}`,
      );
    }
  }
});

it("refuses every footprint the pointer carries into the casing", async () => {
  startRun(h);
  h.debug.setMoney(AMPLE_MONEY);

  for (const type of TYPES) {
    for (const band of BAND_POINTS) {
      h.debug.clearTowers();
      h.debug.setArmed(type);
      h.debug.pointerMove(band.x, band.y);
      await h.advance(1);

      const held = h.snapshot();
      const at = `${type} carried into ${band.name}`;
      assertNotNull(held.build, `${at}: the preview the build is holding`);
      const reaching = offGrid(held, type);
      if (reaching.length > 0) {
        assertEqual(
          held.build?.valid,
          false,
          `${at}: a footprint covering casing tiles ${reaching.join(", ")} ` +
            `reads invalid (specs/building.md)`,
        );
      }

      h.debug.place();
      const built = onTheCasing(h.snapshot());
      assertTrue(
        built.length === 0,
        `${at}: no tower stands on the casing after place (specs/floor.md); ` +
          `found ${built.join("; ")}`,
      );
    }
  }
});
