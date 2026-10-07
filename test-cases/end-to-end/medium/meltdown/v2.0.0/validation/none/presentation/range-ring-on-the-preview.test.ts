// Meltdown — presentation/range-ring-on-the-preview — the held preview draws a ring at
// the held type's range, centred on its footprint.
//
// THE RULE. specs/building.md: a held preview carries "a range ring at the held
// type's range, centred on the footprint's centre". specs/overview.md's
// legibility table asks for it too. specs/towers.md gives the range as a radius
// in tiles and specs/floor.md gives the tile size and the footprint's centre, so
// where the ring must be is arithmetic rather than taste.
//
// ONE SURFACE, BECAUSE THE PREVIEW AND THE SELECTION ARE TWO DRAWINGS. A build
// commonly draws one and not the other — the preview is drawn while a placement
// is armed and the selection while the inspector is open — so a build that draws
// the preview's ring and no selection ring must not grade as one that draws
// neither. The selection's ring is `presentation.range-ring-on-a-selection`'s.
//
// HOW A RING IS READ, AND WHY IT IS A DIFFERENCE BETWEEN TWO FRAMES. Nothing fixes
// what a ring looks like — its colour, its width, whether it is dashed or washed —
// and `specs/floor.md` puts a grid line on every tile boundary, which a hairline
// ring can be no brighter than. So the ring is not looked for as a colour: the same
// points are read with nothing armed and nothing selected, and then again with the
// preview held or the tower selected, and the ring is what MOVED. The floor art,
// the grid and the tower itself are identical in the two frames and cancel exactly.
// How much the picture moves on its own is measured rather than assumed: two quiet
// frames are read first, and the ring has to beat that movement by `NOISE_MARGIN`.
// No figure here says how strongly a ring must be drawn — `specs/overview.md` hands
// the palette and the glow to the build — so a quiet hairline over the floor reads
// exactly as a bright one does.
//
// AND WHY THE CIRCLE IS READ AT EVERY ANGLE. Sixteen bearings around the centre,
// each read across a narrow band of radii. A build that centred its ring on the
// footprint's top-left corner, or on the pointer, draws a circle that crosses this
// one at two bearings and misses it at the other fourteen, so requiring every
// bearing is what makes "centred on the footprint's centre" a reading rather than a
// hope.
//
// HOW THE RADIUS IS PINNED. A second band of the same sixteen bearings, two tiles
// further out, must stay inside its OWN measured movement — nothing new drawn
// there. A ring drawn too small is already refused by the
// first band finding nothing; this refuses one drawn too large, and one drawn
// across the whole floor. There is deliberately no equivalent band INSIDE the
// ring: `specs/building.md` says a ring at the range and says nothing against a
// build that also washes the ground it covers, and a check that forbade the wash
// would be inventing a rule.
//
// WHAT IT DOES NOT DECIDE. What the range IS for each type and level is
// `towers/`'s items, and what an emitter can reach is `combat/`'s. This item is
// about the ring being drawn, at that range, around that centre.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { TILE, TOWER_DEFS, emitterStats, footprintCentre } from "../constants";
import type { EmitterDef, TowerType } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  startRun,
  type Harness,
  type Rgb,
} from "../harness";
import { NOISE_MARGIN, readPixels, type Point } from "./read";

/** The bearings the circle is read at. */
const BEARINGS = 16;

/**
 * How far either side of the exact radius the ring is looked for, in units.
 *
 * `specs/building.md` fixes the radius and leaves the line width, the softness of
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

/** The two towers read, and where each stands, clear of the casing. */
const PREVIEW_TYPE: TowerType = "lance";
const PREVIEW_AT = { col: 23, row: 17 } as const;

/**
 * Each one's level-I range, in logical units.
 *
 * `specs/towers.md` gives a range as "a radius in tiles" and `specs/floor.md`
 * gives `TILE`, so this is the specification's own figure and nothing the build
 * was asked for. Both are placed at level `1`, which `specs/building.md` says a
 * placed tower starts at and which is also what a held preview shows.
 */
const PREVIEW_RADIUS =
  emitterStats(TOWER_DEFS[PREVIEW_TYPE] as EmitterDef, 1).range * TILE;

/** One band of points: `BEARINGS` bearings, each across a slack of radii. */
function bandPoints(centre: Point, radius: number): Point[] {
  const points: Point[] = [];
  for (let n = 0; n < BEARINGS; n += 1) {
    const theta = (2 * Math.PI * n) / BEARINGS;
    for (let d = -RADIUS_SLACK; d <= RADIUS_SLACK; d += 1) {
      points.push({
        x: centre.x + (radius + d) * Math.cos(theta),
        y: centre.y + (radius + d) * Math.sin(theta),
      });
    }
  }
  return points;
}

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Read the two bands twice quietly and once with `show` done, and hand back what
 * moved at each bearing on each band, against the floor's own movement.
 */
