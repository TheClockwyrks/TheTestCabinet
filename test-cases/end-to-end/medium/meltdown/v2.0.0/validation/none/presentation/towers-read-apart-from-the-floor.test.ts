// presentation/towers-read-apart-from-the-floor — a tower reads apart from the
// floor behind it, whatever it is and however hot it is running.
//
// THE RULE. `specs/overview.md`'s legibility table: "Towers against the floor — A
// tower reads apart from the floor behind it." `specs/towers.md` fixes the roster
// it is asked of — six emitters and the two movers — and `specs/heat.md` the range
// an emitter's heat runs over, `0` to `TRIP_HEAT`. So the item is the whole
// roster, read against the floor beside it, at heats spread across that range.
//
// WHY THE FLOOR REFERENCE IS LOCAL AND WHY IT IS THE WORST OF FOUR. Nothing fixes
// what a floor looks like, and `specs/overview.md` leaves a build free to shade
// it, plate it or vignette it; `specs/floor.md` also puts a grid line on every
// tile boundary. So the floor a tower is compared against is read at four tile
// CENTRES, two tiles clear of the footprint on each of its four sides, and the
// reading used is whichever of the four is NEAREST the tower. A build that hides
// its Sink against a pale patch of floor on one side of it fails on that side,
// rather than passing on the average of four.
//
// WHY THE EMITTERS ARE PINNED. `posePinnedTower` holds each emitter's part in the
// heat model (`specs/instrumentation.md`), so the heat this check posed is the heat
// the frame drew. Air cooling is proportional to heat (`specs/heat.md`) and
// maximal near the trip, so an unpinned tower posed at 99 would be drawn at
// something lower, and the check would be reading a heat it did not choose. The
// two movers carry no heat of their own and report `0` for it forever
// (`specs/heat.md`), so they are read once per pass and their reading does not
// move.
//
// WHY THE WHOLE ROSTER STANDS AT ONCE. Eight towers, each at least three tiles
// clear of the next, so no two share an edge-tile and none is within reach of
// another's floor probes. `specs/heat.md` gives conduction only across a SHARED
// edge-tile, so a spread of eight is eight isolated towers rather than a thermal
// arrangement — and posing them together is what lets one frame answer for the
// roster instead of forty.
//
// WHAT IT DOES NOT DECIDE. That the ramp MOVES with the heat is
// `presentation/heat-glow-ramp`'s item, and a tripped tower is
// `presentation/tripped-reads-apart`'s. Here every reading is one tower against
// the floor.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import {
  EMITTER_TYPES,
  isEmitterType,
  TOWER_TYPES,
  TRIP_HEAT,
} from "../constants";
import type { TowerType } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseTower,
  posePinnedTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";
import {
  bodyPoints,
  floorProbePoints,
  medoid,
  nearest,
  readPixels,
  showRgb,
} from "./read";

/**
 * How far a tower's body must sit from the floor beside it, out of the 441 the
 * RGB cube spans.
 *
 * This group's figure for "plainly apart" (`specs/overview.md`), the same one
 * `presentation/heat-glow-ramp` holds the ramp's ends to. 60 is about a seventh
 * of the scale — a different shade at a glance under any palette a build chooses
 * — and well above the 25 a build's own floor art moves a patch by, so a build
 * cannot pass by shading its floor toward its towers and cannot fail for having
 * drawn a plate texture.
 */
const APART_MIN = 60;

/** The heats each emitter is read at, spread across `specs/heat.md`'s range. */
const HEATS: readonly number[] = [0, 25, 50, 75, TRIP_HEAT - 1];

/** Which pass leaves the picture behind: the middle of the ramp. */
const CAPTURE_AT = HEATS[2];

/**
 * Where each type stands, at least three tiles clear of every other, clear of
 * the casing and clear of both vent-to-exhaust corridors.
 */
const STANDS: Record<TowerType, { col: number; row: number }> = {
  arc: { col: 4, row: 4 },
  stutter: { col: 10, row: 4 },
  rime: { col: 16, row: 4 },
  flak: { col: 22, row: 4 },
  bloom: { col: 30, row: 4 },
  lance: { col: 38, row: 4 },
  forge: { col: 4, row: 12 },
  sink: { col: 10, row: 12 },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every tower apart from the floor at every heat", async () => {
  await startRun(h);

  const ids = new Map<TowerType, number>();
  for (const type of TOWER_TYPES) {
    const { col, row } = STANDS[type];
    ids.set(
      type,
      isEmitterType(type)
        ? await posePinnedTower(h, type, col, row, HEATS[0])
        : await poseTower(h, type, col, row),
    );
  }

  for (const heat of HEATS) {
    for (const type of EMITTER_TYPES) {
      await h.debug.setTowerHeat(ids.get(type) as number, heat);
    }
    await h.advance(1);
    if (heat === CAPTURE_AT) await captureStill(h, "towers");

    const snapshot = await h.snapshot();
    for (const type of TOWER_TYPES) {
      const tower = requireTower(
        snapshot,
        ids.get(type) as number,
        `the ${type} at heat ${heat}`,
      );
      const body = bodyPoints(tower);
      const probes = floorProbePoints(tower);
      const read = await readPixels(h, [...body, ...probes]);
      const colour = medoid(read.slice(0, body.length));
      const floor = nearest(colour, read.slice(body.length));

      assertGreaterThanOrEqual(
        colorDistance(colour, floor),
        APART_MIN,
        `the ${type} at heat ${heat}: its body (${showRgb(colour)}) against ` +
          `the nearest of the four patches of floor beside it ` +
          `(${showRgb(floor)}) (specs/overview.md: a tower reads apart from ` +
          `the floor behind it)`,
      );
    }
  }
});
