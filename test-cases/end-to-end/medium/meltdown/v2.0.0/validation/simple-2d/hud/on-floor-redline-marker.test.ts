// hud/on-floor-redline-marker — the heat read a placed tower carries on its
// footprint is marked at the tower's redline.
//
// THE RULE. specs/hud.md, The reads on the floor: "Each placed tower carries a
// heat read on its footprint whose extent tracks its heat, with a marker at the
// tower's redline." That the extent tracks the heat at all is
// `hud/on-floor-heat-read`'s requirement; this point decides the marker, and only
// the marker.
//
// THE READ IS FOUND FIRST, BECAUSE A MARKER IS A MARK ALONG ONE. The same tower,
// on the same tile, at the same type, level and rotation, is drawn at
// {@link HEATS} and nothing between the frames changes but the heat. A rectangle
// that reaches further at each of them is the read's extent; everything else the
// footprint carries — the body, the radiator faces, the track behind the read —
// reaches the same distance at all four and is not it. `hud/bar.ts` does that
// reading, and it tries all four ways round a bar may fill, so a build that draws
// its read as an upright thermometer is read exactly as one that draws a strip.
//
// THE TWO SCALINGS THE SPECIFICATION ALLOWS. specs/hud.md puts a marker "at the
// tower's redline" and does not say what the read is scaled over, so a build may
// run it from `0` to `TRIP_HEAT` — the heat's own range, with the marker inside —
// or from `0` to the redline, with the marker at the far end. Both are conformant,
// so the marker is due at one of those two points along the read's own track,
// whose full extent is the frame at `TRIP_HEAT`. What is looked for there is a
// mark every one of the four frames drew identically — the marker cannot move
// with the heat, or it would be a second read rather than a mark — whose centre
// falls within {@link MARKER_TOLERANCE} of one of them. A rectangle and a
// straight stroked segment both count, because specs/hud.md fixes no primitive
// for a mark and a tick drawn either way leaves the same picture.
//
// AND A MARK ON THE READ, NOT ONE BESIDE IT. A footprint carries a great deal
// besides its heat read — a body, radiator faces, their ticks, level pips — and
// any of those could land near the redline's position along the track by
// accident. So a candidate has to be ON the read in both directions: it must
// cross the read's own band, which is to say cover the centre line the read is
// drawn about, and it must overlap the track along the track's length. It must
// also be no more than {@link MARKER_THICKNESS} times the read's own thickness
// deep, which is what tells a tick sitting on the heat bar from a radiator face
// or an outline running the whole side of the footprint. `structured-2d`'s copy
// of this point holds a marker to readings of the same two kinds, and to the same
// three times.
//
// A LANCE, BECAUSE ITS REDLINE IS THE ONE THAT PROVES A MARKER RATHER THAN A
// DECORATION. specs/towers.md gives it 92, so on a `0`-to-`TRIP_HEAT` read the mark
// is due nine tenths of the way along the track and nowhere near the middle: a
// build that centres a tick misses both points. Its 4x4 footprint is also the
// largest this case has, so the track it is drawn on is as long as this floor
// makes them and the tolerance is at its most demanding in proportion.
//
// THE HEAT IS PINNED AT EVERY FRAME. `posePinnedTower` holds the tower's part in
// the heat model (specs/instrumentation.md), so each frame draws the heat this
// check posed rather than one that has already begun to cool; and the floor holds
// nothing else, so nothing conducts with it, nothing is fired at, and the tower at
// `TRIP_HEAT` never crosses into a trip — the trip is a crossing the heat model
// makes, and the model is held (specs/heat.md, The trip).
//
// WHAT IT DOES NOT DECIDE. That the read's extent tracks the heat is
// `hud.on-floor-heat-read`; what the redline DOES is the `heat` and `trip` groups.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { TILE, TOWER_DEFS, TRIP_HEAT, tileLeft, tileTop } from "../constants";
import { sizeOf } from "../geometry";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnRects,
  drawnSegments,
  posePinnedTower,
  startRun,
  type DrawnRect,
  type Harness,
} from "../harness";
import { drawnInEveryFrame, findBar } from "./bar";
import { showRect } from "./read";

/** The tower read, and the redline specs/towers.md gives it: 92. */
const TYPE = "lance";
const DEF = TOWER_DEFS[TYPE];
const REDLINE = DEF.kind === "emitter" ? DEF.redline : 0;

/** A quiet anchor: no opening and no corridor within a 4x4 footprint of it. */
const AT = { col: 4, row: 4 };

/**
 * The heats the read is drawn at, in rising order, the last of them the top of
 * the scale.
 *
 * The first three are spread across the scale so the read has to move three
 * times rather than once, and `TRIP_HEAT` is what gives the track its full
 * extent, which is what the marker's position is measured along.
 */
const HEATS = [20, 50, 80, TRIP_HEAT];

/**
 * How much further the read must reach between consecutive heats, in logical
 * units.
 *
 * The steps above are 30, 30 and 20 points of a 100-point scale, so a read drawn
 * across even a quarter of this 76-unit footprint moves by five units and more at
 * every one of them. One unit is a floor rather than a target: it refuses a read
 * that does not move while admitting one drawn on a track of any length.
 */
const STEP_MIN = 1;

/**
 * How far the marker's centre may sit from either of the two points the two
 * allowed scalings put it at, in logical units.
 *
 * A marker is a tick of its own width and a build may centre it on the redline or
 * hang it from one side, so a few units of slack is honest. Four is about a
 * twentieth of this tower's 76-unit footprint, which is far tighter than the gap
 * between those two points and the middle of the track, 29 units from the nearer
 * of them.
 */
