// yard-drawing/held-footprint-legal-read — a legal footprint reads unlike an illegal one.
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
// HOW THE TWO ARE COMPARED. Not against each other: they sit over different
// ground, so their pixels would differ whatever the footprint drew. Each is
// compared against the SAME ground with no rock held, which isolates the paint
// the footprint itself put there, and it is those two paints that have to be told
// apart. What is compared is the colour at the point each paint moved furthest,
// which is the footprint's own read rather than the yard beneath it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  pressAction,
  type Harness,
} from "../harness";
import { FOOTPRINT, TILE, mapById, structureCenter } from "../constants";
import { DISTINCT, lattice, rgbDistance, sample } from "./reading";

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

type Pixel = [number, number, number, number];

/** The colour the held footprint moved furthest from the bare ground. */
function strongest(bare: readonly Pixel[], held: readonly Pixel[]): Pixel {
  let at = -1;
  let worst = 0;
  for (let i = 0; i < bare.length; i += 1) {
    const moved = rgbDistance(bare[i]!, held[i]!);
    if (moved > worst) {
      worst = moved;
      at = i;
    }
  }
  if (at < 0 || worst <= DISTINCT) {
    assertGreaterThan(
      worst,
      DISTINCT,
      "how far the held footprint moved the ground it was drawn over, in RGB " +
        "distance",
    );
  }
  return held[at]!;
}

it("draws a legal footprint differently from one over a platform", async () => {
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
    rgbDistance(
      strongest(bareLegal, legalPixels),
      strongest(barePlatform, platformPixels),
    ),
    DISTINCT,
    "how far apart the legal footprint's read and the illegal one's are, in " +
      "RGB distance",
  );
});
