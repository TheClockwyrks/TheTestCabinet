// presentation/node-ramp-distinct — each charge state is drawn from its own
// frame of the seeded node art.
//
// specs/assets.md fixes the mapping outright: `assets/node/` holds five frames,
// frame `0` is drawn for a node at charge `0`, frame `1` for charge `1`, frame
// `2` for charge `2`, frame `3` for charge `3`, and frame `4` is "the alternate
// critical frame" a charge `3` node alternates with. "A node below charge `3`
// holds the single frame for its charge." So the four states are told apart by
// the ART THE BUILD DREW THEM FROM, which the file states, rather than by any
// colour, which it deliberately leaves open ("The palette, the type, the glow,
// and every other aspect of the look are yours").
//
// SO THE READING IS THE IMAGE SOURCE ITSELF, NOT THE PIXELS ON THE STAGE. Every
// `drawImage` of one frame is captured with the bitmap it was handed, and that
// bitmap's own pixels are held against the seeded PNGs read off the workspace's
// own `assets/` tree. What is asserted is the frame INDEX on each node's tile: a
// build that drew charge `2` from frame `1` is named for the state it drew
// wrong, and a build that drew all four from one frame is named four times over.
//
// WHAT THIS ADDS OVER presentation/node-from-sprite. That point asks whether SOME
// frame of the folder was drawn on a node's tile. This one asks whether it was
// the frame the charge names, which is the whole of "the four states are told
// apart".
//
// THE CRITICAL STATE ALLOWS EITHER OF ITS PAIR, because specs/assets.md gives it
// two frames and one drawn frame shows whichever of them the pulse was on. That
// the pair alternates is presentation/critical-pulses's requirement.
//
// THE FOUR NODES ARE THE ONLY THINGS ON THE BOARD. `startPlaying` poses an
// empty, quiet board, and the four nodes are then set one charge at a time, six
// tiles apart along one row well clear of the player band, where the cursor
// rests.

import { afterEach, beforeEach, it } from "vitest";
import {
  CHARGE_MAX,
  NODE_CRITICAL_FRAMES,
  TILE,
  tileCX,
  tileCY,
} from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  chargeAt,
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
 * the tiles here are six apart so nothing can be attributed to the wrong one.
 */
const ATTRIBUTION_MAX = TILE / 2;

/** The row the four nodes are posed on: mid-board, clear of the player band. */
const RAMP_ROW = 8;

/** The column each charge is posed in, six tiles apart so no draw overlaps. */
const RAMP_COLUMN = [6, 12, 18, 24] as const;

/** The frames of `assets/node/` specs/assets.md draws each charge from. */
function nodeFrames(charge: number): readonly number[] {
  return charge === CHARGE_MAX ? NODE_CRITICAL_FRAMES : [charge];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws each of the four charge states from the frame its charge names", async () => {
  startPlaying(h);
  for (let charge = 0; charge <= CHARGE_MAX; charge += 1) {
    h.debug.setNode(RAMP_COLUMN[charge], RAMP_ROW, charge);
  }

  const drawn = drawnImages(h, await drawFrame(h));
  // The four states side by side, as the build drew them.
  captureStill(h, "ramp");

  const snapshot = h.snapshot();
  const read = spriteReader();
  for (let charge = 0; charge <= CHARGE_MAX; charge += 1) {
    const column = RAMP_COLUMN[charge];
    assertEqual(
      chargeAt(snapshot, column, RAMP_ROW),
      charge,
      `the node posed at (${column}, ${RAMP_ROW}) holds charge ${charge}`,
    );

    const wanted = nodeFrames(charge);
    const matches = await framesDrawnAt(
      read,
      drawn,
      tileCX(column),
      tileCY(RAMP_ROW),
      ATTRIBUTION_MAX,
    );
    const nodeFramesDrawn = matches.filter((match) => match.folder === "node");
    const named = wanted
      .map((index) => `assets/node/${index}.png`)
      .join(" or ");
    assertTrue(
      nodeFramesDrawn.length > 0 &&
        nodeFramesDrawn.every((match) => wanted.includes(match.index)),
      `the node at charge ${charge}, on tile (${column}, ${RAMP_ROW}), drawn ` +
        `from ${named} (specs/assets.md: frame ${charge} is drawn for a node ` +
        `at charge ${charge}) — the seeded art drawn on that tile was ` +
        `${matches.map(frameName).join(", ") || "none"}`,
    );
  }
});
