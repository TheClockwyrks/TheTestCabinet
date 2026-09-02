// hud/on-floor-heat-read — a placed tower carries a heat read on its footprint
// whose extent tracks its heat, with a marker at its redline.
//
// THE RULE. specs/hud.md, The reads on the floor: "Each placed tower carries a
// heat read on its footprint whose extent tracks its heat, with a marker at the
// tower's redline." The heat scale is specs/heat.md's `0` to `TRIP_HEAT` (`100`)
// and the redline is the per-tower figure specs/towers.md tabulates.
//
// HOW AN EXTENT IS READ WHEN NOTHING FIXES THE LAYOUT OR THE COLOUR. A read whose
// extent tracks a quantity is a mark that STAYS PUT and CHANGES LENGTH as the
// quantity changes, so that is what is looked for: among the rectangles the frame
// drew over the footprint, the one drawn at the same place at two different heats
// with a different span. Nothing here names a colour, a side of the footprint, or
// an axis: a read running left to right and one running bottom to top are both
// found, and specs/overview.md fixes no palette to name anyway.
//
// A PIXEL COMPARISON WOULD NOT DO. A tower's body ramps with its heat — that is
// `presentation/heat-glow-ramp`'s requirement — so every pixel of the footprint
// changes between two heats whether or not a read was drawn, and a picture
// comparison would pass a build with no read at all. The mark the build drew is
// therefore what is measured.
//
// THREE HEATS, BECAUSE "TRACKS" IS A DIRECTION AND NOT A CHANGE. At `20`, `40`
// and `55` the read must be strictly longer each time. A build whose read has two
// states, or one drawn at a fixed length, or one that grows as the tower COOLS,
// fails; a build that draws no such mark at all has no extent to read and fails
// there. All three heats sit below the Stutter's redline of `60`, so the reading
// does not turn on how a build scales the part of the read past it.
//
// THE FULLEST FRAME IS POSED BUT NOT GRADED. Heat `100` is drawn only so the read
// can be told from the marks around it: a mark whose length differs between the
// lowest heat and the fullest is the read, and everything the footprint carries at
// a fixed length is not. A Stutter is used because its redline of `60` sits inside
// that range, so nothing here turns on how a build scales the part of the read
// past it.
//
// WHAT IT DOES NOT DECIDE: the marker at the tower's redline, which is
// `hud/on-floor-redline-marker`.
//
// THE HEAT IS PINNED at each reading, through `setTowerThermal(id, false)`, which
// holds the tower's part in the heat model. The heat is the quantity being read,
// so a reading taken while it drifted would be a reading of the cooling rate. The
// floor is otherwise empty, so no shot and no neighbour can move it either.

import { afterEach, beforeEach, it } from "vitest";
import { TILE, tileLeft, tileTop } from "../constants";
import { assertEqual, assertGreaterThanOrEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  startRun,
  type ControlRect,
  type Harness,
} from "../harness";
import {
  emitterDef,
  findSpanMark,
  readRects,
  spanAt,
  towerOf,
  type DrawnRect,
} from "./panel";
import { FREE_SITE } from "./sites";

/** The tower read. Its redline of 60 puts a marker clear of either end. */
const TYPE = "stutter" as const;
const REDLINE = emitterDef(TYPE).redline;

/** The three heats the extent is read at, all below the redline. */
const HEATS = [20, 40, 55] as const;

/** And the heat the read's full extent is measured at. */
const FULL_HEAT = 100;

/**
 * How far apart two rectangles may be drawn and still count as the same mark:
 * half a logical unit.
 *
 * A read's fill stays where it is and changes length, so its anchor is the same
 * number at every heat; half a unit is only the slack a build's own arithmetic
 * takes.
 */
const SLACK = 0.5;

/**
 * The least a read's extent must grow between two of the heats: one logical unit.
 *
 * A footprint is at least two tiles across, which is `38` logical units, and the
 * three heats are `20` and `15` points apart out of `100`. A read spanning even a
 * quarter of its footprint therefore moves more than a unit per step, so a unit
 * is the floor at which a change is a change rather than a rounding.
 */
const STEP = 1;

/** The footprint a `size`-tile tower anchored at `(col, row)` occupies. */
function footprint(col: number, row: number, size: number): ControlRect {
  return {
    x: tileLeft(col),
    y: tileTop(row),
    w: size * TILE,
    h: size * TILE,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lengthens the Stutter's heat read with its heat", async () => {
  startRun(h);
  const id = posePinnedTower(h, TYPE, FREE_SITE.col, FREE_SITE.row, HEATS[0]);
  const tower = towerOf(h.snapshot(), id, "the posed Stutter");
  const region = footprint(tower.col, tower.row, tower.size);

  assertEqual(
    tower.redline,
    REDLINE,
    "precondition: the Stutter's redline is 60 (specs/towers.md)",
  );

  const frames = new Map<number, DrawnRect[]>();
  for (const heat of [...HEATS, FULL_HEAT]) {
    h.debug.setTowerHeat(id, heat);
    frames.set(heat, await readRects(h, region));
    if (heat === HEATS[HEATS.length - 1]) captureStill(h, "heat");
    const posed = towerOf(h.snapshot(), id, `the Stutter at heat ${heat}`);
    assertEqual(
      posed.heat,
      heat,
      `precondition: the Stutter's heat is pinned at ${heat}`,
    );
  }

  const lowest = frames.get(HEATS[0]) ?? [];
  const fullest = frames.get(FULL_HEAT) ?? [];
  const read = findSpanMark(lowest, fullest, SLACK);
  assertTrue(
    read !== null,
    `a mark on the Stutter's footprint with one end in the same place at heat ` +
      `${HEATS[0]} and at heat ${FULL_HEAT} and a different length, which is ` +
      `what a heat read whose extent tracks its heat is (specs/hud.md)`,
  );
  if (read === null) return;

  // The extent grows with the heat, strictly, at every step.
  let previous: number | null = null;
  for (const heat of HEATS) {
    const extent = spanAt(frames.get(heat) ?? [], read, SLACK);
    assertTrue(
      extent !== null,
      `the heat read to still be drawn at heat ${heat}`,
    );
    if (extent === null) return;
    if (previous !== null) {
      assertGreaterThanOrEqual(
        extent - previous,
        STEP,
        `how much longer the heat read is at heat ${heat} than at the heat ` +
          `before it (specs/hud.md)`,
      );
    }
    previous = extent;
  }
});
