// presentation/range-ring-on-a-selection — a selected tower draws a ring at its
// own range, centred on its footprint.
//
// THE RULE. specs/building.md: selecting a placed tower "draws a range ring at
// that tower's range, centred on its footprint's centre". specs/overview.md's
// legibility table asks for it too. specs/towers.md gives the range as a radius
// in tiles and specs/floor.md gives the tile size and the footprint's centre, so
// where the ring must be is arithmetic rather than taste.
//
// ONE SURFACE, BECAUSE THE PREVIEW AND THE SELECTION ARE TWO DRAWINGS. A build
// commonly draws one and not the other, so a build that draws the selection's
// ring and no preview ring must not grade as one that draws neither. The
// preview's ring is `presentation.range-ring-on-the-preview`'s.//
// HOW A RING IS READ, AND WHY IT IS A DIFFERENCE BETWEEN TWO FRAMES. Nothing
// fixes what a ring looks like — its colour, its width, whether it is dashed or
// washed — and specs/floor.md puts a grid line on every tile boundary, which a
// hairline ring can be no brighter than. So the ring is not looked for as a
// colour, and it is never held against the floor the same build drew: the same
// points are read with nothing armed and nothing selected, and then again with
// the preview held or the tower selected, and the ring is what MOVED. The floor
// art, the grid and the tower itself are identical in the two frames and cancel
// exactly. How much the picture moves on its own is measured rather than assumed:
// two quiet frames are read first, and the ring has to beat that movement by
// `NOISE_MARGIN`. No figure here says how strongly a ring must be drawn, so a
// quiet hairline over the floor reads exactly as a bright one does.
//
// AND WHY THE CIRCLE IS READ AT EVERY ANGLE. Sixteen bearings around the centre,
// each read across a narrow band of radii. A build that centred its ring on the
// footprint's top-left corner, or on the pointer, draws a circle that crosses
// this one at two bearings and misses it at the other fourteen, so requiring
// every bearing is what makes "centred on the footprint's centre" a reading
// rather than a hope.
//
// HOW THE RADIUS IS PINNED. A second band of the same sixteen bearings, two tiles
// further out, must stay inside its OWN measured movement — nothing new drawn
// there. A ring drawn too small is already refused by the first band finding
// nothing; this refuses one drawn too large, and one drawn across the whole
// floor. There is deliberately no equivalent band INSIDE the ring:
// specs/building.md says a ring at the range and says nothing against a build
// that also washes the ground it covers, and a check that forbade the wash would
// be inventing a rule.
//
// AN ARC, AND WHY IT STANDS WHERE IT DOES. Its `6.0` tiles put the whole ring,
// and the quiet band two tiles outside it, comfortably inside the floor from the
// tile chosen, so no part of either reading falls on the casing or on the build
// panel.
//
// WHAT IT DOES NOT DECIDE. What a tower can actually hit at that range is
// `combat.range`; that arming holds a preview and that pressing a tower selects
// it are `building`'s; that a valid footprint reads apart from a refused one is
// `valid-and-invalid-previews-read-apart`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { TILE, TOWER_DEFS, emitterStats } from "../constants";
import { footprintCentreOf, type Point } from "../geometry";
import {
  captureStill,
  colorDistance,
  createHarness,
  startRun,
  type Harness,
  type Rgb,
} from "../harness";
import type { TowerType } from "../surface";
import { poseStillTower } from "./pose";
import { NOISE_MARGIN, readPoints } from "./read";

/** The bearings the circle is read at. */
const BEARINGS = 16;

/**
 * How far either side of the exact radius the ring is looked for, in units.
 *
 * specs/building.md fixes the radius and leaves the line width, the softness of
 * its edge and any glow under it to the build. Five units is about a quarter of a
 * `TILE`, which admits a thick ring and an anti-aliased one, and is a long way
 * inside the two tiles the quiet band sits out at.
 */
const RADIUS_SLACK = 5;

/**
 * How far outside the ring the quiet band is read, in tiles.
 *
 * Two tiles: eight times the slack above, so a build whose ring is where the
 * specification puts it cannot reach the quiet band with any line width a player
 * would call a ring, while a ring drawn a whole tile wrong is refused.
 */
const QUIET_TILES_OUT = 2;

/** The tower the ring is read on, and the tile it is anchored at. */
const TYPE: TowerType = "arc";
const COL = 24;
const ROW = 17;

