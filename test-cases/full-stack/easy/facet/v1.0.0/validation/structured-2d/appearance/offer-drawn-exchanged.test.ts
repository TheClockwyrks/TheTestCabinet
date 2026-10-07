// Facet — appearance/offer-drawn-exchanged: while an offer stands, the two cells
// it names are drawn carrying each other's gems.
//
// WHAT IS BEING DECIDED. specs/ui.md lists the offer among what the `playing`
// screen shows — "The offer — While `state.offer` stands, the gem at
// `state.selection` and the gem at `state.offer` drawn exchanged, so a player
// sees the move a release would play" — and specs/overview.md states the same
// requirement beside the selection's: "while an offer stands the two gems it
// names are drawn exchanged". specs/controls.md is what makes it load-bearing:
// "Nothing reaches the move rules until the pointer is released", and a player
// who carries a gem back where it came from has played nothing. The drawn
// exchange is the whole of what tells a player, before they let go, which move
// letting go would ask for.
//
// HOW THREE RENDERS DECIDE IT. One board, one pair of orthogonally adjacent
// cells, and three renders of them:
//
//   unoffered  — the selection standing on the first cell, no offer.
//   offered    — the same selection, with the second cell offered.
//   exchanged  — the two gems posed the other way round through `loadBoard`,
//                with the same selection standing.
//
// Each cell is read in all three, and what is asserted is that the OFFERED
// reading of each cell sits nearer the EXCHANGED arrangement than the UNOFFERED
// one. The reading is relative on purpose: specs/ui.md asks for the gems drawn
// exchanged and does not forbid a build marking the offer as well, so a mark
// would move every absolute distance while leaving which of the two arrangements
// a frame is nearer alone. The selection is held standing through all three for
// the same reason — a selection mark that sat in one render and not another would
// be a difference this reading would have to explain away.
//
// THE PREMISE, ASSERTED RATHER THAN ASSUMED. Two cells drawn exchanged can only
// be read where the two gems were drawn differently in the first place, so the
// two unoffered readings themselves have to differ. That is a premise of the
// reading rather than a claim about how far apart two kinds look, which is the
// reviewer's; a build that drew the pair identically fails here as a point it
// could not be read on rather than answering on a coincidence.
//
// NOTHING IS RELEASED. specs/controls.md makes the release the edge that requests
// a swap, and the offer is posed through `setOffer`, which
// specs/instrumentation.md defines as leaving the selection, the board and the
// phase where they were and requesting nothing. So the board is at rest in all
// three renders and the only thing that moves is what the offer draws.

import { afterEach, beforeEach, it } from "vitest";
import {
  areAdjacent,
  maximalRuns,
  quietRowsWithEscape,
  swapped,
  tokenOf,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  assertGreaterThan,
  assertLength,
  assertLessThan,
  assertTrue,
} from "../assert";
import { GEM_KINDS } from "../constants";
import {
  captureStill,
  createHarness,
  loadBoard,
  patchDistance,
  readPatch,
  type Harness,
  type Patch,
} from "../harness";

/**
 * The two cells the offer names: mid-board, orthogonally adjacent, and clear of
 * the escape swap's corner, so both boxes are cut whole rather than clamped at a
 * canvas edge.
 */
const HELD: CellRef = { col: 3, row: 3 };
const OFFERED: CellRef = { col: 4, row: 3 };

/**
 * The two kinds the two cells carry.
 *
 * Two of the seven. Nothing about the point depends on which two they are, only
 * that they are two, and the premise below asserts of these two cells that the
 * build drew them differently.
 */
const HELD_KIND = GEM_KINDS[0];
const OFFERED_KIND = GEM_KINDS[3];

/** The two cells written over the run-free filler. */
const CELLS: readonly PlacedToken[] = [
  { col: HELD.col, row: HELD.row, token: tokenOf(HELD_KIND, 0) },
  { col: OFFERED.col, row: OFFERED.row, token: tokenOf(OFFERED_KIND, 0) },
];

/** One render, read at both cells. */
interface Reading {
  held: Patch;
  offered: Patch;
}

let h: Harness;

/** Both cells, off the frame the canvas is holding. */
function readBoth(): Reading {
  return {
    held: readPatch(h, HELD.col, HELD.row),
    offered: readPatch(h, OFFERED.col, OFFERED.row),
  };
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the offered pair carrying each other's gems", async () => {
  const rows = quietRowsWithEscape(CELLS);
  const exchangedRows = swapped(rows, HELD, OFFERED);

  // The scenario, established off the written boards before the build is asked
  // anything: the two cells are a pair the offer rules accept, and neither board
  // carries a run, so both of them rest exactly as they were written.
  assertTrue(
    areAdjacent(HELD, OFFERED),
    "the two cells are orthogonal neighbors",
  );
  assertLength(maximalRuns(rows), 0, "maximal runs on the posed board");
  assertLength(
    maximalRuns(exchangedRows),
    0,
    "maximal runs on the exchanged board",
  );

  // The selection standing, with nothing offered.
  loadBoard(h, rows);
  h.debug.setSelection(HELD.col, HELD.row);
  h.debug.clearOffer();
  await h.advance(1);
  const unoffered = readBoth();

  // The same board and the same selection, with the neighbor offered.
  h.debug.setOffer(OFFERED.col, OFFERED.row);
  await h.advance(1);
  const offered = readBoth();

  // Evidence, and no part of the verdict: the move a release would play, shown
  // before it is played.
  captureStill(h, "offer");

  // The arrangement the offer is showing, posed outright, with the selection
  // still standing so the two renders differ by the gems alone.
  loadBoard(h, exchangedRows);
  h.debug.setSelection(HELD.col, HELD.row);
  h.debug.clearOffer();
  await h.advance(1);
  const exchanged = readBoth();

  // The premise: the two gems are drawn apart, so "drawn exchanged" is something
  // a reading can see at all.
  assertGreaterThan(
    patchDistance(unoffered.held, unoffered.offered),
    0,
    `how far the ${HELD_KIND} at (${HELD.col},${HELD.row}) and the ` +
      `${OFFERED_KIND} at (${OFFERED.col},${OFFERED.row}) read apart with ` +
      `nothing offered`,
  );

  // And each cell, while the offer stands, is drawn nearer the exchanged
  // arrangement than the one the board is actually holding.
  assertLessThan(
    patchDistance(offered.held, exchanged.held),
    patchDistance(offered.held, unoffered.held),
    `how far the offered render of (${HELD.col},${HELD.row}) stands from the ` +
      `exchanged arrangement, against how far it stands from the unoffered one`,
  );
  assertLessThan(
    patchDistance(offered.offered, exchanged.offered),
    patchDistance(offered.offered, unoffered.offered),
    `how far the offered render of (${OFFERED.col},${OFFERED.row}) stands from ` +
      `the exchanged arrangement, against how far it stands from the unoffered one`,
  );
});
