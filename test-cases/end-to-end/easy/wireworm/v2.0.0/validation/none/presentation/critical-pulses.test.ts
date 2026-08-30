// Wireworm — presentation/critical-pulses: a critical node visibly pulses.
//
// specs/assets.md, on `assets/node/`'s five frames: frame `4` is "the alternate
// critical frame", and "a node at charge `3` alternates frames `3` and `4` at
// `NODE_PULSE_FPS` (`6`) frames per second, so a critical node visibly pulses. A
// node below charge `3` holds the single frame for its charge." A critical node
// is the one node worth shooting — specs/discharge.md detonates it and chains
// through the cluster around it — so the pulse is how a player picks it out of a
// field of quiet ones.
//
// THE READING IS THE SOURCE OF EVERY BLIT ON THE NODE'S TILE OVER ONE SECOND OF
// GAME TIME, and what is asked of it is what the point's own description asks:
// the node's drawn source ALTERNATES between two distinct frames of
// `assets/node/`. One second at `NODE_PULSE_FPS` covers six alternations, so a
// build pulsing at the stated rate shows both frames many times over, and a
// build pulsing at any rate a player could see as a pulse shows both at least
// once. Nothing here asserts WHICH pair the build alternates — that is
// specs/assets.md's frames `3` and `4`, and the reviewer's to see from the
// capture — only that the sources are the seeded folder's and that they change.
//
// A build that holds one frame fails: it shows one distinct source. A build that
// drew the pulse in light of its own over a held frame also fails, and that is
// deliberate — the file states the pulse as an alternation of the seeded frames.
//
// EVERY FRAME OF THE WATCHED SECOND IS READ, rather than a sample of them, so
// nothing about how the reading is spaced can alias against how fast the build
// pulses: the point asks whether the source ever changes, and this looks at every
// source it was.
//
// The node is alone on the board. `startPlaying` leaves no worm, foe or bolt,
// and the tile read sits mid-board, far from the cursor resting in its band.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { CHARGE_MAX, NODE_PULSE_FPS, TILE, tileCX, tileCY } from "../constants";
import {
  blitsOfFrame,
  captureStill,
  chargeAt,
  createHarness,
  drawnFrom,
  frameIndexes,
  framesFor,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * How far a blit's centre may sit from the tile it is drawn on, in logical
 * units.
 *
 * Half a tile. specs/board.md draws a node "centered on" its tile's centre, and
 * how a build inks the frame inside that tile is its own; a blit whose centre
 * left the tile altogether is drawn on a different tile.
 */
const PLACED_MAX = TILE / 2;

/**
 * How long the pulse is watched, in seconds.
 *
 * One second, which at `NODE_PULSE_FPS` (`6`) is six alternations of the pair —
 * so a build drawing the pulse specs/assets.md states shows both frames three
 * times each inside the window, and the window is not a rate this point
 * measures. How fast the pulse runs is the reviewer's to see from the capture.
 */
const WATCH_SECONDS = 1;

/** How many distinct frames of the folder a pulse must show over that second. */
const DISTINCT_FRAMES_MIN = 2;

/** The tile the critical node is posed on: mid-board, clear of the band. */
const NODE_COLUMN = 18;
const NODE_ROW = 9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("alternates a critical node between two frames of the seeded node art", async () => {
  await startPlaying(h);
  await h.debug.setNode(NODE_COLUMN, NODE_ROW, CHARGE_MAX);
  assertEqual(
    chargeAt(await h.snapshot(), NODE_COLUMN, NODE_ROW),
    CHARGE_MAX,
    `the node posed at (${NODE_COLUMN}, ${NODE_ROW}) holds charge ` +
      `${CHARGE_MAX}, which is critical`,
  );

  const at = { x: tileCX(NODE_COLUMN), y: tileCY(NODE_ROW) };
  const seen = new Set<number>();
  for (let frame = 0; frame < framesFor(WATCH_SECONDS); frame += 1) {
    const onTile = drawnFrom(await blitsOfFrame(h), "node", at, PLACED_MAX);
    for (const index of frameIndexes(onTile, "node")) seen.add(index);
  }
  // The node as the build left it at the end of the watched second.
  await captureStill(h, "pulse");

  assertGreaterThanOrEqual(
    seen.size,
    DISTINCT_FRAMES_MIN,
    `the critical node to alternate between ${DISTINCT_FRAMES_MIN} distinct ` +
      `frames of assets/node/ over ${WATCH_SECONDS} s — at NODE_PULSE_FPS ` +
      `(${NODE_PULSE_FPS}) that is ${NODE_PULSE_FPS} alternations ` +
      `(specs/assets.md: a node at charge ${CHARGE_MAX} alternates frames 3 ` +
      `and 4, so a critical node visibly pulses); the frames of assets/node/ ` +
      `drawn on that tile were ` +
      `${[...seen].sort((a, b) => a - b).join(", ") || "none"}`,
  );
});