/** The centre the ring is drawn from, and the range it is drawn at. */
const CENTRE: Point = footprintCentreOf(TYPE, COL, ROW);
const DEF = TOWER_DEFS[TYPE];
if (DEF.kind !== "emitter") {
  // A fault in this check rather than a verdict about the build: only an emitter
  // has a range for a ring to be drawn at (specs/towers.md).
  throw new Error(
    `meltdown presentation/range-ring-on-a-selection.test.ts: ${TYPE} is not an emitter`,
  );
}
/** Level I, which is what a held preview and a freshly placed tower carry. */
const RANGE = emitterStats(DEF, 1).range;
const RADIUS = RANGE * TILE;

/** One band of points: `BEARINGS` bearings, each across a slack of radii. */
function bandPoints(radius: number): Point[] {
  const points: Point[] = [];
  for (let n = 0; n < BEARINGS; n += 1) {
    const theta = (2 * Math.PI * n) / BEARINGS;
    for (let d = -RADIUS_SLACK; d <= RADIUS_SLACK; d += 1) {
      points.push({
        x: CENTRE.x + (radius + d) * Math.cos(theta),
        y: CENTRE.y + (radius + d) * Math.sin(theta),
      });
    }
  }
  return points;
}

/** The two bands, ring first, read in one pass over the frame on the canvas. */
const RING = bandPoints(RADIUS);
const OUTSIDE = bandPoints(RADIUS + QUIET_TILES_OUT * TILE);
const POINTS = [...RING, ...OUTSIDE];

/** How far each bearing's strongest pixel moved between two readings. */
function shiftPerBearing(
  before: readonly Rgb[],
  after: readonly Rgb[],
): number[] {
  const stride = 2 * RADIUS_SLACK + 1;
  const shifts: number[] = [];
  for (let n = 0; n < BEARINGS; n += 1) {
    let best = 0;
    for (let i = n * stride; i < (n + 1) * stride; i += 1) {
      best = Math.max(best, colorDistance(before[i], after[i]));
    }
    shifts.push(best);
  }
  return shifts;
}

/**
 * Read the two bands twice quietly and once with `show` done, and hand back what
 * moved at each bearing on each band, against the floor's own movement.
 */
async function ringReading(
  h: Harness,
  show: () => void,
): Promise<{
  ring: number[];
  quiet: number[];
  noise: number[];
  quietNoise: number[];
}> {
  await h.advance(1);
  const first = readPoints(h, POINTS);
  await h.advance(1);
  const second = readPoints(h, POINTS);

  show();
  await h.advance(1);
  captureStill(h, "ring");
  const shown = readPoints(h, POINTS);

  const split = RING.length;
  return {
    ring: shiftPerBearing(second.slice(0, split), shown.slice(0, split)),
    quiet: shiftPerBearing(second.slice(split), shown.slice(split)),
    noise: shiftPerBearing(first.slice(0, split), second.slice(0, split)),
    quietNoise: shiftPerBearing(first.slice(split), second.slice(split)),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a ring at a selected tower's range around it", async () => {
  startRun(h);
  const id = poseStillTower(h, TYPE, COL, ROW);
  const reading = await ringReading(h, () => {
    h.debug.setSelected(id);
  });

  for (let n = 0; n < BEARINGS; n += 1) {
    assertGreaterThanOrEqual(
      reading.ring[n],
      reading.noise[n] + NOISE_MARGIN,
      `a selected ${TYPE} on tile (${COL}, ${ROW}): something is drawn ` +
        `${RANGE} tiles (${RADIUS} units) from its footprint centre on ` +
        `bearing ${n} of ${BEARINGS} that was not there while it stood ` +
        `unselected (specs/building.md: selecting draws a range ring at that ` +
        `tower's range, centred on its footprint's centre; specs/towers.md ` +
        `gives an ${TYPE} ${RANGE} tiles)`,
    );
    assertLessThanOrEqual(
      reading.quiet[n],
      reading.quietNoise[n] + NOISE_MARGIN,
      `a selected ${TYPE}: the floor ${QUIET_TILES_OUT} tiles OUTSIDE that ` +
        `ring, on bearing ${n} of ${BEARINGS}, is untouched, so the ring is ` +
        `at the ${RANGE}-tile range rather than a larger one ` +
        `(specs/building.md)`,
    );
  }
});
