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
// build was seeded with. A source that IS a seeded frame matches it exactly;
// a canvas the build painted, a sheet of its own, or a recoloured copy does
// not. A build free to lay light of its own around a node is not held to
// anything but this: SOMETHING blitted on the node's tile is one of the seeded
// frames.
//
// EVERY NODE ON THE POSED BOARD IS READ, and the board is posed to carry every
// charge — `assets/node/` draws one frame per charge, so a build that drew four
// of the five states from the folder and painted the fifth in code is named for
// the charge it painted.
//
// The nodes are the only things posed. `startPlaying` leaves no worm, foe or
// bolt, and the cursor rests in its band, which is nowhere near the tiles read.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX, TILE } from "../../src/constants";
import { assertEqual, assertLength, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnImages,
  nearestSeededFrame,
  resetTo,
  startPlaying,
  tileCenter,
  type Harness,
} from "../harness";

/**
 * How far a blitted source may sit from a seeded frame and still BE it: the
 * mean absolute difference over premultiplied RGBA channels, out of `255`.
 *
 * The requirement is identity, so this is not a likeness tolerance. It is room
 * for the one lossy step in reading a bitmap back out of a canvas — a partially
 * transparent pixel is premultiplied on the way in and un-premultiplied on the
 * way out, so it can shift by a unit. Two different frames of `assets/node/`
 * measure far more than this against each other.
 */
const MATCH_MAX = 1;

/** How far a blit's centre may sit from the tile it is drawn on: half a tile. */
const PLACED_MAX = TILE / 2;

/** A node at every charge, spread across the board so no two tiles touch. */
const FIELD: readonly { c: number; r: number; charge: number }[] = [
  { c: 4, r: 3, charge: 0 },
  { c: 11, r: 7, charge: 1 },
  { c: 18, r: 12, charge: 2 },
  { c: 25, r: 5, charge: 3 },
  { c: 32, r: 15, charge: 1 },
  { c: 8, r: 16, charge: 3 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("blits a frame of the seeded node art on every node's tile", async () => {
  resetTo(h);
  startPlaying(h);
  for (const node of FIELD) h.debug.setNode(node.c, node.r, node.charge);

  h.calls.length = 0;
  await h.advance(1);
  const blits = drawnImages(h);
  // The posed field, drawn from the seeded art.
  captureStill(h, "nodes");

  const snapshot = h.snapshot();
  assertLength(snapshot.nodes, FIELD.length, "the posed field is on the board");
  assertEqual(h.assetFailures.length, 0, "every seeded frame loaded");

  for (const node of FIELD) {
    const centre = tileCenter(node.c, node.r);
    const near = blits.filter(
      (blit) => Math.hypot(blit.x - centre.x, blit.y - centre.y) <= PLACED_MAX,
    );
    const matches = await Promise.all(
      near.map((blit) => nearestSeededFrame(blit.source)),
    );
    const drawn = matches.find(
      (match) => match.folder === "node" && match.distance <= MATCH_MAX,
    );
    if (drawn !== undefined) continue;
    fail(
      `the node at (${node.c}, ${node.r}) holding charge ${node.charge} — of ` +
        `${CHARGE_MAX} — to be drawn from a frame of assets/node/, blitted ` +
        `within ${PLACED_MAX} units of its tile centre (specs/assets.md: ` +
        `every node on the board is drawn from this folder, centered on its ` +
        `tile)`,
      near.length === 0
        ? "no bitmap was blitted on that tile"
        : matches
            .map(
              (match) =>
                `${match.folder}/${match.index} at ${match.distance.toFixed(2)}`,
            )
            .join(", "),
    );
  }
});
