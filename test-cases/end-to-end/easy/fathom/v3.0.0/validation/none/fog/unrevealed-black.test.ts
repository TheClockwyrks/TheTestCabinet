// fog/unrevealed-black — a tile nothing has touched is flat darkness, and the
// darkness does not leak the layout.
//
// `specs/sensing.md` gives the unrevealed state as "never touched by the forager's
// light, a sonar pulse or a flare", reported `u`, and "drawn as the flat
// unrevealed fog `specs/overview.md` fixes, which reads the same over rock as over
// open water". `specs/overview.md` fixes how dark that is: "near-black and no
// brighter than a tenth of full brightness, hiding whether it is rock or open
// water".
//
// So there are two halves, and a build can pass one while failing the other: the
// fog is dark, AND rock and corridor under it are drawn ALIKE. A build that paints
// unrevealed rock a shade darker than unrevealed water has drawn the maze into the
// dark, which is the one thing this state exists to prevent.
//
// THE PAIR IS READ FROM THE SAME PLACE, FAR FROM THE FORAGER. The fixture is a
// sealed pocket fifteen tiles from the forager's own room, with a rock tile beside
// its corridor tile. Fifteen tiles is `480` logical units: past the light pocket at
// its widest (`V` is at most `160`) and past the kindle variant's vision circle at
// its widest (`R` is at most `320`), so neither variant is drawing anything there
// but fog, and the two samples are close enough together that no gradient across
// the stage can separate them.
//
// AND NOTHING ELSE CAN REVEAL THEM. `setMaze` returns every predator to the den
// and suspends the release schedule, and the fixture's den is sealed on three
// sides, so no Flarefish bloom reaches the pocket. Nothing casts a pulse. Both
// halves of the reading are taken from `visibility` as well as from the canvas, so
// a build that reports a state it does not draw, or draws a state it does not
// report, fails rather than passing on the half it got right.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { poseMaze } from "../fixtures";
import {
  captureStill,
  colorDistance,
  createHarness,
  luminance,
  rgbOf,
  type Harness,
  startPlaying,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";
import { tileCenter, type Tile, visibilityAt } from "../maze";

/**
 * The board: the forager's own three-tile room, twelve tiles of solid rock, and a
 * sealed three-tile pocket it can never reach or light.
 *
 * The two samples come off the right-hand end of that gap — the pocket's first
 * corridor tile, and the rock immediately left of it — so they sit one tile apart
 * and fifteen and fourteen tiles from the forager respectively.
 */
const ART = ["N.." + " ".repeat(12) + "C.."] as const;

/** How far the rock sample sits left of the pocket, in tiles. */
const ROCK_OFFSET = 1;

/**
 * The most brightness an unrevealed tile may be drawn at, per channel-mean.
 *
 * `specs/overview.md`: "no brighter than a tenth of full brightness". A tenth of
 * an eight-bit channel's full `255` is `25.5`, and the brightness of a drawn pixel
 * is read as the mean of its three channels, so a build is free to tint its fog
 * however it likes as long as the tint is that dark.
 */
const FOG_MAX_BRIGHTNESS = 25.5;

/**
 * How far apart the two samples may be drawn, as an RGB distance.
 *
 * The item's bound: `25` of the `441` (`sqrt(3) * 255`) that separates black from
 * white. Wide enough for dithering, a subtle noise texture, or a hair of gradient
 * across a tile; far too narrow to tell rock from water at a glance, which is what
 * "reads the same over rock as over open water" asks.
 */
const ALIKE_MAX_DISTANCE = 25;

/** Ticks run before the samples, so the build has drawn the posed board. */
const SETTLE_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws an unrevealed rock tile and an unrevealed corridor tile alike, and dark", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const guard = await sceneGuard(h);

  const corridor: Tile = board.mark("C");
  const rock: Tile = { tx: corridor.tx - ROCK_OFFSET, ty: corridor.ty };

  await h.advance(SETTLE_TICKS);
  const snap = await h.snapshot();
  const centers = [
    tileCenter(snap.grid, rock),
    tileCenter(snap.grid, corridor),
  ];
  const [rockColor, corridorColor] = (await h.pixels(centers)).map(rgbOf);
  // Before the assertions, so a failing check still leaves the picture that shows
  // why the reviewer is being told the fog leaks.
  await captureStill(h, "fog");

  requireSceneHeld(snap, guard);

  // What the build SAYS about the two tiles.
  assertEqual(
    visibilityAt(snap, rock),
    "u",
    `the rock tile at (${rock.tx}, ${rock.ty}), which nothing has touched`,
  );
  assertEqual(
    visibilityAt(snap, corridor),
    "u",
    `the corridor tile at (${corridor.tx}, ${corridor.ty}), which nothing has touched`,
  );

  // And what it DRAWS there.
  assertLessThanOrEqual(
    luminance(rockColor),
    FOG_MAX_BRIGHTNESS,
    `the mean channel at the unrevealed rock tile's center, of 255`,
  );
  assertLessThanOrEqual(
    luminance(corridorColor),
    FOG_MAX_BRIGHTNESS,
    `the mean channel at the unrevealed corridor tile's center, of 255`,
  );
  assertLessThanOrEqual(
    colorDistance(rockColor, corridorColor),
    ALIKE_MAX_DISTANCE,
    `the RGB distance between the unrevealed rock tile and the unrevealed ` +
      `corridor tile beside it, of 441`,
  );
});
