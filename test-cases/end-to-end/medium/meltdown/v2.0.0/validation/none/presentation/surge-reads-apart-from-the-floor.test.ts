// presentation/surge-reads-apart-from-the-floor — every surge type reads apart
// from the floor it stands on.
//
// THE RULE. `specs/overview.md`'s legibility table: "The surge — Ground units,
// flyers, and the boss read apart from one another, from the floor, and from every
// color a tower shows anywhere on its heat ramp." This item is the middle clause,
// asked of all six types `specs/surge.md` tabulates: Mote, Sprint, Hulk, Swarm,
// Drift and Core.
//
// WHERE A UNIT'S OWN PIXELS ARE. `specs/surge.md` fixes a unit's position as its
// CENTRE — "Wherever a tower or a surge unit is given, taken, or reported as an
// `(x, y)` pair, that pair is the centre of the entity" (`specs/overview.md`) —
// and fixes nothing at all about how large it is drawn or in what shape. So the
// patch read is three units either way from that centre, and the reading taken
// from it is the pixel FURTHEST from the floor rather than an average: a unit drawn
// as an outline reads as its outline, a Swarm drawn small reads as the few pixels
// it covers, and neither is diluted by the floor showing between them. The health
// bar `specs/hud.md` puts above a unit is outside that patch at any size a player
// could see.
//
// WHY THE FLOOR REFERENCE IS LOCAL AND WHY IT IS THE WORST OF FOUR. Nothing fixes
// what a floor looks like and `specs/floor.md` puts a grid line on every tile
// boundary, so the floor is read at four tile CENTRES two tiles off the unit, and
// the comparison is against whichever of the four is NEAREST the unit's own
// colour. A build whose Drift disappears over one patch of its floor fails there
// rather than passing on an average.
//
// WHY THE UNITS ARE PARKED AND WHY THAT IS NOT A BYSTANDER. `poseTarget` puts each
// unit on a named tile with its motion off (`specs/instrumentation.md`), because
// the check is about a unit's COLOUR and a walking unit would be somewhere else by
// the time the pixels were read. Nothing else stands on the floor: no tower, so
// nothing fires and nothing is drawn over them.
//
// WHAT IT DOES NOT DECIDE. Whether the three KINDS read apart from each other is
// `presentation/ground-flyer-boss-read-apart`, and whether they read off the heat
// ramp is `presentation/surge-off-the-heat-axis`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { SURGE_TYPES } from "../constants";
import type { SurgeType } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseTarget,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";
import {
  farthest,
  medoid,
  nearest,
  readPixels,
  showRgb,
  unitFloorProbePoints,
  unitPoints,
} from "./read";

/**
 * How far a unit's pixels must sit from the floor under them, out of the 441 the
 * RGB cube spans.
 *
 * This group's figure for "plainly apart" (`specs/overview.md`), the same one
 * `presentation/towers-read-apart-from-the-floor` holds a tower to. 60 is about a
 * seventh of the scale — a different shade at a glance under any palette — and
 * well above the 25 a build's own floor art moves a patch by. A surge that is
 * harder to see than that is a surge a player loses on a busy floor, which is the
 * whole reason the table names it.
 */
const APART_MIN = 60;

/** Where each type stands: spread across a clear rank of the floor. */
const STANDS: Record<SurgeType, { col: number; row: number }> = {
  mote: { col: 6, row: 6 },
  sprint: { col: 13, row: 6 },
  hulk: { col: 20, row: 6 },
  swarm: { col: 27, row: 6 },
  drift: { col: 34, row: 6 },
  core: { col: 41, row: 6 },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every surge type apart from the floor it stands on", async () => {
  await startRun(h);
  const ids = new Map<SurgeType, number>();
  for (const type of SURGE_TYPES) {
    const { col, row } = STANDS[type];
    ids.set(type, await poseTarget(h, type, col, row));
  }
  await h.debug.setPhase("wave");
  await h.advance(1);
  await captureStill(h, "surge");

  const snapshot = await h.snapshot();
  for (const type of SURGE_TYPES) {
    const unit = requireUnit(snapshot, ids.get(type) as number, `the ${type}`);
    const body = unitPoints(unit);
    const probes = unitFloorProbePoints(unit);
    const read = await readPixels(h, [...body, ...probes]);
    const floors = read.slice(body.length);
    const colour = farthest(medoid(floors), read.slice(0, body.length));
    const floor = nearest(colour, floors);

    assertGreaterThanOrEqual(
      colorDistance(colour, floor),
      APART_MIN,
      `the ${type}: its own pixels (${showRgb(colour)}) against the nearest ` +
        `of the four patches of floor around it (${showRgb(floor)}) ` +
        `(specs/overview.md: the surge reads apart from the floor)`,
    );
  }
});
