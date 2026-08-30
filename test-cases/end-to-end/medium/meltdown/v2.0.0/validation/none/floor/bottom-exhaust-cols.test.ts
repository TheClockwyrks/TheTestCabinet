// floor/bottom-exhaust-cols — the bottom exhaust opens on columns 22 to 29, and
// the rest of the bottom casing is wall.
//
// THE RULE. `specs/floor.md` cuts the bottom exhaust into the casing's bottom
// edge over `BOTTOM_EXHAUST_COLS`, tiles `(22, 35)` through `(29, 35)` — eight
// tiles, the run its opposite top vent covers — and `specs/mazing.md` fixes what
// reaching it means: "A unit leaves the floor when the tile its centre occupies
// is one of the opening tiles of its assigned exhaust." Two claims follow, and
// this file decides both, one to a check:
//
//   1. Each of those eight tiles IS an exit. A unit whose walking carries its
//      centre onto one of them is removed and the leak is paid.
//   2. No other tile of the bottom row is. A unit standing against the bottom
//      casing on any other column is still on the floor, and no life has been
//      paid.
//
// WHY THE APPROACH IS A UNIT AND A HALF FROM THE MOUTH. The scenario is reached
// directly, as `specs/instrumentation.md` intends `setUnitPosition` to be used:
// each Mote is posed inside tile `(c, 34)` with its centre a unit and a half
// above the boundary at `tileTop(35)`, and then WALKS the rest under its own
// power. It is walking that this item is about, so the locomotion gate stays on;
// but a walk begun at the vent would fold the whole of `specs/mazing.md` — the
// route metric, the step rule, live re-pathing — into a verdict about where the
// wall has a hole in it, and a build with a broken route would fail this item for
// a reason that is not its.
//
// WHY THE SECOND CHECK USES A CORE, AND A WINDOW OF EXACTLY 24 FRAMES. The Core
// is the slowest unit in the game at `30` logical units per second
// (`specs/surge.md`), which is a quarter of a unit per frame on the suite's 120 Hz
// clock. Twenty-four frames therefore carry it six units — comfortably short of
// the nine and a half it would need to leave the tile it was posed on. So a build
// that treats the whole bottom row as an exhaust leaks it on the first frame and
// is caught, while a build that has the run right cannot legitimately reach
// column 22 or column 29 inside the window whichever way it walks. Columns 21 and
// 30 are the off-by-one neighbours of the run and are the point of the check;
// columns 0 and 49 are the far ends of the same wall.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual, assertTrue } from "../assert";
import {
  BOTTOM_EXHAUST_COLS,
  ROWS,
  SURGE_DEFS,
  TILE,
  tileCX,
  tileCY,
  tileTop,
} from "../constants";
import {
  captureStill,
  createHarness,
  poseWalker,
  startRun,
  unitById,
  type Harness,
} from "../harness";

/**
 * How far inside tile `(c, 34)` each Mote's centre is posed, in logical units:
 * a unit and a half short of the boundary at `tileTop(35)`.
 *
 * Geometry, not a tolerance. It says where the walk starts — near enough that
 * the unit's own locomotion carries it over the boundary in a handful of frames,
 * far enough that it is unambiguously still on tile `(c, 34)` when it starts.
 */
const APPROACH = 1.5;

/**
 * The window the eight approaching Motes are given to cross, in frames.
 *
 * A Mote runs at `60` logical units per second (`specs/surge.md`), which is half
 * a unit per frame at the suite's 120 Hz, so 24 frames carry it twelve units:
 * eight times the `APPROACH` it has to cover, and still less than the 19 that
 * would take it out of the column it started in.
 */
const CROSS_FRAMES = 24;

/**
 * The columns on the bottom wall that are NOT exhaust, and the window a Core
 * posed against each is held for.
 *
 * 21 and 30 flank the run; 0 and 49 are the wall's two ends.
 */
const WALL_COLS: readonly number[] = [0, 21, 30, 49];

/**
 * A Core moves `30 / 120` = 0.25 units per frame, so 24 frames carry it six of
 * the nine and a half units that separate a tile centre from the next tile.
 */
const HOLD_FRAMES = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lets a unit out through each of the exhaust's eight columns", async () => {
  await startRun(h);

  const arriving: { id: number; col: number }[] = [];
  for (const col of BOTTOM_EXHAUST_COLS) {
    const id = await poseWalker(h, "mote", "top");
    await h.debug.setUnitPosition(
      id,
      tileCX(col),
      tileTop(ROWS - 1) - APPROACH,
    );
    arriving.push({ id, col });
  }

  const before = await h.snapshot();
  assertEqual(
    before.surge.length,
    BOTTOM_EXHAUST_COLS.length,
    "the eight approaching Motes on the floor",
  );
  const livesBefore = before.lives;

  await h.advance(1);
  await captureStill(h, "exhaust");

  await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: CROSS_FRAMES,
    poll: 1,
  });

  const after = await h.snapshot();
  for (const { id, col } of arriving) {
    assertEqual(
      unitById(after, id),
      undefined,
      `the Mote that walked onto tile (${col}, 35) is off the floor`,
    );
  }
  // Eight leaks were paid, so the eight really did reach the exhaust rather than
  // being removed some other way: `specs/surge.md` costs a leak at least one
  // life and a kill none, and there is no tower on this floor to land a shot.
  assertLessThanOrEqual(
    after.lives,
    livesBefore - BOTTOM_EXHAUST_COLS.length * SURGE_DEFS.mote.leak,
    "lives paid for the eight leaks (specs/surge.md)",
  );
});

it("holds a unit against the bottom casing on every other column", async () => {
  await startRun(h);

  for (const col of WALL_COLS) {
    await h.debug.clearSurge();
    const livesBefore = (await h.snapshot()).lives;

    const id = await poseWalker(h, "core", "top");
    await h.debug.setUnitPosition(id, tileCX(col), tileCY(ROWS - 1));
    await h.advance(HOLD_FRAMES);

    const after = await h.snapshot();
    const held = unitById(after, id);
    assertTrue(
      held !== undefined,
      `the Core standing on tile (${col}, 35) is still on the floor: ` +
        `column ${col} is casing, not exhaust (specs/floor.md)`,
    );
    assertEqual(
      after.lives,
      livesBefore,
      `lives unchanged while a Core stood on tile (${col}, 35)`,
    );
    // And it never wandered far enough for the window to have let it reach the
    // run legitimately: six units of the nineteen a column is wide.
    if (held !== undefined) {
      assertLessThanOrEqual(
        Math.abs(held.x - tileCX(col)),
        TILE / 2,
        `the Core is still on column ${col}`,
      );
    }
  }
});
