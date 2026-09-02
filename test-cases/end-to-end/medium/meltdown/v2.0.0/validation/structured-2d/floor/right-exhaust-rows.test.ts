// floor/right-exhaust-rows — the right exhaust opens on rows 16 to 19, and the
// rest of the right casing is wall.
//
// THE RULE. specs/floor.md cuts the right exhaust into the casing's right edge
// over `RIGHT_EXHAUST_ROWS`, tiles `(49, 16)` through `(49, 19)`, and
// specs/mazing.md fixes what reaching it means: a unit leaves the floor when the
// tile its centre occupies is one of its assigned exhaust's opening tiles. Two
// claims follow, and this file decides both, one to a check:
//
//   1. Each of those four tiles IS an exit. A unit whose walking carries its
//      centre onto one of them is removed and the leak is paid.
//   2. No other tile of the right column is. A unit standing against the right
//      casing on any other row is still on the floor, and no life has been paid.
//
// WHY THE APPROACH IS A UNIT AND A HALF FROM THE MOUTH. The scenario is reached
// directly, as specs/instrumentation.md intends `setUnitPosition` to be used:
// each Mote is posed inside tile `(48, r)` with its centre a unit and a half from
// the boundary at `tileLeft(49)`, and then WALKS the rest under its own power. It
// is walking that this item is about, so the locomotion gate stays on; but a walk
// begun at the vent would fold the whole of specs/mazing.md — the route metric,
// the step rule, live re-pathing — into a verdict about where the wall has a hole
// in it, and a build with a broken route would fail this item for a reason that
// is not its.
//
// WHY THE SECOND CHECK USES A CORE, AND A WINDOW OF EXACTLY 24 FRAMES. The Core
// is the slowest unit in the game at `30` logical units per second
// (specs/surge.md), which is a quarter of a unit per frame on the suite's 120 Hz
// clock. Twenty-four frames therefore carry it six units — comfortably short of
// the nine and a half it would need to leave the tile it was posed on. So a build
// that treats the whole right column as an exhaust leaks it on the first frame
// and is caught, while a build that has the run right cannot legitimately reach
// row 16 or row 19 inside the window whichever way it walks. Rows 15 and 20 are
// the off-by-one neighbours of the run and are the point of the check; rows 0 and
// 35 are the far ends of the same wall.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual, assertTrue } from "../assert";
import {
  COLS,
  RIGHT_EXHAUST_ROWS,
  SURGE_DEFS,
  TILE,
  tileCX,
  tileCY,
  tileLeft,
} from "../constants";
import {
  captureStill,
  createHarness,
  poseWalker,
  startRun,
  type Harness,
} from "../harness";
import { hasUnit, unitOf } from "./read";

/**
 * How far inside tile `(48, r)` each Mote's centre is posed, in logical units: a
 * unit and a half short of the boundary at `tileLeft(49)`.
 *
 * Geometry, not a tolerance. It says where the walk starts — near enough that the
 * unit's own locomotion carries it over the boundary in a handful of frames, far
 * enough that it is unambiguously still on tile `(48, r)` when it starts.
 */
const APPROACH = 1.5;

/**
 * The window the four approaching Motes are given to cross, in frames.
 *
 * A Mote runs at `60` logical units per second (specs/surge.md), which is half a
 * unit per frame at the suite's 120 Hz, so 24 frames carry it twelve units: eight
 * times the `APPROACH` it has to cover, and still less than the 19 that would
 * take it out of the exhaust's own column into a different row.
 */
const CROSS_FRAMES = 24;

/**
 * The rows on the right wall that are NOT exhaust.
 *
 * 15 and 20 flank the run; 0 and 35 are the wall's two ends.
 */
const WALL_ROWS: readonly number[] = [0, 15, 20, 35];

/**
 * A Core moves `30 / 120` = 0.25 units per frame, so 24 frames carry it six of
 * the nine and a half units that separate a tile centre from the next tile.
 */
const HOLD_FRAMES = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lets a unit out through each of the exhaust's four rows", async () => {
  startRun(h);

  const arriving: { id: number; row: number }[] = [];
  for (const row of RIGHT_EXHAUST_ROWS) {
    const id = poseWalker(h, "mote", "left");
    h.debug.setUnitPosition(id, tileLeft(COLS - 1) - APPROACH, tileCY(row));
    arriving.push({ id, row });
  }

  const before = h.snapshot();
  assertEqual(
    before.surge.length,
    RIGHT_EXHAUST_ROWS.length,
    "the approaching Motes on the floor",
  );
  const livesBefore = before.lives;

  await h.advance(1);
  captureStill(h, "exhaust");

  await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: CROSS_FRAMES,
    poll: 1,
  });

  const after = h.snapshot();
  for (const { id, row } of arriving) {
    assertEqual(
      hasUnit(after, id),
      false,
      `the Mote that walked onto tile (${COLS - 1}, ${row}) is off the floor ` +
        `(specs/floor.md, specs/mazing.md)`,
    );
  }
  // Four leaks were paid, so the four really did reach the exhaust rather than
  // being removed some other way: specs/surge.md costs a leak at least one life
  // and a kill none, and there is no tower on this floor to land a shot.
  assertLessThanOrEqual(
    after.lives,
    livesBefore - RIGHT_EXHAUST_ROWS.length * SURGE_DEFS.mote.leak,
    "lives paid for the four leaks (specs/surge.md)",
  );
});

it("holds a unit against the right casing on every other row", async () => {
  startRun(h);

  for (const row of WALL_ROWS) {
    h.debug.clearSurge();
    const livesBefore = h.snapshot().lives;

    const id = poseWalker(h, "core", "left");
    h.debug.setUnitPosition(id, tileCX(COLS - 1), tileCY(row));
    await h.advance(HOLD_FRAMES);

    const after = h.snapshot();
    assertTrue(
      hasUnit(after, id),
      `the Core standing on tile (${COLS - 1}, ${row}) is still on the floor: ` +
        `row ${row} is casing, not exhaust (specs/floor.md)`,
    );
    assertEqual(
      after.lives,
      livesBefore,
      `lives unchanged while a Core stood on tile (${COLS - 1}, ${row})`,
    );
    // And it never wandered far enough for the window to have let it reach the
    // run legitimately: six units of the nineteen a row is wide.
    assertLessThanOrEqual(
      Math.abs(unitOf(after, id).y - tileCY(row)),
      TILE / 2,
      `the Core is still on row ${row}`,
    );
  }
});