const MARKER_TOLERANCE = 4;

/**
 * How much deeper than the read a mark may be and still be sitting ON it: three
 * times.
 *
 * A marker drawn to overhang the bar it marks is ordinary — this Lance's own is
 * twice the read's depth — and three times carries a generous overhang while
 * still refusing anything as deep as the footprint, whose side is twenty-five
 * times the read's depth. It is the figure `structured-2d`'s copy of this point
 * holds a marker to.
 */
const MARKER_THICKNESS = 3;

/** How far outside the footprint a rectangle may reach and still be part of the
 * read: the read is drawn ON the footprint (specs/hud.md), and a unit of slack
 * covers a border stroked on its edge. */
const FOOTPRINT_SLACK = 1;

/** The run the tower is read on. */
const MODE = "containment";
const DIFFICULTY = "hard";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("marks the Lance's redline along its heat read", async () => {
  startRun(h, MODE, DIFFICULTY);
  h.debug.setPhase("wave");

  const id = posePinnedTower(h, TYPE, AT.col, AT.row, HEATS[0]);

  const span = sizeOf(TYPE) * TILE;
  const left = tileLeft(AT.col);
  const top = tileTop(AT.row);
  const onFootprint = (rect: DrawnRect): boolean =>
    rect.left >= left - FOOTPRINT_SLACK &&
    rect.right <= left + span + FOOTPRINT_SLACK &&
    rect.top >= top - FOOTPRINT_SLACK &&
    rect.bottom <= top + span + FOOTPRINT_SLACK;

  const frames: DrawnRect[][] = [];
  // The straight segments of the same frames, read beside the rectangles: a
  // marker is a MARK, and specs/hud.md fixes no primitive for one, so a tick
  // stroked `moveTo`/`lineTo` counts exactly as a thin rectangle does. They are
  // kept apart from the rectangles because `findBar` below is looking for the
  // READ — a filled block whose extent grows with the heat — and a segment is
  // not one.
  const segmentFrames: DrawnRect[][] = [];
  for (const heat of HEATS) {
    h.debug.setTowerHeat(id, heat);
    const calls = await drawFrame(h);
    if (heat === HEATS[2]) captureStill(h, "redline");
    frames.push(drawnRects(h, calls).filter(onFootprint));
    segmentFrames.push(drawnSegments(h, calls).filter(onFootprint));
  }

  const bar = findBar(
    frames,
    1,
    STEP_MIN,
    `a heat read on the ${TYPE}'s footprint whose extent grows with its heat ` +
      `across ${HEATS.join(", ")} (specs/hud.md, The reads on the floor)`,
  );

  const track = bar.rects[bar.rects.length - 1];
  // The two points the two allowed scalings put the redline at: the redline's
  // fraction of a read running the whole heat scale, and the far end of one
  // running only to the redline (specs/hud.md).
  const marks = [
    bar.axis.along(track, REDLINE / TRIP_HEAT),
    bar.axis.along(track, 1),
  ];
  const offBy = (rect: DrawnRect): number =>
    Math.min(...marks.map((mark) => Math.abs(bar.axis.centre(rect) - mark)));
  // A mark ON the read, which is what "a marker at the tower's redline" is. Three
  // readings, all of them about the read's own track rather than about the
  // footprint: the mark crosses the band the read is drawn in, it is no deeper
  // than a mark on that band can be, and it sits somewhere along the track's own
  // length. A radiator tick, a face strip, a level pip or the body fails at least
  // one of them wherever on the footprint it is drawn.
  const [bandNear, bandFar] = bar.axis.acrossRange(track);
  const bandCentre = (bandNear + bandFar) / 2;
  const bandDepth = bandFar - bandNear;
  const trackNear = bar.axis.centre(track) - bar.axis.extent(track) / 2;
  const trackFar = bar.axis.centre(track) + bar.axis.extent(track) / 2;
  const onTheRead = (rect: DrawnRect): boolean => {
    const [near, far] = bar.axis.acrossRange(rect);
    const half = bar.axis.extent(rect) / 2;
    return (
      near <= bandCentre &&
      far >= bandCentre &&
      far - near <= MARKER_THICKNESS * bandDepth &&
      bar.axis.centre(rect) + half >= trackNear &&
      bar.axis.centre(rect) - half <= trackFar
    );
  };
  const fixed = [
    ...drawnInEveryFrame(frames),
    ...drawnInEveryFrame(segmentFrames),
  ].filter(onTheRead);
  const nearest = fixed.reduce<DrawnRect | null>(
    (best, rect) => (best === null || offBy(rect) < offBy(best) ? rect : best),
    null,
  );

  assertLessThanOrEqual(
    nearest === null ? Infinity : offBy(nearest),
    MARKER_TOLERANCE,
    `how far the nearest mark that does not move with the heat sits from the ` +
      `${TYPE}'s redline of ${REDLINE} on a read ${bar.axis.name}: ` +
      `${marks[0].toFixed(1)} along one scaled over 0 to ${TRIP_HEAT}, or ` +
      `${marks[1].toFixed(1)} along one scaled over 0 to the redline ` +
      `(specs/hud.md, The reads on the floor); the read filled ` +
      `${bar.extents.map((e) => e.toFixed(1)).join(", ")} across heats ` +
      `${HEATS.join(", ")}, and the nearest fixed mark was ` +
      `${nearest === null ? "none at all" : showRect(nearest)}`,
  );
});
