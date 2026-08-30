// presentation/node-from-sprite — nodes are drawn from the seeded node art.
//
// specs/assets.md seeds `assets/node/` and states outright that "Every node on
// the board is drawn from this folder, centered on its tile", one frame per
// charge state plus the alternate critical frame. A build that draws four
// convincing shapes in code satisfies every colour point in this group and
// misses this one, which is the whole reason the point exists.
//
// SO THE READING IS THE IMAGE SOURCE ITSELF, NOT THE PIXELS ON THE STAGE. Every
// `drawImage` of one frame is captured with the bitmap it was handed, and that
// bitmap's own pixels are held against the seeded PNGs read off the workspace's
// own `assets/` tree — the same tree the build was seeded with. A source that IS
// a seeded frame matches it; anything else — a canvas the build painted, art of
// its own, a recoloured copy — does not.
//
// EACH DRAW IS NAMED BY THE NODE IT WAS DRAWN FOR, by the tile its destination
// box is centred on, so the point says "the node on (12, 8) was drawn from
// `assets/node/`" rather than "some frame was drawn somewhere". A build may
// layer whatever else it likes over a node — a glow, a halo, a ring — so what is
// required of a node's tile is that a frame of the folder is among what was
// drawn there, not that it was the only thing.
//
// EVERY CHARGE STATE IS POSED, because specs/assets.md gives each one its own
// frame: a build that reached for the art only once it had something bright to
// draw is named for the states it drew itself. They are spread four tiles apart
// on one row well clear of the player band, so each tile's draws are its own.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX, TILE, tileCX, tileCY } from "../../src/constants";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnImages,
  startPlaying,
  type Harness,
} from "../harness";
import { framesDrawnAt, frameName, spriteReader } from "./reading";

/**
 * How far a draw's destination centre may sit from the tile it is attributed to,
 * in logical units.
 *
 * specs/board.md: "A node fills its tile and is drawn centered on that point", so
 * a node's own draw is centred on the tile centre and half a tile (`TILE / 2`,
 * `16`) is the whole of the slack. It is an ATTRIBUTION radius rather than a
 * placement bound: where a node is drawn is board/tile-centres' requirement, and
 * the tiles here are four apart so nothing can be attributed to the wrong one.
 */
const ATTRIBUTION_MAX = TILE / 2;

/** The row the nodes are posed on: mid-board, far from the band and the entry row. */
const NODE_ROW = 8;

/** Every charge state, each on its own tile, four tiles apart. */
const NODES = [0, 1, 2, CHARGE_MAX].map((charge, i) => ({
  charge,
  c: 12 + 4 * i,
}));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every node on the board from a frame of assets/node/", async () => {
  startPlaying(h);
  for (const node of NODES) h.debug.setNode(node.c, NODE_ROW, node.charge);

  const drawn = drawnImages(h, await drawFrame(h));
  captureStill(h, "nodes");

  const read = spriteReader();
  for (const node of NODES) {
    const matches = await framesDrawnAt(
      read,
      drawn,
      tileCX(node.c),
      tileCY(NODE_ROW),
      ATTRIBUTION_MAX,
    );
    assertTrue(
      matches.some((match) => match.folder === "node"),
      `the node at charge ${node.charge}, on tile (${node.c}, ${NODE_ROW}), ` +
        "drawn from a frame of assets/node/ (specs/assets.md: every node on " +
        "the board is drawn from this folder) — the seeded art drawn on that " +
        `tile was ${matches.map(frameName).join(", ") || "none"}`,
    );
  }
});
