// presentation/closed-track-reads-as-a-loop — closing a track joins its last cell
// to its first and takes its end marks off.
//
// THE RULE. "A track's path reads as a path, with its two ends visible while it is
// open" (`specs/parts.md`, Presentation) — while it is OPEN, which is what makes
// the closed case this point's: `specs/assets.md` puts "A track's path, its ends,
// and whether it is closed" among the things the build draws in code.
//
// WHAT CLOSING MEANS. "A track is `closed` when its last cell is adjacent to its
// first and the editor has joined them into a loop ... otherwise it is open"
// (`specs/parts.md`), and what changes for the player is exactly two things: the
// run wraps between the ends — "on a closed track both wrap between the ends, and
// on an open track moving past either end faults" — and the two cells that were
// ends are no longer ends: "A press on any cell of a closed track begins a move"
// rather than a lay (`specs/editor.md`). Both are read here.
//
// ONE PATH, TWO STATES. Six cells laid in a ring around the field's middle, so the
// last is adjacent to the first and the editor may join them; the same track is
// read open and then closed, so what the two frames differ by is the loop and
// nothing else. `closeTrack` is the editor's own join through the surface.
//
// THE SEAM IS READ AGAINST THE PATH'S OWN OTHER JOINS, not against a figure of
// this file's choosing. Each of the six boundaries between consecutive cells is
// read as `presentation/track-path-reads-as-a-path` reads one — the square about
// the midpoint of two centres, which lies on their shared edge — and what is
// required of the seam is that closing draws it as the path's weakest other join
// is drawn. Read that way no colour, width, or shape is asked of the build, and an
// open path whose seam carries only the bleed of the two cells either side of it
// does not clear the bar.
//
// AND THE END MARKS COME OFF. The two cells that were the open path's ends are
// drawn differently once it is closed, while the four cells between them are drawn
// exactly as they were — so what closing changed is the ends rather than the whole
// path, which is what "shows no end cells" says.
//
// THE VERDICT. Closed, the seam is drawn as the other five joins are; open, it is
// not. Closing redraws the two former end cells and leaves the other four alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertTrue,
} from "../assert";
import { adjacent, at, hexCenter, type Hex, type StagePoint } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  differingShare,
  openChallengeDocument,
  partById,
  placeTrack,
  type Harness,
  type PixelRect,
} from "../harness";

/**
 * The six cells the path runs through: the ring around `(0, 0)`.
 *
 * Consecutive cells are adjacent and so are the last and the first, which is what
 * `specs/parts.md` requires of a closed track, and six cells is well past the
 * three it requires at least.
 */
const RING: readonly Hex[] = [
  at(1, 0),
  at(0, 1),
  at(-1, 1),
  at(-1, 0),
  at(0, -1),
  at(1, -1),
];

/** The index of the boundary between the last cell and the first: the seam. */
const SEAM = RING.length - 1;

/** Half the side of the square a join is read over. */
const JOIN_HALF = 10;

/** Half the side of the square a cell is read over; inside its own hex. */
const CELL_HALF = 18;

/**
 * How much of the path's weakest other join the seam must be drawn as.
 *
 * Half, so nothing is required of how a build draws a corner of its loop, while a
 * seam carrying no more than the bleed of the cells either side of it — which is
 * what an unjoined pair carries — cannot reach it.
 */
const SEAM_SHARE_OF_OTHERS = 0.5;

/** The least share of a cell that closing must redraw at a former end. */
const MIN_DISTINCT_SHARE = 0.05;

/** How much of a cell closing may redraw away from the two former ends. */
const UNTOUCHED_SHARE = 0.01;

