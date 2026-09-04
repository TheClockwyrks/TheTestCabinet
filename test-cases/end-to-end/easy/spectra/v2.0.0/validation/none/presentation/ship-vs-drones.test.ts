// Spectra — presentation/ship-vs-drones: the ship reads apart from the drones.
//
// `specs/overview.md`'s legibility table: "The ship reads apart from the drones,
// and its current band is readable on the ship itself." The second half is
// `presentation/ship-reads-band`; this point is the first. It matters because the
// two are drawn from different seeded files for a reason — `specs/assets.md`
// seeds `fighter.png` for the hull and `shard.png` for the crystal — and a player
// who loses the ship among the drones cannot see what they are flying.
//
// THE DRONE IS OF THE SHIP'S OWN BAND, which is the hard case and the one the
// item names. Both cyan: `specs/overview.md` requires one palette for everything
// that carries a band, so a conforming ship and a conforming drone of one band
// share that band's colour, and what must still tell them apart is what each is
// DRAWN AS. A drone of the opposite band would separate on the band instead, and
// a build that drew the ship as a Shard would pass.
//
// SO THE READING IS THE PICTURE, HELD PLACE FOR PLACE. Both are read through a
// square of `SHIP_W` (`40`) — the larger of the hull's own footprint and the
// Shard's `SHARD_SIZE` (`28`), so each square holds all of what stands in it, on
// one lattice — and the two are compared place for place over everything either
// painted, held against the same squares of the same field with both moved off
// them (see `presentation/reading`). Place for place rather than as two mean
// colours, because a hull and a crystal of one band differ in the shape and the
// extent they are drawn at as much as in anything else, and that is exactly where
// a player tells them apart.
//
// THE SHIP IS THE ONE ENTITY NO POSE CAN REMOVE (`specs/instrumentation.md` has
// no operation for it), so its control is taken with the ship parked at
// `SHIP_X_MIN` (`40`), six hundred units down its own lane, where nothing it
// draws can reach the square it was read in. The Shard is a prop with every
// faculty off, and is put a clear two hundred units from the ship's lane so
// neither one's glow can reach the other's square.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { FORM_CENTER_X, SHIP_W, SHIP_X_MIN, SHIP_Y } from "../constants";
import {
  captureStill,
  createHarness,
  footprint,
  poseDrone,
  readRegion,
  requireDrone,
  startPosed,
  type Harness,
} from "../harness";
import { apartFromField, apartness } from "./reading";

/**
 * How far the ship must read from a drone of its own band, and from the field
 * behind it, as a Euclidean RGB distance out of the `441` an RGB cube is across,
 * averaged over everything either picture painted.
 *
 * The figure this item is written against: more than `40` of `441`, about a tenth
 * of the space, which is what this checklist calls the least a player reads at a
 * glance. The specification states the rule and leaves the palette to the build,
 * so this is the case's own figure for "reads apart".
 */
const APART_MIN = 40;

/** The square both are read through: the larger of the two footprints. */
const READ_SIZE = SHIP_W;

/**
 * Where the Shard stands: inside the play field, a clear two hundred units up
 * and to the left of the ship's lane, so the two squares never touch and no glow
 * a build lays around one reaches the other.
 */
const SHARD_AT = { x: 440, y: 480 } as const;

/**
 * The lattice each square is read on, in logical units.
 *
 * One sample per logical unit, which is one device pixel at this harness's own
 * viewport, so each `40 x 40` square is every one of its `1600` pixels.
 */
const READ_STEP = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws the ship apart from a drone of its own band and from the field", async () => {
  // The ship on cyan at the centre of its lane, which is what `startPosed`
  // leaves, and one Shard of that same band beside it.
  await startPosed(h);
  const shardId = await poseDrone(h, "shard", SHARD_AT.x, SHARD_AT.y, {
    band: "cyan",
  });
  await h.advance(1);

  // The ship beside a drone of its own band.
  await captureStill(h, "ship");

  const posed = await h.snapshot();
  assertEqual(
    posed.ship.band,
    "cyan",
    "precondition: the ship is tuned to cyan",
  );
  assertEqual(
    posed.ship.x,
    FORM_CENTER_X,
    `precondition: the ship stands at the centre of its lane ` +
      `(${FORM_CENTER_X}), where its square is read`,
  );
  const drone = requireDrone(posed, shardId, "the Shard beside the ship");
  assertEqual(
    drone.effectiveBand,
    "cyan",
    "precondition: the Shard reads as cyan, the ship's own band " +
      "(specs/bands.md; no inversion is running)",
  );

  const hull = footprint(posed.ship.x, SHIP_Y, READ_SIZE);
  const crystal = footprint(drone.x, drone.y, READ_SIZE);
  const drawnShip = await readRegion(h, hull, READ_STEP);
  const drawnDrone = await readRegion(h, crystal, READ_STEP);

  // The same two squares of the same field with the Shard gone and the ship
  // parked at the far end of its lane: the control both readings are held
  // against.
  await h.debug.clearDrones();
  await h.debug.setShipX(SHIP_X_MIN);
  await h.advance(1);
  const bareShip = await readRegion(h, hull, READ_STEP);
  const bareDrone = await readRegion(h, crystal, READ_STEP);

  const fromField = apartFromField(bareShip, drawnShip);
  assertGreaterThan(
    fromField.distance,
    APART_MIN,
    `the ship to read more than ${APART_MIN} of 441 from the field behind it, ` +
      `averaged over the ${fromField.samples} places it painted inside the ` +
      `${READ_SIZE}-unit square it stands in (specs/overview.md: the ship ` +
      `reads apart from the drones, and everything on the field is told apart ` +
      `from the field behind it)`,
  );

  const fromDrone = apartness(bareShip, drawnShip, bareDrone, drawnDrone);
  assertGreaterThan(
    fromDrone.distance,
    APART_MIN,
    `the ship to read more than ${APART_MIN} of 441 from a Shard of its own ` +
      `band, averaged over the ${fromDrone.samples} places either of them ` +
      `painted inside their ${READ_SIZE}-unit squares (specs/overview.md: the ` +
      `ship reads apart from the drones)`,
  );
});
