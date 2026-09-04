// Wireworm — screens/pause-screen: the pause menu offers all three of its items,
// and the board is still there behind it.
//
// specs/ui.md's `paused` screen: "The board stays visible behind the menu", and
// the menu is `PAUSE_ITEMS` — `RESUME`, `RESTART`, `QUIT TO MENU`. The copy is
// matched by substring, because the words are the case's and a highlighted entry
// is commonly drawn with a marker beside it.
//
// VISIBLE IS READ OFF THE DRAWS, NOT OFF THE PIXELS. specs/ui.md lets a build
// quiet the board behind the menu however it likes, so a colour sample would be
// measuring how heavy a build's scrim is rather than whether the board is drawn
// — and a build that dims hard is as conformant as one that does not. What the
// specification does fix is that "Every node on the board is drawn from this
// folder, centered on its tile" (specs/assets.md), so three nodes are posed
// across the board and the paused frame is required to still draw each of them
// from the seeded art at its tile. A build that stops drawing the board behind
// the menu draws none of them.
//
// That the board is also FROZEN is `screens/pause-freezes`'s requirement, and
// nothing here reads it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { PAUSE_ITEMS, TILE, tileCX, tileCY } from "../constants";
import {
  blitsOfFrame,
  captureStill,
  createHarness,
  drawnFrom,
  drewText,
  poseNodes,
  startPlaying,
  type Harness,
} from "../harness";
import { pauseLiveBoard } from "./screens";

/**
 * How far a node's sprite may be drawn from the centre of its tile, in logical
 * units, and still be that node's draw.
 *
 * specs/assets.md draws every node "centered on its tile", and a tile is `TILE`
 * (`32`) units square, so a draw whose destination box is centred within half a
 * tile of the tile's centre is on that tile and no other. Where a sprite is
 * drawn to within less than that is `presentation/node-from-sprite`'s business,
 * not this check's.
 */
const NODE_WITHIN = TILE / 2;

/**
 * The three tiles the board is posed on: spread across it, clear of the HUD bar
 * above and of the player band along the floor, and away from the middle
 * columns, so a menu a build chose to centre neither hides all three from the
 * reviewer's still nor is mistaken for one of them.
 */
const POSED_NODES: readonly (readonly [number, number, number])[] = [
  [3, 3, 1],
  [36, 8, 2],
  [12, 15, 3],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws all three pause items over a board that is still drawn", async () => {
  await startPlaying(h);
  await poseNodes(h, POSED_NODES);

  await pauseLiveBoard(h);

  const calls = await h.frameCalls();
  await captureStill(h, "pause");

  assertEqual((await h.snapshot()).screen, "paused", "the screen pausing left");
  for (const item of PAUSE_ITEMS) {
    assertEqual(drewText(calls, item), true, `draws the menu item "${item}"`);
  }

  const blits = await blitsOfFrame(h);
  for (const [c, r] of POSED_NODES) {
    assertGreaterThanOrEqual(
      drawnFrom(blits, "node", { x: tileCX(c), y: tileCY(r) }, NODE_WITHIN)
        .length,
      1,
      `the node on tile (${c}, ${r}) is still drawn behind the pause menu`,
    );
  }
});
