// fuel — posing the miner in the open sky above the camp.
//
// Not a suite: a pose several of them share. `specs/character.md` charges life
// support "while below the surface ground line" and nothing above it, and it
// leaves the sky over the camp unbounded, with fuel spent and hull damage taken
// up there exactly as below. So a check that wants ONE drain on the meter poses
// the miner in that sky: the thrust burn, or the air burn, arrives alone rather
// than mixed with a life-support trickle the sibling check owns.

import { SURFACE_Y, TILE } from "../constants";
import { minerXOn, placeAt, type Harness } from "../harness";

/**
 * The box `y` the poses below use: fifteen tiles above the ground line.
 *
 * Well clear of `SURFACE_Y`, so no reading here turns on where exactly a build
 * draws the line between above it and below it.
 */
export const SKY_Y = SURFACE_Y - 15 * TILE;

/** Put the miner in the open sky over `col`, at rest. */
export function standInSky(h: Harness, col: number): Promise<void> {
  return placeAt(h, minerXOn(col), SKY_Y);
}
