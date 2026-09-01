// hud/on-floor-redline-marker — the heat read a placed tower carries on its
// footprint is marked at the tower's redline.
//
// THE RULE. specs/hud.md, The reads on the floor: "Each placed tower carries a
// heat read on its footprint whose extent tracks its heat, with a marker at the
// tower's redline." The heat scale is specs/heat.md's `0` to `TRIP_HEAT` (`100`)
// and the redline is the per-tower figure specs/towers.md tabulates. That the
// read's extent tracks the heat is `hud/on-floor-heat-read`'s requirement; this
// point decides the marker, and only the marker.
//
// THE READ IS FOUND FIRST, BECAUSE A MARKER IS A MARK ALONG ONE. A read whose
// extent tracks a quantity is a mark that STAYS PUT and CHANGES LENGTH as the
// quantity changes, so that is what is looked for: among the rectangles the frame
// drew over the footprint, the one drawn at the same place at a low heat and at a
// full one with a different span. Nothing here names a colour, a side of the
// footprint, or an axis, and specs/overview.md fixes no palette to name anyway. A
// build that draws no such mark has nothing to carry a marker and fails here as
// well as there, which is the one thing the two points share.
//
// THE MARKER, AND THE TWO SCALINGS THE SPECIFICATION ALLOWS. specs/hud.md puts a
// marker "at the tower's redline" and does not say what the read is scaled over,
// so a build may run it from `0` to `100` — the heat's own range, with the marker
// inside — or from `0` to the redline, with the marker at the far end. Both are
// conformant, so the marker is required at one of those two positions along the
// read, measured against the read's own full extent, which is read at heat `100`.
// A Stutter is used because its redline is `60`: on a `0`-to-`100` read its
// marker sits three fifths of the way along, plainly apart from either end, so a
// build that stamped a marker at a fixed place fails.
//
// AND WHY THE MARKER MAY NOT BE THE READ ITSELF. Every read ends where its own
// far end is, and on a `0`-to-redline scaling that is exactly where the marker
// goes — so a mark that begins where the read begins is the read's own fill or
// its backing and is refused as a marker, however it ends. What is left is a mark
// drawn somewhere ALONG the read, which is the only thing a marker can be. It
// must also be part of the read rather than of the footprint: its cross-axis span
// is held to three times the read's own and its cross-axis centre to within the
// read's span, which is what tells a marker sitting on a heat bar from a radiator
// face or a body outline running the length of the footprint.
//
// THE HEAT IS PINNED at each reading, through `setTowerThermal(id, false)`, which
// holds the tower's part in the heat model, so the read is drawn at the heat this
// point posed rather than at one that has begun to cool. The floor is otherwise
// empty, so no shot and no neighbour can move it either.

import { afterEach, beforeEach, it } from "vitest";
import { TILE, tileLeft, tileTop } from "../../src/constants";
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
  marksAt,
  readRects,
  spanAt,
  towerOf,
  type DrawnRect,
} from "./panel";
import { FREE_SITE } from "./sites";

/** The tower read. Its redline of 60 puts a marker clear of either end. */
const TYPE = "stutter" as const;
const REDLINE = emitterDef(TYPE).redline;

/** The two heats the read is drawn at: one low, and the top of the heat scale. */
const LOW_HEAT = 20;
const FULL_HEAT = 100;

/**
 * How far apart two rectangles may be drawn and still count as the same mark:
 * half a logical unit.
 *
 * A read's fill stays where it is and changes length, so its anchor is the same
 * number at both heats; half a unit is only the slack a build's own arithmetic
 * takes.
 */
const SLACK = 0.5;

/**
 * How far from its stated position the redline marker may sit: three logical
 * units.
 *
 * A marker is a mark of some thickness drawn AT a position, and a build is free
 * to centre it on that position or to start it there, so three units carries a
 * marker up to six units thick either way. It is a twentieth of a 2x2 footprint's
 * side and a fifth of the distance between the two positions the two scalings put
 * the marker at on this tower.
 */
