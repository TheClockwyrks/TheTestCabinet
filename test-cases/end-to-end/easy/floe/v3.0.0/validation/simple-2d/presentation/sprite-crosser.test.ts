// presentation/sprite-crosser — the critter is drawn from the art this case
// seeds, and not from art of the build's own.
//
// specs/assets.md seeds `assets/crosser/` — eight 32 x 32 frames spanning one
// tile — and says "the build renders each of those from its folder". A build
// that draws a convincing little shape in code satisfies every other point in
// this project and misses this one, which is the whole reason the point exists.
//
// SO THE READING IS THE IMAGE SOURCE, NOT THE PIXELS ON THE STAGE. Every
// `drawImage` the frame issued is taken with the bitmap it was handed, and that
// bitmap is held against the seeded PNGs read off the workspace's own `assets/`
// tree. A source that IS a seeded frame matches it; a canvas the build painted,
// a sheet of its own, or a recoloured copy does not. A build is free to tint or
// scale what it blits, so a stage sample would grade the tint rather than the
// art.
//
// THE DRAW IS NAMED BY WHERE IT LANDED. Only draws centred on the critter's own
// reported centre count, so what this point says is "the critter was drawn from
// the critter's folder" rather than "some seeded frame was drawn somewhere".
// specs/assets.md draws a 32 x 32 frame "centered on its subject's own center",
// and it also allows a lives icon in the HUD to reuse one of these frames —
// that icon is eight rows away and is not what is read here.
//
// The world is the empty crossing `startCrossing` poses: no bear, no vehicle,
// no floe, no bonus catch. The critter is the one body no scenario can remove,
// and it is the only thing this point concerns.

import { afterEach, beforeEach, it } from "vitest";
import { TILE } from "../../src/constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";
import { drawnFrom, spritesOfFrame } from "./sprites";

/**
 * How far a draw's centre may sit from the critter's own centre, in stage
 * units.
 *
 * specs/assets.md: a 32 x 32 frame is "drawn over one tile, centered on its
 * subject's own center". Half a tile is the widest this can be and still name
 * one tile: a draw further off is centred on a neighbouring tile and is some
 * other body's. The critter is posed at rest on a tile centre here, so a build
 * that draws where the specification says measures zero.
 */
const CENTRED_WITHIN = TILE / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the critter from a frame of assets/crosser/", async () => {
  startCrossing(h);

  const sprites = await spritesOfFrame(h);
  const scene = h.snapshot();
  // Before the assertion, so a failing check still leaves the picture of the
  // frame whose draws were read.
  captureStill(h, "scene");

  assertGreaterThanOrEqual(
    drawnFrom(sprites, "crosser", scene.critter, CENTRED_WITHIN).length,
    1,
    `the critter, at (${scene.critter.x}, ${scene.critter.y}), drawn from a ` +
      `32 x 32 frame of assets/crosser/ (specs/assets.md) — matched pixel for ` +
      `pixel against the seeded PNGs`,
  );
});