async function ringReading(
  h: Harness,
  centre: Point,
  radius: number,
  show: () => Promise<void>,
  outputId?: string,
): Promise<{
  ring: number[];
  quiet: number[];
  noise: number[];
  quietNoise: number[];
}> {
  const ring = bandPoints(centre, radius);
  const outside = bandPoints(centre, radius + QUIET_TILES_OUT * TILE);
  const points = [...ring, ...outside];

  await h.advance(1);
  const first = await readPixels(h, points);
  await h.advance(1);
  const second = await readPixels(h, points);

  await show();
  await h.advance(1);
  if (outputId !== undefined) await captureStill(h, outputId);
  const shown = await readPixels(h, points);

  const split = ring.length;
  return {
    ring: shiftPerBearing(second.slice(0, split), shown.slice(0, split)),
    quiet: shiftPerBearing(second.slice(split), shown.slice(split)),
    noise: shiftPerBearing(first.slice(0, split), second.slice(0, split)),
    quietNoise: shiftPerBearing(first.slice(split), second.slice(split)),
  };
}

it("draws a range ring at the held type's range around the held footprint", async () => {
  await startRun(h);
  const size = TOWER_DEFS[PREVIEW_TYPE].size;
  const centre = footprintCentre(PREVIEW_AT.col, PREVIEW_AT.row, size);
  const radius = PREVIEW_RADIUS;

  // THE PREVIEW IS PUT ON ITS TILE BOTH WAYS: POSED, AND BY THE POINTER.
  // This reading is of the FINISHED PICTURE and so needs frames to run with the
  // preview held — and a frame hands the build a frame of input, which nothing
  // in `specs/instrumentation.md` makes a pose survive: a build that reads
  // `specs/building.md`'s "The preview follows the pointer" as the invariant it
  // is written as re-derives the held footprint from the pointer on every frame,
  // and a posed preview plus a frame would put the preview back under a pointer
  // that never moved. So both routes are taken, and both name the same tile:
  // `setPreview` puts the footprint's top-left there "exactly where the call
  // names it", and the pointer is moved to the footprint's centre so a build
  // re-deriving from `specs/controls.md`'s "the `size x size` block nearest the
  // pointer" derives the same block. A build that keeps its pose keeps it; a
  // build that re-derives derives this tile; and the read-back below fires only
  // when NEITHER route put the footprint where this reading is taken. Whether
  // the pointer alone moves the preview is `controls/pointer-moves-the-preview`,
  // which is the point that owns it — it is not charged here as well.
  const reading = await ringReading(
    h,
    centre,
    radius,
    async () => {
      await h.debug.setArmed(PREVIEW_TYPE);
      await h.debug.setPreview(PREVIEW_AT.col, PREVIEW_AT.row);
      await h.debug.pointerMove(centre.x, centre.y);
      await h.advance(1);
    },
    "ring",
  );

  // The posing is read back before the picture is: a ring read around a
  // footprint that neither the pose nor the pointer put there decides nothing.
  const held = (await h.snapshot()).build;
  assertEqual(
    held?.col,
    PREVIEW_AT.col,
    `posing: the column the pose and the pointer both named for the held ${PREVIEW_TYPE} on ` +
      `(specs/building.md, specs/controls.md)`,
  );
  assertEqual(
    held?.row,
    PREVIEW_AT.row,
    `posing: the row the pose and the pointer both named for the held ${PREVIEW_TYPE} on ` +
      `(specs/building.md, specs/controls.md)`,
  );

  for (let n = 0; n < BEARINGS; n += 1) {
    assertGreaterThanOrEqual(
      reading.ring[n],
      reading.noise[n] + NOISE_MARGIN,
      `a held ${PREVIEW_TYPE} on tile (${PREVIEW_AT.col}, ${PREVIEW_AT.row}): ` +
        `something is drawn ${radius} units from its footprint centre ` +
        `(${centre.x}, ${centre.y}) on bearing ${n} of ${BEARINGS} that was ` +
        `not there with nothing armed (specs/building.md: the preview carries ` +
        `a range ring at the held type's range, centred on the footprint's ` +
        `centre; specs/towers.md gives the ${PREVIEW_TYPE} ` +
        `${radius / TILE} tiles)`,
    );
    assertLessThanOrEqual(
      reading.quiet[n],
      reading.quietNoise[n] + NOISE_MARGIN,
      `a held ${PREVIEW_TYPE}: the floor ${QUIET_TILES_OUT} tiles OUTSIDE that ` +
        `ring, on bearing ${n} of ${BEARINGS}, is untouched, so the ring is at ` +
        `the ${radius / TILE}-tile range rather than a larger one ` +
        `(specs/building.md)`,
    );
  }
});
