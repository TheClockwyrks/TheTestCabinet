// yard-drawing/held-footprint-legal-read — the held footprint is drawn, and its
// legality read is reported.
//
// `specs/hud.md` lists "the held rock's footprint, snapped to the grid, with its
// legal or illegal read" among the few things the yard draws over the map, and
// `specs/overview.md` requires a player to read at a glance that "a held rock's
// footprint shows a placement it may take distinctly from one it may not".
// `specs/controls.md` has moving over the yard "snap the held footprint to the
// tile under the pointer and update its legal read".
//
// THE TWO FOOTPRINTS. One over open ground, and one over a waypoint platform,
// which `specs/yard.md` puts out of bounds for every footprint: "all four are
// Waypoint tiles: the Load crosses them freely and no footprint may cover any of
// them". The game's own `held.legal` is read at each, so the two poses really are
// the legal one and the illegal one.
//
// HOW EACH IS READ. Against the SAME ground with no rock held, which isolates the
// paint the footprint itself put there: holding the rock over a tile has to draw
// on it, over the legal tile and over the platform alike. Whether the two paints
// look alike is not read here. `specs/yard.md` fixes which footprints are legal
// and nothing about how either state is drawn, so a hatch, an outline weight and
// an alpha change are all conforming reads, and the still beside this point is
// what the reviewer's presentation rating judges them on. What the game itself
// reports — `held.legal`, true over the tile and false over the platform — is
// asserted directly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  DRAWN,
  type Harness,
  lattice,
  maxDistance,
  openYard,
  pressAction,
  sample,
} from "../harness";
import { FOOTPRINT, mapById, structureCenter, TILE } from "../constants";

/** Open ground, clear of every platform on the Substation. */
const LEGAL = { col: 10, row: 10 };
/** The anchor of WP4's platform, which no footprint may cover (specs/yard.md). */
const ILLEGAL = mapById("substation").waypoints[3]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The footprint a rock anchored at that tile covers. */
function footprint(col: number, row: number) {
  return {
    x: col * TILE,
    y: 56 + row * TILE,
    w: FOOTPRINT * TILE,
    h: FOOTPRINT * TILE,
  };
}

it("draws the held footprint over a legal tile and over a platform", async () => {
  await openYard(h, { map: "substation" });

  const overLegal = lattice(footprint(LEGAL.col, LEGAL.row), 1);
  const overPlatform = lattice(footprint(ILLEGAL.col, ILLEGAL.row), 1);
  const bareLegal = await sample(h, overLegal);
  const barePlatform = await sample(h, overPlatform);

  await pressAction(h, "stamp");
  assertEqual(
    (await h.snapshot()).held.active,
    true,
    "whether pulling the press armed a rock to hold",
  );

  const legalPoint = structureCenter(LEGAL.col, LEGAL.row);
  await h.debug.pointerMove(legalPoint.x, legalPoint.y);
  const legalHeld = await h.snapshot();
  assertEqual(
    legalHeld.held.legal,
    true,
    `whether the footprint at (${LEGAL.col}, ${LEGAL.row}) reads as legal`,
  );
  const legalPixels = await sample(h, overLegal);
  await captureStill(h, "held");

  const platformPoint = structureCenter(ILLEGAL.col, ILLEGAL.row);
  await h.debug.pointerMove(platformPoint.x, platformPoint.y);
  const platformHeld = await h.snapshot();
  assertEqual(
    platformHeld.held.legal,
    false,
    `whether the footprint over WP4's platform at (${ILLEGAL.col}, ` +
      `${ILLEGAL.row}) reads as illegal (specs/yard.md)`,
  );
  const platformPixels = await sample(h, overPlatform);

  assertGreaterThan(
    maxDistance(bareLegal, legalPixels),
    DRAWN,
    `how far the held footprint moved the ground at (${LEGAL.col}, ` +
      `${LEGAL.row}), which is where specs/hud.md draws it`,
  );
  assertGreaterThan(
    maxDistance(barePlatform, platformPixels),
    DRAWN,
    "how far the held footprint moved the ground over WP4's platform, which " +
      "is where specs/hud.md draws it",
  );
});
