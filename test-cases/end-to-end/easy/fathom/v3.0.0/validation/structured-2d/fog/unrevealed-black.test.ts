// fog/unrevealed-black — unrevealed maze is flat dark fog.
//
// The claim: a tile nothing has touched reports visibility `u` and is drawn as
// flat darkness, sampled at the tile's center, no brighter than a tenth of full
// brightness; and a rock tile and a corridor tile that are both unrevealed are
// drawn alike, so the fog does not leak the layout.
//
// specs/sensing.md draws an unrevealed tile as the flat unrevealed fog, "which
// reads the same over rock as over open water", and lists the only three things
// that reveal one: the forager's own light, a sonar pulse's front, and a flare's
// bloom. So the scenario has to put a pair of tiles out of reach of all three and
// then read the pixels the build actually painted.
//
// THE PAIR IS POSED, AND SEALED OFF. The two tiles sit fourteen tiles from the
// forager, across a solid band of rock, on a board of the suite's own. The light's
// radius is `V = VISION_MIN + VISION_GAIN * G` and `G` is at most `1`, so the pair
// is past its reach at ANY brightness — which the scenario asserts of the fixture
// rather than of the build. The two tiles are neighbors, so a build that leaked
// the layout would differ between them in exactly the place this reads.
//
// THE BOARD CARRIES NO CREATURE AT ALL. A Flarefish's bloom reveals the full disc
// of `FLARE_RADIUS` around it, straight through rock (specs/sensing.md), and this
// point is not about where a hunter happens to be. A posed fixture leaves the
// roster empty and the maze free of drifters (`fixtures.ts`), so the fog that is
// read is the fog the forager's own light left.
//
// THE PELLET UNDER THE FORAGER IS TAKEN OFF THE BOARD rather than eaten, through
// `setPlankton`, which specs/instrumentation.md is explicit scores nothing and
// clears no maze. A plankton eaten on the tick that is drawn would raise `G` and
// widen the light under the reading, and which tick a build eats an underfoot
// pellet on is not something this point has any business turning on.

import { afterEach, beforeEach, it } from "vitest";
import { VISION_GAIN, VISION_MIN } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { placeForager, poseMaze } from "../fixtures";
import {
  captureStill,
  centerOf,
  colorAtTile,
  colorDistance,
  createHarness,
  luminance,
  startPlaying,
  visibilityAt,
  type Harness,
} from "../harness";
import { parkForager } from "../scene";
import type { Tile } from "../maze";

/**
 * The brightest an unrevealed tile may read, as a mean channel out of `255`.
 *
 * A tenth of full brightness, which is the bound the review item states. Every
 * palette is the build's (specs/overview.md fixes only that the trench is dark and
 * the unrevealed ground flat), so this is a ceiling on brightness rather than a
 * color match.
 */
const DARK_MAX = 25.5;

/**
 * How far apart the rock reading and the corridor reading may sit, as an RGB
 * distance out of `441`.
 *
 * The two tiles are neighbors under the same fog, so "drawn alike" is a small
 * distance rather than an exact match: a build is free to dither or vignette its
 * fog, and neither of those tells one kind of ground from the other.
 */
const ALIKE_MAX = 25;

/** The widest the light pocket ever opens, in logical units: `V` at `G = 1`. */
const VISION_MAX = VISION_MIN + VISION_GAIN;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Unrevealed maze is flat dark fog", async () => {
  startPlaying(h);

  // A four-tile corridor for the forager, ten tiles of solid rock, then a sealed
  // three-tile pocket. `U` is the unrevealed corridor tile that is read, and the
  // rock one step back from it is the unrevealed rock tile read beside it.
  const board = await poseMaze(h, ["F..." + " ".repeat(10) + "U.."]);
  const corridor = board.mark("U");
  const rock: Tile = { tx: corridor.tx - 1, ty: corridor.ty };
  const home = board.mark("F");
  await placeForager(h, home);
  await parkForager(h, home);
  h.debug.setBrightness(0);

  // One tick, so there is a frame on the canvas to read.
  await h.advance(1);
  captureStill(h, "fog");

  const snapshot = h.snapshot();
  // The fixture's own geometry, not the build's: the pair stands further off than
  // the light reaches at its very widest, so nothing the forager carries can have
  // revealed it.
  const reach = Math.hypot(
    centerOf(snapshot, corridor).x - snapshot.forager.x,
    centerOf(snapshot, corridor).y - snapshot.forager.y,
  );
  assertGreaterThan(
    reach,
    VISION_MAX,
    "the logical units between the forager and the tile pair, which must " +
      `exceed V at G = 1 (VISION_MIN + VISION_GAIN = ${VISION_MAX})`,
  );

  assertEqual(
    visibilityAt(snapshot, corridor),
    "u",
    `the corridor tile at (${corridor.tx}, ${corridor.ty}), which no light, ` +
      "pulse or flare has touched",
  );
  assertEqual(
    visibilityAt(snapshot, rock),
    "u",
    `the rock tile at (${rock.tx}, ${rock.ty}), which no light, pulse or ` +
      "flare has touched",
  );

  const corridorFog = colorAtTile(h, snapshot, corridor);
  const rockFog = colorAtTile(h, snapshot, rock);
  assertLessThanOrEqual(
    luminance(corridorFog),
    DARK_MAX,
    "the mean channel of the unrevealed corridor tile, out of 255",
  );
  assertLessThanOrEqual(
    luminance(rockFog),
    DARK_MAX,
    "the mean channel of the unrevealed rock tile, out of 255",
  );
  assertLessThanOrEqual(
    colorDistance(corridorFog, rockFog),
    ALIKE_MAX,
    "the RGB distance, out of 441, between the unrevealed rock tile and the " +
      "unrevealed corridor tile beside it: unrevealed fog reads the same over " +
      "rock as over open water (specs/sensing.md)",
  );
});
