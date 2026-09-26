// Wireworm — presentation/node-ramp-distinct: each charge state is drawn from
// its own frame of the seeded node art.
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
// bitmap the frame blitted is captured with the source it was handed, and that
// source is held against the seeded PNGs read off the same `assets/` tree the
// build was seeded with. What is asserted is the frame INDEX on each node's
// tile: a build that drew charge `2` from frame `1` is named for the state it
// drew wrong, and a build that drew all four from one frame is named four times
// over.
//
// WHAT THIS ADDS OVER presentation/node-from-sprite. That point asks whether
// SOME frame of the folder was blitted on a node's tile. This one asks whether
// it was the frame the charge names, which is the whole of "the four states are
// told apart".
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
import { CHARGE_MAX, NODE_CRITICAL_FRAMES, TILE } from "../constants";
import { assertEqual, fail } from "../assert";
import {
  captureStill,
  chargeAt,
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
  resetTo(h);
  startPlaying(h);
  for (let charge = 0; charge <= CHARGE_MAX; charge += 1) {
    h.debug.setNode(RAMP_COLUMN[charge], RAMP_ROW, charge);
  }

  h.calls.length = 0;
  await h.advance(1);
  const blits = drawnImages(h);
  // The four states side by side, as the build drew them.
  captureStill(h, "ramp");

  const snapshot = h.snapshot();
  assertEqual(h.assetFailures.length, 0, "every seeded frame loaded");

  for (let charge = 0; charge <= CHARGE_MAX; charge += 1) {
    const column = RAMP_COLUMN[charge];
    assertEqual(
      chargeAt(snapshot, column, RAMP_ROW),
      charge,
      `the node posed at (${column}, ${RAMP_ROW}) holds charge ${charge}`,
    );

    const centre = tileCenter(column, RAMP_ROW);
    const near = blits.filter(
      (blit) => Math.hypot(blit.x - centre.x, blit.y - centre.y) <= PLACED_MAX,
    );
    const matches = await Promise.all(
      near.map((blit) => nearestSeededFrame(blit.source)),
    );
    const drawn = matches.filter(
      (match) => match.folder === "node" && match.distance <= MATCH_MAX,
    );
    const wanted = nodeFrames(charge);
    if (
      drawn.length > 0 &&
      drawn.every((match) => wanted.includes(match.index))
    ) {
      continue;
    }
    const named = wanted
      .map((index) => `assets/node/${index}.png`)
      .join(" or ");
    fail(
      `the node at (${column}, ${RAMP_ROW}) holding charge ${charge} to be ` +
        `drawn from ${named} (specs/assets.md: frame ${charge} is drawn for ` +
        `a node at charge ${charge})`,
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