const MARKER_SLACK = 3;

/**
 * How much thicker than the read a mark may be and still be sitting on it: three
 * times.
 *
 * A marker drawn to overhang the bar it marks is ordinary, and three times its
 * thickness carries a generous overhang while still refusing anything spanning a
 * footprint eight times the read's own thickness.
 */
const MARKER_THICKNESS = 3;

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

it("marks the Stutter's redline along its heat read", async () => {
  startRun(h);
  const id = posePinnedTower(h, TYPE, FREE_SITE.col, FREE_SITE.row, LOW_HEAT);
  const tower = towerOf(h.snapshot(), id, "the posed Stutter");
  const region = footprint(tower.col, tower.row, tower.size);

  assertEqual(
    tower.redline,
    REDLINE,
    "precondition: the Stutter's redline is 60 (specs/towers.md)",
  );

  const frames = new Map<number, DrawnRect[]>();
  for (const heat of [LOW_HEAT, FULL_HEAT]) {
    h.debug.setTowerHeat(id, heat);
    frames.set(heat, await readRects(h, region));
    if (heat === FULL_HEAT) captureStill(h, "redline");
    const posed = towerOf(h.snapshot(), id, `the Stutter at heat ${heat}`);
    assertEqual(
      posed.heat,
      heat,
      `precondition: the Stutter's heat is pinned at ${heat}`,
    );
  }

  const lowest = frames.get(LOW_HEAT) ?? [];
  const fullest = frames.get(FULL_HEAT) ?? [];
  const read = findSpanMark(lowest, fullest, SLACK);
  assertTrue(
    read !== null,
    `a mark on the Stutter's footprint with one end in the same place at heat ` +
      `${LOW_HEAT} and at heat ${FULL_HEAT} and a different length, which is ` +
      `the heat read the marker is drawn along (specs/hud.md)`,
  );
  if (read === null) return;

  // The marker, at one of the two positions the two allowed scalings put it at.
  const full = spanAt(fullest, read, SLACK);
  assertTrue(full !== null, `the heat read to be drawn at heat ${FULL_HEAT}`);
  if (full === null) return;
  const [drawn] = marksAt(fullest, read, SLACK);
  if (drawn === undefined) return;

  const { axis } = read;
  const band = acrossSpan(drawn, axis);
  const bandCentre = acrossCentre(drawn, axis);
  const origin = axis === "x" ? read.anchor.x : read.anchor.y;
  const over100 = origin + read.direction * ((full * REDLINE) / 100);
  const overRedline = origin + read.direction * full;

  const markers = fullest.filter((mark) => {
    // Part of the READ: a mark of about the read's own thickness, sitting on its
    // band, rather than a radiator face or a body outline running the
    // footprint's length.
    if (acrossSpan(mark, axis) > MARKER_THICKNESS * band) return false;
    if (Math.abs(acrossCentre(mark, axis) - bandCentre) > band) return false;
    // Neither the read's own fill nor its backing, both of which BEGIN where the
    // read does. A mark with an end at the origin is one of those, whatever its
    // far end lands on.
    const ends = [
      along(mark, axis),
      along(mark, axis) + (axis === "x" ? mark.w : mark.h),
    ];
    if (ends.some((at) => Math.abs(at - origin) <= MARKER_SLACK)) return false;
    return ends.some(
      (at) =>
        Math.abs(at - over100) <= MARKER_SLACK ||
        Math.abs(at - overRedline) <= MARKER_SLACK,
    );
  });

  assertGreaterThanOrEqual(
    markers.length,
    1,
    `a marker on the heat read at the Stutter's redline of ${REDLINE}: ` +
      `${over100.toFixed(1)} along a read scaled over 0 to 100, or ` +
      `${overRedline.toFixed(1)} along one scaled over 0 to the redline ` +
      `(specs/hud.md)`,
  );
});
