// Spectra — presentation/ship-reads-band: the ship reads its band.
//
// `specs/ship.md`: the ship's current band is readable on the ship itself, and it
// always agrees with the polarity indicator `specs/ui.md` states.
// `specs/overview.md`'s legibility table says the same: the ship reads apart from
// the drones, "and its current band is readable on the ship itself". It is the
// fact a player checks before every shot — `specs/bands.md` gives a bullet the
// ship's band at the instant it is fired — and a build that reports the band only
// in the HUD strip makes the player look away from the field to fire.
//
// SO THE READING IS ON THE HULL, NOT IN THE STRIP. The box read is the ship's own
// `SHIP_W` (`40`) by `SHIP_H` (`28`) footprint, centred on the ship, which
// `specs/field.md` puts in the play field and clear of the bottom HUD strip the
// polarity indicator lives in. A build whose only band cue is that indicator
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
// everything either painted, held against the same box of the same field with the
// ship moved off it — see `presentation/reading`. The ship is the one entity no
// pose can remove (`specs/instrumentation.md` has no operation for it), so the
// control is taken with the ship parked at `SHIP_X_MIN` (`40`), six hundred units
// down its own lane, where nothing it draws can reach the box.
//
// THE BAND IS POSED RATHER THAN FLIPPED BY A KEY. `setShipBand` "starts no fire
// lockout" (`specs/instrumentation.md`), so the two frames differ in the band and
// in nothing else; driving the real flip control would put a lockout on the
// second reading and is `controls`' subject, not this one's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { SHIP_H, SHIP_W, SHIP_X_MIN, SHIP_Y } from "../../src/constants";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";
import { apartness, boxOf, readRegion } from "./reading";

/**
 * How far apart the two bands must read on the hull, as a Euclidean RGB distance
 * out of the `441` an RGB cube is across, averaged over everything either picture
 * painted.
 *
 * The figure this item is written against: at least `40` of `441`, which is about
 * a tenth of the space and what this checklist calls the least a player reads at
 * a glance. Lower than the `60` `presentation/cyan-magenta-distinct` holds two
 * drones to, because `specs/assets.md` recolours only part of the hull — "the
 * magenta ship is the same hull with its core recolored magenta and the accent
 * swapped" — so the band is a mark ON the ship rather than the whole of it, and
 * demanding as much of it as of a drone drawn entirely in its band would be
 * demanding a hull the specification does not ask for.
 */
const READS_MIN = 40;

/** The box the hull is read through: the footprint `specs/ship.md` fixes. */
const HULL = boxOf(LANE_CENTER, SHIP_Y, SHIP_W, SHIP_H);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the ship on cyan apart from the ship on magenta", async () => {
  // The ship alone at the centre of its lane, on cyan, with no drone, bullet or
  // burst on the field: what `startPosed` leaves.
  startPosed(h);
  await h.advance(1);
  const onCyanState = h.snapshot();
  assertEqual(
    onCyanState.ship.x,
    LANE_CENTER,
    `precondition: the ship stands at the centre of its lane ` +
      `(${LANE_CENTER}), where the hull box is read`,
  );
  assertEqual(
    onCyanState.ship.band,
    "cyan",
    "precondition: the ship is tuned to cyan for the first reading",
  );

  // The ship on cyan.
  captureStill(h, "cyan");
  const onCyan = readRegion(h, HULL);

  h.debug.setShipBand("magenta");
  await h.advance(1);
  // The ship on magenta.
  captureStill(h, "magenta");
  const onMagenta = readRegion(h, HULL);
  const flipped = h.snapshot();
  assertEqual(
    flipped.ship.band,
    "magenta",
    "precondition: the ship is tuned to magenta for the second reading",
  );
  assertEqual(
    flipped.ship.x,
    LANE_CENTER,
    "precondition: the ship has not moved between the two readings",
  );

  // The same box of the same field with the ship parked at the far end of its
  // lane: the control both readings are held against.
  h.debug.setShipX(SHIP_X_MIN);
  await h.advance(1);
  const bare = readRegion(h, HULL);

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
