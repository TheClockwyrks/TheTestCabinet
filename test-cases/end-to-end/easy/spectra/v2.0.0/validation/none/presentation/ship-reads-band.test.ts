// Spectra — presentation/ship-reads-band: the ship reads its band.
//
// `specs/ship.md`: "The ship's current band is readable on the ship itself, and
// it always agrees with the polarity indicator `specs/ui.md` states."
// `specs/overview.md`'s legibility table says the same: the ship reads apart from
// the drones, "and its current band is readable on the ship itself". It is the
// fact a player checks before every shot — `specs/bands.md` gives a bullet the
// ship's band at the instant it is fired — and a build that reports the band only
// in the HUD strip makes the player look away from the field to fire.
//
// SO THE READING IS ON THE HULL, NOT IN THE STRIP. The square read is the ship's
// own `SHIP_W` (`40`) by `SHIP_H` (`28`) footprint, centred on the ship, which
// `specs/field.md` puts in the play field and well clear of the bottom HUD strip
// the polarity indicator lives in. A build whose only band cue is that indicator
// reads the same on both bands here, which is exactly the failure this point is
// for; the indicator itself is `screens/hud-polarity-indicator`.
//
// THE SHIP IS FLIPPED IN PLACE. One ship, one position, the band the only thing
// that changes between the two readings — so nothing but the band can be what
// moved. Two stills are kept, one per band, because a single picture cannot show
// a ship on both.
//
// NO COLOUR IS ASSERTED. `specs/overview.md` fixes no palette, so what is graded
// is the DISTANCE between the two pictures the build drew, place for place over
// everything either painted, held against the same square of the same field with
// the ship moved off it — see `presentation/reading`. The ship is the one entity
// no pose can remove (`specs/instrumentation.md` has no operation for it), so the
// control is taken with the ship parked at `SHIP_X_MIN` (`40`), six hundred units
// down its own lane, where nothing it draws can reach the square.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  FORM_CENTER_X,
  SHIP_H,
  SHIP_W,
  SHIP_X_MIN,
  SHIP_Y,
} from "../constants";
import {
  captureStill,
  createHarness,
  readRegion,
  startPosed,
  type Harness,
  type Rect,
} from "../harness";
import { apartness } from "./reading";

/**
 * How far apart the two bands must read on the hull, as a Euclidean RGB distance
 * out of the `441` an RGB cube is across, averaged over everything either
 * picture painted.
 *
 * The figure this item is written against: at least `40` of `441`, which is
 * about a tenth of the space and what this checklist calls the least a player
 * reads at a glance. Lower than the `60` `presentation/cyan-magenta-distinct`
 * holds two drones to, because `specs/assets.md` recolours only part of the hull
 * — "the magenta ship is the same hull with its core recolored magenta and the
 * accent swapped" — so the band is a mark ON the ship rather than the whole of
 * it, and demanding as much of it as of a drone drawn entirely in its band would
 * be demanding a hull the specification does not ask for.
 */
const READS_MIN = 40;

/** The square the hull is read through: the footprint `specs/ship.md` fixes. */
const HULL: Rect = {
  x: FORM_CENTER_X - SHIP_W / 2,
  y: SHIP_Y - SHIP_H / 2,
  width: SHIP_W,
  height: SHIP_H,
};

/**
 * The lattice the square is read on, in logical units.
 *
 * One sample per logical unit, which is one device pixel at this harness's own
 * viewport, so the hull's `40 x 28` box is every one of its `1120` pixels and a
 * band drawn as a thin accent alone is still read.
 */
const READ_STEP = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws the ship on cyan apart from the ship on magenta", async () => {
  // The ship alone at the centre of its lane, on cyan, with no drone, bullet or
  // burst on the field: what `startPosed` leaves.
  await startPosed(h);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).ship.x,
    FORM_CENTER_X,
    `precondition: the ship stands at the centre of its lane ` +
      `(${FORM_CENTER_X}), where the hull square is read`,
  );

  // The ship on cyan.
  await captureStill(h, "cyan");
  const onCyan = await readRegion(h, HULL, READ_STEP);
  assertEqual(
    (await h.snapshot()).ship.band,
    "cyan",
    "precondition: the ship is tuned to cyan for the first reading",
  );

  await h.debug.setShipBand("magenta");
  await h.advance(1);
  // The ship on magenta.
  await captureStill(h, "magenta");
  const onMagenta = await readRegion(h, HULL, READ_STEP);
  const flipped = await h.snapshot();
  assertEqual(
    flipped.ship.band,
    "magenta",
    "precondition: the ship is tuned to magenta for the second reading",
  );
  assertEqual(
    flipped.ship.x,
    FORM_CENTER_X,
    "precondition: the ship has not moved between the two readings",
  );

  // The same square of the same field with the ship parked at the far end of
  // its lane: the control both readings are held against.
  await h.debug.setShipX(SHIP_X_MIN);
  await h.advance(1);
  const bare = await readRegion(h, HULL, READ_STEP);

  const apart = apartness(bare, onCyan, bare, onMagenta);
  assertGreaterThanOrEqual(
    apart.distance,
    READS_MIN,
    `the ship drawn on cyan to read at least ${READS_MIN} of 441 from the ` +
      `ship drawn on magenta, averaged over the ${apart.samples} places ` +
      `either picture painted inside the SHIP_W (${SHIP_W}) by SHIP_H ` +
      `(${SHIP_H}) hull (specs/ship.md: the ship's current band is readable ` +
      `on the ship itself)`,
  );
});
