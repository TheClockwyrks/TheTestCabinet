// hud/on-floor-heat-read — a placed tower carries a heat read on its footprint
// whose extent tracks its heat, with a marker at its redline.
//
// `specs/hud.md`, The reads on the floor: "Each placed tower carries a heat read on
// its footprint whose extent tracks its heat, with a marker at the tower's
// redline."
//
// HOW AN EXTENT IS READ WHEN NOTHING FIXES THE LAYOUT OR THE COLOUR. A read whose
// extent tracks a quantity is a mark that STAYS PUT and CHANGES LENGTH as the
// quantity changes, so that is what is looked for: among the rectangles the frame
// drew over the footprint, the one drawn at the same place at two different heats
// with a different span. Nothing here names a colour, a side of the footprint, or
// an axis: a read running left to right and one running bottom to top are both
// found, and `specs/overview.md` fixes no palette to name anyway.
//
// A PIXEL COMPARISON WOULD NOT DO. A tower's body ramps with its heat — that is
// `presentation/heat-glow-ramp`'s requirement — so every pixel of the footprint
// changes between two heats whether or not a read was drawn, and a picture
// comparison would pass a build with no read at all. The mark the build drew is
// therefore what is measured.
//
// THREE HEATS, BECAUSE "TRACKS" IS A DIRECTION AND NOT A CHANGE. At `20`, `40` and
// `55` the read must be strictly longer each time. A build whose read has two
// states, or one drawn at a fixed length, or one that grows as the tower COOLS,
// fails; a build that draws no such mark at all has no extent to read and fails
// there. All three heats sit below the Stutter's redline of `60`, so the reading
// does not turn on how a build scales the part of the read past it.
//
// THE MARKER, AND THE TWO SCALINGS THE SPECIFICATION ALLOWS. `specs/hud.md` puts a
// marker "at the tower's redline" and does not say what the read is scaled over, so
// a build may run it from `0` to `100` — the heat's own range, with the marker
// inside — or from `0` to the redline, with the marker at the far end. Both are
// conformant, so the marker is required at one of those two positions along the
// read, measured against the read's own full extent, which is read at heat `100`.
// A Stutter is used because its redline is `60`: on a `0`-to-`100` read its marker
// sits three fifths of the way along, plainly apart from either end, so a build
// that stamped a marker at a fixed place fails.
//
// The marker must also be part of the READ rather than of the footprint: its
// cross-axis span is held to three times the read's own and its cross-axis centre
// to within the read's span, which is what tells a marker sitting on a heat bar
// from a radiator face or a body outline running the length of the footprint.
//
// THE HEAT IS PINNED at each reading, through `setTowerThermal(id, false)`, which
// holds the tower's part in the heat model (`specs/instrumentation.md`). The heat is
// the quantity being read, so a reading taken while it drifted would be a reading
// of the cooling rate. The floor is otherwise empty, so no shot and no neighbour
// can move it either.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertTrue } from "../assert";
import {
  TILE,
  TOWER_DEFS,
  isEmitter,
  tileLeft,
  tileTop,
  type Rect,
} from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";
import { findSpanMark, marksAt, rectsOver, spanAt, type DrawnRect } from "./panel";

/** The tower read. Its redline of 60 puts a marker clear of either end. */
const TYPE = "stutter" as const;
const DEF = TOWER_DEFS[TYPE];
const REDLINE = isEmitter(DEF) ? DEF.redline : 0;

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
 * quarter of its footprint therefore moves more than a unit per step, so a unit is
 * the floor at which a change is a change rather than a rounding.
 */
const STEP = 1;

/**
 * How far from its stated position the redline marker may sit: three logical units.
 *
 * A marker is a mark of some thickness drawn AT a position, and a build is free to
 * centre it on that position or to start it there, so three units carries a marker
 * up to six units thick either way. It is a twentieth of a 2x2 footprint's side and
 * a fifth of the distance between the two positions the two scalings put the
 * marker at on this tower.
 */
const MARKER_SLACK = 3;

/** The footprint a `size`-tile tower anchored at `(col, row)` occupies. */
function footprint(col: number, row: number, size: number): Rect {
  return {
    x: tileLeft(col),
    y: tileTop(row),
    w: size * TILE,
    h: size * TILE,
  };
}

