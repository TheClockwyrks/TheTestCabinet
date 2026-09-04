// Wireworm — presentation/node-from-sprite: every node is drawn from the seeded
// node art.
//
// specs/assets.md seeds `assets/node/` with `NODE_FRAMES` (`5`) frames and
// states that the build draws the node from that folder rather than from art of
// its own: "Every node on the board is drawn from this folder, centered on its
// tile." specs/overview.md makes it a hard requirement of the finished build. A
// build that paints convincing shapes in code passes every other point in this
// suite and misses this one, which is why the point exists.
//
// SO THE READING IS THE IMAGE SOURCE ITSELF, NOT THE PIXELS ON THE STAGE. Every
// bitmap the frame blitted is captured with the source it was handed, and that
// source is held against the seeded PNGs read off the same `assets/` tree the
// build was seeded with. A source that IS a seeded frame matches it exactly; a
// canvas the build painted, a sheet of its own, or a recoloured copy does not. A
// build free to lay light of its own around a node is not held to anything but
// this: SOMETHING blitted on the node's tile is one of the seeded frames.
//
// EVERY NODE ON THE POSED BOARD IS READ, and the board is posed to carry every
// charge — `assets/node/` draws one frame per charge, so a build that drew four
// of the five states from the folder and painted the fifth in code is named for
// the charge it painted.
//
// The nodes are the only things posed. `startPlaying` leaves no worm, foe or
// bolt, and the cursor rests in its band, which is nowhere near the tiles read.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, fail } from "../assert";
import { CHARGE_MAX, TILE, tileCX, tileCY } from "../constants";
import {
  blitsOfFrame,
  captureStill,
  createHarness,
  drawnFrom,
  poseNodes,
  startPlaying,
  type Harness,
} from "../harness";
import { blitsNear, describeBlits } from "./reading";

/**
 * How far a blit's centre may sit from the tile it is drawn on, in logical
 * units.
 *
 * Half a tile. specs/board.md draws a node "centered on" its tile's centre, and
 * how a build inks the frame inside that tile is its own; a blit whose centre
 * left the tile altogether is drawn on a different tile.
 */
const PLACED_MAX = TILE / 2;

/** A node at every charge, spread across the board so no two tiles touch. */
const FIELD: readonly (readonly [number, number, number])[] = [
  [4, 3, 0],
  [11, 7, 1],
  [18, 12, 2],
  [25, 5, 3],
  [32, 15, 1],
  [8, 16, 3],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("blits a frame of the seeded node art on every node's tile", async () => {
  await startPlaying(h);
  await poseNodes(h, FIELD);

  const blits = await blitsOfFrame(h);
  // The posed field, drawn from the seeded art.
  await captureStill(h, "nodes");

  const snapshot = await h.snapshot();
  assertLength(snapshot.nodes, FIELD.length, "the posed field is on the board");

  for (const [c, r, charge] of FIELD) {
    const at = { x: tileCX(c), y: tileCY(r) };
    if (drawnFrom(blits, "node", at, PLACED_MAX).length > 0) continue;
    fail(
      `the node at (${c}, ${r}) holding charge ${charge} — of ${CHARGE_MAX} — ` +
        `to be drawn from a frame of assets/node/, blitted within ` +
        `${PLACED_MAX} units of its tile centre (specs/assets.md: every node ` +
        `on the board is drawn from this folder, centered on its tile)`,
      describeBlits(blitsNear(blits, at, PLACED_MAX)),
    );
  }
});
