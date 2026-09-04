// Refract — instrumentation/snapshot-shape: the snapshot reports the full
// documented shape, with the four derived fields derived as the specs state.
//
// specs/instrumentation.md fixes the snapshot: version REFRACT_DEBUG_VERSION
// (2) and every field of its "Snapshot shape" block, present whatever the mode
// is. Four fields are derived rather than stored — a node's x and y from the
// cell center formula in specs/board.md, a crystal's spent from the crossings
// the drawn beams have begun on it, a beam's complete from R6 and R7 in
// specs/beams.md, and solved from R9 — and `beams` carries one entry per
// channel present and no entry for a channel the board does not use.
//
// THE POSED SCENARIO exercises every branch of that shape at once: a 5x3 board
// carrying all three channels and a one-charge crystal, with the square beam
// traced complete (R6 and R7 hold of it), a partial triangle beam drawn
// through the crystal (a crossing begun and not completed, so spent is 1 and
// the crystal is unsatisfied), the diamond beam untouched, and the triangle
// trace left LIVE — pointerDown and pointerMove with no pointerUp — so
// `tracing` reports its object branch. Every assertion reads the snapshot the
// poses left, before any frame runs: the surface is a pure reading of the
// state, so the whole shape is decidable the moment it is posed.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertHasProperty,
  assertNotNull,
  assertNull,
  assertTrue,
  fail,
} from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  traceRoute,
  type Harness,
  type RefractSnapshot,
} from "../harness";
import { cellX, cellY, parseBoard } from "../notation";
import { REFRACT_DEBUG_VERSION } from "../surface";

/**
 * All three channels, a crystal, and room for a complete and a partial beam:
 * triangle down the left column, square down the middle, diamond down the
 * right, and a one-charge crystal at (1, 1) diagonal to the triangle's top
 * emitter. Spec-derived, written in specs/board.md notation.
 */
const SHAPE_BOARD = `
T.S.D
t1s.d
T.S.D
`;

/** The board's dimensions, for the cell center formula. */
const COLS = 5;
const ROWS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Pose the scenario and hand back the snapshot it left: the square beam
 * complete, a live triangle trace one segment into the crystal, the diamond
 * beam untouched. Poses are immediate, so nothing here advances a frame.
 */
function poseShape(): RefractSnapshot {
  // The square beam, traced complete: emitter to lens to emitter, so exactly
  // one segment meets each emitter (R6) and the lens carries exactly two (R7).
  traceRoute(h, [
    [2, 0],
    [2, 1],
    [2, 2],
  ]);
  // A LIVE partial triangle trace: a press on the top triangle emitter, one
  // diagonal move into the crystal, and no release. The entry spends the
  // crystal's charge (specs/beams.md R5), the crossing is begun and not
  // completed, and `tracing` stays non-null.
  h.debug.pointerDown(cellX(0, COLS), cellY(0, ROWS));
  h.debug.pointerMove(cellX(1, COLS), cellY(1, ROWS));
  return h.snapshot();
}