/** Where a mark starts along `axis`, and how far it reaches across it. */
function along(rect: DrawnRect, axis: "x" | "y"): number {
  return axis === "x" ? rect.x : rect.y;
}
function acrossCentre(rect: DrawnRect, axis: "x" | "y"): number {
  return axis === "x" ? rect.y + rect.h / 2 : rect.x + rect.w / 2;
}
function acrossSpan(rect: DrawnRect, axis: "x" | "y"): number {
  return Math.abs(axis === "x" ? rect.h : rect.w);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("lengthens the Stutter's heat read with its heat, and marks its redline", async () => {
  await startRun(h);
  const id = await posePinnedTower(h, TYPE, FREE_SITE.col, FREE_SITE.row, HEATS[0]);
  const tower = requireTower(await h.snapshot(), id, "the posed Stutter");
  const region = footprint(tower.col, tower.row, tower.size);

  assertEqual(tower.redline, REDLINE, "precondition: the Stutter's redline is 60");

  const frames = new Map<number, DrawnRect[]>();
  for (const heat of [...HEATS, FULL_HEAT]) {
    await h.debug.setTowerHeat(id, heat);
    frames.set(heat, rectsOver(await h.frameCalls(), region));
    if (heat === HEATS[HEATS.length - 1]) await captureStill(h, "heat");
    const posed = requireTower(await h.snapshot(), id, `the Stutter at heat ${heat}`);
    assertEqual(posed.heat, heat, `precondition: the Stutter's heat is pinned at ${heat}`);
  }

  const lowest = frames.get(HEATS[0]) ?? [];
  const fullest = frames.get(FULL_HEAT) ?? [];
  const read = findSpanMark(lowest, fullest, SLACK);
  assertTrue(
    read !== null,
    `a mark on the Stutter's footprint with one end in the same place at heat ${HEATS[0]} and at heat ${FULL_HEAT} and a different length, which is what a heat read whose extent tracks its heat is`,
  );
  if (read === null) return;

  // The extent grows with the heat, strictly, at every step.
  let previous: number | null = null;
  for (const heat of HEATS) {
    const extent = spanAt(frames.get(heat) ?? [], read, SLACK);
    assertTrue(extent !== null, `the heat read to still be drawn at heat ${heat}`);
    if (extent === null) return;
    if (previous !== null) {
      assertGreaterThanOrEqual(
        extent - previous,
        STEP,
        `how much longer the heat read is at heat ${heat} than at the heat before it`,
      );
    }
    previous = extent;
  }

  // The marker, at one of the two positions the two allowed scalings put it at.
  const full = spanAt(fullest, read, SLACK);
  assertTrue(full !== null, `the heat read to be drawn at heat ${FULL_HEAT}`);
  if (full === null) return;
  const [drawn] = marksAt(fullest, read, SLACK);
  if (drawn === undefined) return;

  const axis = read.axis;
  const band = acrossSpan(drawn, axis);
  const bandCentre = acrossCentre(drawn, axis);
  const origin = axis === "x" ? read.anchor.x : read.anchor.y;
  const over100 = origin + read.direction * ((full * REDLINE) / 100);
  const overRedline = origin + read.direction * full;

  const markers = fullest.filter((mark) => {
    // Part of the READ: a mark of the read's own thickness, sitting on its band,
    // rather than a radiator face or a body outline running the footprint's length.
    if (acrossSpan(mark, axis) > 3 * band) return false;
    if (Math.abs(acrossCentre(mark, axis) - bandCentre) > band) return false;
    // Neither the read's own fill nor its backing, which begin where the read does.
    const ends = [along(mark, axis), along(mark, axis) + (axis === "x" ? mark.w : mark.h)];
    return ends.some(
      (at) =>
        Math.abs(at - origin) > MARKER_SLACK &&
        (Math.abs(at - over100) <= MARKER_SLACK ||
          Math.abs(at - overRedline) <= MARKER_SLACK),
    );
  });

  assertGreaterThanOrEqual(
    markers.length,
    1,
    `a marker on the heat read at the Stutter's redline of ${REDLINE}: ${over100.toFixed(1)} along a read scaled over 0 to 100, or ${overRedline.toFixed(1)} along one scaled over 0 to the redline`,
  );
});
