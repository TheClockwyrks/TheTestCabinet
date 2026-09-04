// presentation/surge-off-the-heat-axis — the surge never reads as heat.
//
// THE RULE. `specs/overview.md`'s legibility table: the surge reads apart "from
// every color a tower shows anywhere on its heat ramp". This is the strongest of
// the three surge clauses and the one a build is most likely to break by accident:
// a ramp that runs through the greens or the violets on its way from cold to
// near-white will, at some heat nobody thought about, land on the colour the
// flyers are drawn in — and a player reading a busy floor at a glance then sees a
// unit where a tower is, or misses a Drift crossing a hot Lance.
//
// SO THE RAMP IS SWEPT RATHER THAN SAMPLED AT ITS ENDS. Every emitter
// `specs/towers.md` lists is read at eleven heats across the whole of
// `specs/heat.md`'s `0` to `TRIP_HEAT` range, and then read TRIPPED, which the
// item's own wording requires ("tripped included") and which `specs/heat.md` makes
// a state of its own rather than a point on the ramp. All six emitters, because
// nothing says the six share one ramp: a build is free to give each type its own
// colour, and then each type's whole range has to stay off the surge.
//
// WHAT IS COMPARED. Every one of the six surge types against every one of those
// readings — six by seventy-two comparisons, each named, so a failure says which
// type collided with which tower at which heat rather than "the surge".
//
// WHY THE WHOLE FLOOR IS POSED AT ONCE, AND WHY THAT IS STILL ISOLATED. The
// towers stand with their GUNS AND THEIR THERMAL MODEL BOTH OFF
// (`specs/instrumentation.md`): with the guns off nothing is fired at the units
// parked beside them, so no shot trace is drawn over anything and no unit loses
// hp; with the thermal model off each tower is drawn at exactly the heat this
// check posed rather than at one that decayed by air cooling on the way to the
// render (`specs/heat.md` makes air cooling proportional to heat, so the error
// would be largest exactly where the sweep matters most). Every tower is at least
// three tiles from the next, so no two share an edge-tile and `specs/heat.md`'s
// conduction has nothing to act across; every unit is parked with its motion off,
// four tiles clear of every footprint.
//
// WHAT IT DOES NOT DECIDE. Whether the ramp MOVES with the heat is
// `presentation/heat-glow-ramp`, whether a tripped tower reads apart from an
// online one is `presentation/tripped-reads-apart`, and whether the surge reads
// apart from the FLOOR is `presentation/surge-reads-apart-from-the-floor`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { EMITTER_TYPES, SURGE_TYPES, TRIP_HEAT, TRIP_TIME } from "../constants";
import type { SurgeType, TowerType } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseTarget,
  poseTower,
  requireTower,
  requireUnit,
  startRun,
  type Harness,
  type Rgb,
} from "../harness";
import {
  bodyPoints,
  farthest,
  medoid,
  readPixels,
  showRgb,
  unitFloorProbePoints,
  unitPoints,
} from "./read";

/**
 * How far a surge colour must sit from every colour the ramp shows, out of the
 * 441 the RGB cube spans.
 *
 * This group's figure for "plainly apart" (`specs/overview.md`), the same 50 every
 * other point in this group draws its line at, under this engine and under the
 * other two.
 */
const APART_MIN = 50;

/** The eleven heats the ramp is swept at, across `specs/heat.md`'s whole range. */
const HEATS: readonly number[] = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/** Which pass leaves the picture behind: the middle of the ramp. */
const CAPTURE_AT = 50;

/** Where each emitter stands, at least three tiles clear of the next. */
const TOWER_STANDS: Record<string, { col: number; row: number }> = {
  arc: { col: 4, row: 4 },
  stutter: { col: 10, row: 4 },
  rime: { col: 16, row: 4 },
  flak: { col: 22, row: 4 },
  bloom: { col: 30, row: 4 },
  lance: { col: 38, row: 4 },
};

/** Where each surge type is parked, clear of every footprint above it. */
const UNIT_STANDS: Record<SurgeType, { col: number; row: number }> = {
  mote: { col: 6, row: 10 },
  sprint: { col: 13, row: 10 },
  hulk: { col: 20, row: 10 },
  swarm: { col: 27, row: 10 },
  drift: { col: 34, row: 10 },
  core: { col: 41, row: 10 },
};

/** One reading off the ramp: what showed it, and what it was. */
interface RampReading {
  what: string;
  colour: Rgb;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps every surge colour off every colour the heat ramp shows", async () => {
  await startRun(h);

  const towers = new Map<TowerType, number>();
  for (const type of EMITTER_TYPES) {
    const { col, row } = TOWER_STANDS[type];
    const id = await poseTower(h, type, col, row);
    await h.debug.setTowerFiring(id, false);
    await h.debug.setTowerThermal(id, false);
    towers.set(type, id);
  }
  const units = new Map<SurgeType, number>();
  for (const type of SURGE_TYPES) {
    const { col, row } = UNIT_STANDS[type];
    units.set(type, await poseTarget(h, type, col, row));
  }
  await h.debug.setPhase("wave");
  await h.advance(1);

  // The surge first, off the frame nothing has been heated on yet.
  const posed = await h.snapshot();
  const surge: { type: SurgeType; colour: Rgb }[] = [];
  for (const type of SURGE_TYPES) {
    const unit = requireUnit(posed, units.get(type) as number, `the ${type}`);
    const body = unitPoints(unit);
    const probes = unitFloorProbePoints(unit);
    const read = await readPixels(h, [...body, ...probes]);
    surge.push({
      type,
      colour: farthest(
        medoid(read.slice(body.length)),
        read.slice(0, body.length),
      ),
    });
  }

  // Then every colour the ramp shows, and the one the trip shows.
  const ramp: RampReading[] = [];
  for (const heat of HEATS) {
    for (const type of EMITTER_TYPES) {
      await h.debug.setTowerHeat(towers.get(type) as number, heat);
    }
    await h.advance(1);
    if (heat === CAPTURE_AT) await captureStill(h, "apart");
    const snapshot = await h.snapshot();
    for (const type of EMITTER_TYPES) {
      const tower = requireTower(
        snapshot,
        towers.get(type) as number,
        `the ${type} at heat ${heat}`,
      );
      ramp.push({
        what: `a ${type} at heat ${heat}`,
        colour: medoid(await readPixels(h, bodyPoints(tower))),
      });
    }
  }
  for (const type of EMITTER_TYPES) {
    const id = towers.get(type) as number;
    await h.debug.setTowerTripped(id, true);
    await h.debug.setTowerTripTimer(id, TRIP_TIME);
    await h.debug.setTowerHeat(id, TRIP_HEAT);
  }
  await h.advance(1);
  const tripped = await h.snapshot();
  for (const type of EMITTER_TYPES) {
    const tower = requireTower(
      tripped,
      towers.get(type) as number,
      `the tripped ${type}`,
    );
    ramp.push({
      what: `a tripped ${type}`,
      colour: medoid(await readPixels(h, bodyPoints(tower))),
    });
  }

  for (const { type, colour } of surge) {
    for (const reading of ramp) {
      assertGreaterThanOrEqual(
        colorDistance(colour, reading.colour),
        APART_MIN,
        `the ${type} (${showRgb(colour)}) against ${reading.what} ` +
          `(${showRgb(reading.colour)}) (specs/overview.md: the surge reads ` +
          `apart from every colour a tower shows anywhere on its heat ramp)`,
      );
    }
  }
});