function joinOf(a: Hex, b: Hex): StagePoint {
  const from = hexCenter(a);
  const to = hexCenter(b);
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

function joinSquare(index: number): Promise<PixelRect> {
  const point = joinOf(
    RING[index] as Hex,
    RING[(index + 1) % RING.length] as Hex,
  );
  return h.pixelRect(
    point.x - JOIN_HALF,
    point.y - JOIN_HALF,
    2 * JOIN_HALF,
    2 * JOIN_HALF,
  );
}

function cellSquare(index: number): Promise<PixelRect> {
  const centre = hexCenter(RING[index] as Hex);
  return h.pixelRect(
    centre.x - CELL_HALF,
    centre.y - CELL_HALF,
    2 * CELL_HALF,
    2 * CELL_HALF,
  );
}

async function joins(): Promise<PixelRect[]> {
  const read: PixelRect[] = [];
  for (let index = 0; index < RING.length; index += 1)
    read.push(await joinSquare(index));
  return read;
}

async function cells(): Promise<PixelRect[]> {
  const read: PixelRect[] = [];
  for (let index = 0; index < RING.length; index += 1)
    read.push(await cellSquare(index));
  return read;
}

it("draws a closed track joined at its seam and without the end marks the open path carried", async () => {
  assertTrue(
    adjacent(RING[SEAM] as Hex, RING[0] as Hex),
    "the path's last cell is adjacent to its first, which is what specs/parts.md requires before the editor may join them into a loop",
  );

  await openChallengeDocument(h, BARE);
  await h.advance(1);
  const bareJoins = await joins();

  const track = await placeTrack(h, RING, false);
  // The editor outlines the selected part's cells (`specs/editor.md`), which
  // would mark the whole path alike either side of the join.
  await h.debug.setSelected(null);
  await h.advance(1);
  await captureStill(h, "loop");
  assertEqual(
    partById(await h.snapshot(), track)?.closed,
    false,
    "the path is laid open first, which is the state its two ends are drawn in",
  );
  const openJoins = await joins();
  const openCells = await cells();

  await h.debug.closeTrack(track);
  await h.debug.setSelected(null);
  await h.advance(1);
  await captureStill(h, "loop");
  assertEqual(
    partById(await h.snapshot(), track)?.closed,
    true,
    "the editor joined the path into a loop, which is the state this point reads",
  );
  const closedJoins = await joins();
  const closedCells = await cells();

  // How strongly each boundary is drawn: how much of it the track redrew.
  const openDrawn = openJoins.map((join, index) =>
    differingShare(bareJoins[index] as PixelRect, join),
  );
  const closedDrawn = closedJoins.map((join, index) =>
    differingShare(bareJoins[index] as PixelRect, join),
  );
  const others = closedDrawn.filter((_share, index) => index !== SEAM);
  const bar = SEAM_SHARE_OF_OTHERS * Math.min(...others);
  assertGreaterThan(
    bar,
    0,
    "the closed path's other five joins are drawn, so there is a join of its own to read the seam against",
  );

  assertGreaterThan(
    closedDrawn[SEAM] as number,
    bar,
    "the closed track's seam between its last cell and its first is drawn as its other joins are, so the loop is joined all the way round",
  );
  assertLessThan(
    openDrawn[SEAM] as number,
    bar,
    "the same two cells were NOT drawn joined while the path was open, so a loop is told from an open path at a glance",
  );

  for (let index = 0; index < RING.length; index += 1) {
    const changed = differingShare(
      openCells[index] as PixelRect,
      closedCells[index] as PixelRect,
    );
    const wasAnEnd = index === 0 || index === SEAM;
    if (wasAnEnd) {
      assertGreaterThan(
        changed,
        MIN_DISTINCT_SHARE,
        `closing the path redraws the cell (${(RING[index] as Hex).q}, ${(RING[index] as Hex).r}) that was one of its two ends, so the closed track shows no end cells`,
      );
    } else {
      assertLessThan(
        changed,
        UNTOUCHED_SHARE,
        `closing the path leaves the cell (${(RING[index] as Hex).q}, ${(RING[index] as Hex).r}) as it was, so what closing changed is the ends rather than every cell of the path`,
      );
    }
  }
});
