// input/pointer-footprint-snaps — a held footprint follows the pointer's tile.
//
// THE REQUIREMENT. `specs/controls.md`: moving "over the yard while holding a
// rock" snaps "the held footprint to the tile under the pointer" and updates "its
// legal read". `specs/scrap-press.md` says the same from the press's side: "A held
// rock is positioned as its `2` by `2` footprint, snapped to the grid under the
// pointer". `specs/instrumentation.md` reports the footprint as
// `held: { active, col, row, legal }`, so both halves are read there.
//
// HOW IT IS DECIDED. A rock is armed on an otherwise empty yard and the pointer is
// moved to the centre of several known tiles in turn, each read straight back. The
// tiles are chosen so that the legal read has to move as well as the anchor: two
// open tiles far apart on the yard, the anchor of a waypoint platform, whose four
// tiles no footprint may cover, and the last anchor a `2` by `2` footprint fits
// at.
//
// `specs/yard.md` fixes each tile's centre as `(20c + 10, 56 + 20r + 10)` and the
// legal anchors as `col` `0`–`48` by `row` `0`–`31`, so every coordinate here is
// the specification's arithmetic rather than a measurement of anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  MAX_ANCHOR_COL,
  MAX_ANCHOR_ROW,
  mapById,
  tileCenter,
} from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  pressAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("snaps the held footprint to the tile under the pointer", async () => {
  await openYard(h);
  await pressAction(h, "stamp");

  const armed = await h.snapshot();
  assertEqual(
    armed.held.active,
    true,
    "a rock armed on the cursor before the pointer moves " +
      "(specs/scrap-press.md)",
  );

  const platform = mapById(armed.map).waypoints[0]!;
  const moves = [
    { col: 10, row: 0, legal: true, why: "an open stretch of yard" },
    { col: 30, row: 20, legal: true, why: "another open stretch, far from it" },
    {
      col: platform.col,
      row: platform.row,
      legal: false,
      why: "the anchor of WP1's platform, whose tiles no footprint may cover",
    },
    {
      col: MAX_ANCHOR_COL,
      row: MAX_ANCHOR_ROW,
      legal: true,
      why: "the last anchor a 2 by 2 footprint fits at",
    },
  ];

  for (const move of moves) {
    const point = tileCenter(move.col, move.row);
    await h.debug.pointerMove(point.x, point.y);
    if (move.col === 10) await captureStill(h, "snap");

    const held = (await h.snapshot()).held;
    // `+ 0` normalises a negative zero, which is the same tile by every reading
    // a game can make of it and which a build is free to arrive at.
    assertEqual(
      held.col + 0,
      move.col,
      `the held footprint's anchor column with the pointer at the centre of ` +
        `tile (${move.col}, ${move.row}) (specs/controls.md, specs/yard.md)`,
    );
    assertEqual(
      held.row + 0,
      move.row,
      `the held footprint's anchor row with the pointer at the centre of ` +
        `tile (${move.col}, ${move.row}) (specs/controls.md, specs/yard.md)`,
    );
    assertEqual(
      held.legal,
      move.legal,
      `the held footprint's legal read over ${move.why} (specs/yard.md)`,
    );
  }
});