it("reports the version and every documented field, with its documented type", async () => {
  await resetTo(h, 1);
  await loadBoard(h, SHAPE_BOARD);
  const s = poseShape();
  await h.advance(1);
  captureStill(h, "posed");

  assertEqual(
    s.version,
    REFRACT_DEBUG_VERSION,
    "version (REFRACT_DEBUG_VERSION)",
  );
  assertEqual(s.screen, "playing", "loadBoard moves to playing");
  assertTrue(
    s.mode === "campaign" || s.mode === "cascade",
    "mode is one of the two documented modes",
  );
  assertEqual(s.menuIndex, 0, "menuIndex rests at 0 on playing");

  // The six mode fields, present whatever the mode is.
  assertEqual(typeof s.boardIndex, "number", "boardIndex");
  assertTrue(Array.isArray(s.solvedBoards), "solvedBoards is an array");
  for (const entry of s.solvedBoards) {
    assertEqual(typeof entry, "number", "a solvedBoards entry");
  }
  assertEqual(typeof s.unlockedCount, "number", "unlockedCount");
  assertEqual(typeof s.selectIndex, "number", "selectIndex");
  assertEqual(typeof s.solvedCount, "number", "solvedCount");
  assertEqual(typeof s.tier, "number", "tier");

  // The board block: the posed dimensions and one entry per posed node.
  assertEqual(s.board.cols, COLS, "board.cols");
  assertEqual(s.board.rows, ROWS, "board.rows");
  assertEqual(s.board.nodes.length, 10, "one node entry per posed node");
  for (const node of s.board.nodes) {
    for (const field of ["col", "row", "x", "y"] as const) {
      assertEqual(typeof node[field], "number", `a node's ${field}`);
    }
    assertHasProperty(node, "kind");
    assertHasProperty(node, "channel");
    assertHasProperty(node, "charges");
    assertHasProperty(node, "spent");
  }

  // One beams entry per channel present, and no entry beyond them.
  assertDeepEqual(
    Object.keys(s.beams).sort(),
    ["diamond", "square", "triangle"],
    "beams carries one entry per channel present",
  );
  for (const beam of Object.values(s.beams)) {
    assertTrue(Array.isArray(beam.cells), "a beam's cells is an array");
    assertEqual(typeof beam.complete, "boolean", "a beam's complete");
  }

  assertEqual(typeof s.solved, "boolean", "solved");

  // The live trace posed above reports its documented object branch.
  assertNotNull(s.tracing, "tracing is non-null while a trace is live");
  assertEqual(s.tracing?.channel, "triangle", "tracing.channel");
  assertDeepEqual(
    s.tracing?.live,
    { col: 1, row: 1 },
    "tracing.live names the cell of the live end",
  );

  assertEqual(typeof s.pointer.x, "number", "pointer.x");
  assertEqual(typeof s.pointer.y, "number", "pointer.y");
  assertEqual(typeof s.pointer.down, "boolean", "pointer.down");
  assertEqual(typeof s.muted, "boolean", "muted");
  assertEqual(typeof s.simTime, "number", "simTime");
});

it("derives node centers, spent, complete, and solved as the specs state", async () => {
  await resetTo(h, 1);
  await loadBoard(h, SHAPE_BOARD);
  const s = poseShape();

  // Every node sits on the cell center formula in specs/board.md, and carries
  // the kind and channel the notation wrote, with `channel` null for the
  // crystal and `charges`/`spent` null for every emitter and lens.
  const want = parseBoard(SHAPE_BOARD);
  const wantAt = new Map(
    want.nodes.map((node) => [`${node.col},${node.row}`, node]),
  );
  for (const node of s.board.nodes) {
    const key = `${node.col},${node.row}`;
    const expected = wantAt.get(key);
    if (expected === undefined) {
      fail(`a node the notation put on the board (cell ${key})`, node);
      continue;
    }
    assertCloseTo(node.x, cellX(node.col, COLS), 6, `node ${key}: x`);
    assertCloseTo(node.y, cellY(node.row, ROWS), 6, `node ${key}: y`);
    assertEqual(node.kind, expected.kind, `node ${key}: kind`);
    assertEqual(node.channel, expected.channel, `node ${key}: channel`);
    if (expected.kind === "crystal") {
      assertEqual(node.charges, 1, `node ${key}: the crystal's charges`);
      // The partial triangle beam has entered the crystal: one crossing
      // begun, so one charge is spent (specs/beams.md R5; the snapshot
      // derives spent from the crossings the drawn beams have begun).
      assertEqual(node.spent, 1, `node ${key}: the crystal's spent`);
    } else {
      assertNull(node.charges, `node ${key}: charges is null off a crystal`);
      assertNull(node.spent, `node ${key}: spent is null off a crystal`);
    }
  }

  // The drawn order, and complete derived from R6 and R7: the square beam
  // runs between its two emitters with its one lens carrying two segments, so
  // it is complete; the partial triangle beam and the untouched diamond beam
  // are not.
  assertDeepEqual(
    s.beams.square?.cells,
    [
      { col: 2, row: 0 },
      { col: 2, row: 1 },
      { col: 2, row: 2 },
    ],
    "the square beam's cells, in drawn order",
  );
  assertEqual(
    s.beams.square?.complete,
    true,
    "R6 and R7 hold of the square beam",
  );
  assertDeepEqual(
    s.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
    ],
    "the partial triangle beam's cells, in drawn order",
  );
  assertEqual(
    s.beams.triangle?.complete,
    false,
    "a beam ending on a crystal does not run between its emitters (R6)",
  );
  assertEqual(
    s.beams.diamond?.complete,
    false,
    "an empty beam is not complete (R6)",
  );

  // And solved from R9: two channels incomplete, so the board is not solved.
  assertEqual(
    s.solved,
    false,
    "solved is R9: complete beams for every channel present",
  );
});
