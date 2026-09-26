// presentation/surge-reads-apart-from-the-floor — every surge type is drawn where
// it stands.
//
// THE RULE. specs/overview.md's legibility table: "Ground units, flyers, and the
// boss read apart from one another, from the floor, and from every color a tower
// shows anywhere on its heat ramp." What a check can decide of that is presence:
// each of the six types specs/surge.md rosters is drawn on the tile it stands on.
// How far apart the six read from one another and from the floor is appearance,
// which the palette clause of the same specification hands to the build: "The
// palette, the type, the glow, and every other aspect of the look are yours."
//
// HOW A UNIT IS READ. A unit reports its CENTRE (specs/instrumentation.md), and
// the reading is taken over the TILE that centre stands on — the centre pixel
// and eight rays out to half a tile, which is `unitPoints` below, reduced by the
// widest step any one of them took. Not the centre alone: nothing fixes the
// shape a unit is drawn as, and a build that draws a big unit as a ring leaves
// the floor showing through the middle of it, so a centre-only reading would
// grade the shape rather than the presence. Half a tile is short of the
// neighbouring tiles and of anything drawn above the unit, so what answers is
// the unit on its own tile.
//
// WHY THE READING IS A REMOVAL. specs/instrumentation.md gives `clearSurge`, so
// the centre is read with the unit standing on it and again with the surge taken
// away, and the unit is what disappeared. The floor art under it, the grid line
// specs/floor.md puts on every tile boundary, and anything else the build laid
// there are identical in the two frames and cancel exactly. How much the picture
// moves on its own is measured first, by reading the same centres on two frames
// with the surge standing, and the removal has to beat that by `NOISE_MARGIN`.
//
// THE FLOOR IS POSED BARE. `startRun` opens on an empty floor with the run's own
// release of surge held, and each unit is posed standing still with its motion
// off, so nothing walks out of the tile it was read on and nothing arrives that
// the check did not ask for.
//
// WHAT IT DOES NOT DECIDE. What each type is worth, how fast it walks and how
// much it carries are the `surge` group's; the health bar over a unit is
// `hud.unit-health-bars`. Nothing here asserts a size, a shape or a colour.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { SURGE_TYPES, TILE } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseTarget,
  startRun,
  type Harness,
  type Rgb,
} from "../harness";
import { NOISE_MARGIN, readPoints, unitOf, type Point } from "./read";

/** The row the six stand on, the first column, and the pitch between them. */
const SURGE_ROW = 8;
const SURGE_COL0 = 5;
const SURGE_PITCH = 5;

/** The hp each unit is posed with, so its health bar is drawn full. */
const TARGET_HP = 10_000;

/**
 * How far from a unit's centre its own pixels are looked for: half a tile, which
 * is the tile it stands on.
 *
 * WHY NOT THE CENTRE ALONE. `specs/surge.md` fixes a unit's position as its
 * centre and fixes nothing about the size or the SHAPE it is drawn at —
 * specs/overview.md hands the build "the palette, the type, the glow, and every
 * other aspect of the look". A build that draws its Hulk as a ring leaves the
 * floor showing through the middle of it, so a reading taken on the centre alone
 * reads the floor and grades the shape rather than the presence. Half a tile
 * either way is the tile the unit stands on, which is what this point is about,
 * and it stops short of the neighbouring tiles and of anything drawn above the
 * unit, such as a health bar.
 */
const UNIT_REACH = TILE / 2;

/** The points one unit is read at: its centre and eight rays out to that reach. */
function unitPoints(at: { x: number; y: number }): Point[] {
  const points: Point[] = [{ x: at.x, y: at.y }];
  for (let d = 1; d <= UNIT_REACH; d += 1) {
    points.push(
      { x: at.x + d, y: at.y },
      { x: at.x - d, y: at.y },
      { x: at.x, y: at.y + d },
      { x: at.x, y: at.y - d },
      { x: at.x + d, y: at.y + d },
      { x: at.x - d, y: at.y - d },
      { x: at.x + d, y: at.y - d },
      { x: at.x - d, y: at.y + d },
    );
  }
  return points;
}

/** The biggest step between two readings of the same points. */
function widest(before: readonly Rgb[], after: readonly Rgb[]): number {
  let best = 0;
  for (let i = 0; i < before.length; i += 1) {
    best = Math.max(best, colorDistance(before[i], after[i]));
  }
  return best;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every surge type on the tile it stands on", async () => {
  startRun(h);
  const ids = SURGE_TYPES.map((type, index) =>
    poseTarget(h, type, SURGE_COL0 + index * SURGE_PITCH, SURGE_ROW, TARGET_HP),
  );
  await h.advance(1);

  const snapshot = h.snapshot();
  const centres = ids.map((id) => {
    const unit = unitOf(snapshot, id);
    return { x: unit.x, y: unit.y };
  });

  const patches = centres.map((at) => unitPoints(at));
  const read = (): Rgb[][] => patches.map((points) => readPoints(h, points));

  const first = read();
  await h.advance(1);
  const second = read();
  captureStill(h, "surge");

  h.debug.clearSurge();
  await h.advance(1);
  const cleared = read();

  SURGE_TYPES.forEach((type, index) => {
    const noise = widest(first[index], second[index]);
    assertGreaterThanOrEqual(
      widest(second[index], cleared[index]),
      noise + NOISE_MARGIN,
      `a ${type} on tile (${SURGE_COL0 + index * SURGE_PITCH}, ` +
        `${SURGE_ROW}): the patch on the tile it stands on changes when the ` +
        `surge is taken away, by more than the ${noise} two frames with it ` +
        `standing ` +
        `moved on their own (specs/overview.md: the surge reads apart from ` +
        `the floor)`,
    );
  });
});
