// Refract — instrumentation/snapshot-shape: on a posed board carrying all
// three channels and a crystal, with a partial beam drawn, the snapshot
// reports version REFRACT_DEBUG_VERSION (2) and every field
// specs/instrumentation.md lists with its documented type, with each node's
// x and y on the cell center formula in specs/board.md and spent, complete,
// and solved derived exactly as specs/beams.md states.
//
// The board is built to exercise every branch of the shape at once: an
// emitter, a lens, and a crystal (so `channel` is null exactly for the
// crystal and `charges`/`spent` null exactly for the others), all three
// channels (so `beams` carries one entry per channel present, one of them
// still empty), a partial released beam on one channel and a LIVE partial
// trace on another (so `tracing` reports its non-null shape and the pointer
// reads pressed). Every derived value — a node's x/y, a crystal's spent, a
// beam's complete, `solved` — is computed from the spec-derived oracle
// (notation.ts geometry, rules.ts R1..R9) over the same board and beams, so
// the expected figures trace to specs/board.md and specs/beams.md alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertContains,
  assertDeepEqual,
  assertDefined,
  assertEqual,
  assertGreaterThanOrEqual,
  assertHasProperty,
  assertNotNull,
  assertNull,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  moveToCell,
  pressCell,
  resetTo,
  traceCells,
  type Harness,
} from "../harness";
import { cellCenter, parseBoard, CHANNELS } from "../notation";
import { beamComplete, crystalEntries, r9Solved, type Beams } from "../rules";
import { REFRACT_DEBUG_VERSION, type CellRef } from "../surface";
import { SNAPSHOT_FIELDS } from "./fields";

/**
 * All three channels and a crystal on one 5x3 board: triangle across the top
 * (emitters at the corners, a lens beside the left one), square across the
 * middle with the 1-charge crystal between its left emitter and its lens,
 * diamond across the bottom. Every channel carries exactly two emitters, so
 * the board is legal under specs/board.md.
 */
const ALL_CHANNELS_CRYSTAL = `
Tt..T
.S1sS
D..dD
`;

/** The partial triangle beam, drawn and released: one segment to the lens. */
const TRIANGLE_BEAM: CellRef[] = [
  { col: 0, row: 0 },
  { col: 1, row: 0 },
];

/**
 * The partial square beam, left LIVE: emitter into the crystal (spending its
 * one charge on entry), out to the lens, no release.
 */
const SQUARE_BEAM: CellRef[] = [
  { col: 1, row: 1 },
  { col: 2, row: 1 },
  { col: 3, row: 1 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the full documented shape, every derivation on the spec's formula", async () => {
  await resetTo(h, 1);
  const oracle = await loadBoard(h, ALL_CHANNELS_CRYSTAL);
  assertDeepEqual(
    oracle,
    parseBoard(ALL_CHANNELS_CRYSTAL),
    "the oracle parse of the posed notation",
  );

  // The partial triangle beam, drawn and released through the pointer
  // operations.
  traceCells(h, TRIANGLE_BEAM);
  // The partial square beam, drawn move by move and left live: the pointer
  // operations resolve at the call, so no frame passes and the trace stays up
  // while the snapshot is read.
  pressCell(h, { col: 1, row: 1 });
  moveToCell(h, { col: 2, row: 1 });
  moveToCell(h, { col: 3, row: 1 });

  // The snapshot under test, read with the trace still live.
  const snap = h.snapshot();

  // The beams as the oracle carries them, for every derived expectation.
  const beams: Beams = {
    triangle: TRIANGLE_BEAM.map((cell) => ({ ...cell })),
    square: SQUARE_BEAM.map((cell) => ({ ...cell })),
    diamond: [],
  };

  // The picture the snapshot reports, kept whatever the verdict: the render
  // lands on the frame after the poses. (A frame passing cannot move the
  // trace: the pointer has not moved, and the operations resolve at the call.)
  await h.advance(1);
  captureStill(h, "posed");

  // Version, and no documented field missing.
  assertEqual(snap.version, REFRACT_DEBUG_VERSION, "version");
  for (const field of SNAPSHOT_FIELDS) {
    assertHasProperty(snap, field, "a documented snapshot field");
  }

  // The scalar fields, each with its documented type and value where the
  // specification fixes one.
  assertEqual(snap.screen, "playing", "loadBoard moves to playing");
  assertContains(
    ["campaign", "cascade"],
    snap.mode,
    "mode is one of the two documented modes",
  );
  assertEqual(snap.menuIndex, 0, "menuIndex rests at 0 on playing");
  for (const field of [
    "boardIndex",
    "unlockedCount",
    "selectIndex",
    "solvedCount",
    "tier",
  ] as const) {
    assertEqual(typeof snap[field], "number", `${field} is a number`);
  }
  assertTrue(Array.isArray(snap.solvedBoards), "solvedBoards is an array");
  for (const index of snap.solvedBoards) {
    assertEqual(typeof index, "number", "a solvedBoards entry is a number");
  }
  assertEqual(typeof snap.muted, "boolean", "muted is a boolean");
  assertEqual(typeof snap.simTime, "number", "simTime is a number");
  assertGreaterThanOrEqual(snap.simTime, 0, "simTime accumulates from 0");
  assertEqual(typeof snap.rngState, "number", "rngState is a number");

  // The board: dimensions, and every node with its cell, its kind, its
  // channel/charges/spent nulls, and its x/y on the cell center formula.
  assertEqual(snap.board.cols, oracle.cols, "board.cols");
  assertEqual(snap.board.rows, oracle.rows, "board.rows");
  assertEqual(
    snap.board.nodes.length,
    oracle.nodes.length,
    "one reported node per posed node",
  );
  for (const node of oracle.nodes) {
    const at = `node at (${node.col}, ${node.row})`;
    const reported = snap.board.nodes.find(
      (candidate) => candidate.col === node.col && candidate.row === node.row,
    );
    assertDefined(reported, at);
    if (reported === undefined) continue;
    assertEqual(reported.kind, node.kind, `${at}: kind`);
    const center = cellCenter(node.col, node.row, oracle.cols, oracle.rows);
    assertCloseTo(reported.x, center.x, 6, `${at}: x on the center formula`);
    assertCloseTo(reported.y, center.y, 6, `${at}: y on the center formula`);
    if (node.kind === "crystal") {
      assertNull(reported.channel, `${at}: a crystal's channel is null`);
      assertEqual(reported.charges, node.charges, `${at}: charges`);
      assertEqual(
        reported.spent,
        crystalEntries(beams, { col: node.col, row: node.row }),
        `${at}: spent derived from the crossings begun on it (specs/beams.md)`,
      );
    } else {
      assertEqual(reported.channel, node.channel, `${at}: channel`);
      assertNull(reported.charges, `${at}: charges is null off a crystal`);
      assertNull(reported.spent, `${at}: spent is null off a crystal`);
    }
  }
  // The crystal's one charge really was spent by the square beam's entry.
  const crystal = snap.board.nodes.find((node) => node.kind === "crystal");
  assertEqual(crystal?.spent, 1, "the entered crystal's spent");

  // Beams: one entry per channel present — all three here, the diamond one
  // still empty — each with its drawn cells and its R6+R7-derived complete.
  assertDeepEqual(
    Object.keys(snap.beams).sort(),
    [...CHANNELS].sort(),
    "one beams entry per channel present",
  );
  assertDeepEqual(snap.beams.triangle?.cells, TRIANGLE_BEAM, "triangle cells");
  assertDeepEqual(snap.beams.square?.cells, SQUARE_BEAM, "square cells");
  assertDeepEqual(snap.beams.diamond?.cells, [], "diamond cells (no beam)");
  for (const channel of CHANNELS) {
    assertEqual(
      snap.beams[channel]?.complete,
      beamComplete(oracle, beams, channel),
      `${channel} complete derived from R6 and R7 (specs/beams.md)`,
    );
  }

  // Solved: R9 over the same board and beams — false, every beam partial.
  assertEqual(
    snap.solved,
    r9Solved(oracle, beams),
    "solved derived from R9 (specs/beams.md)",
  );
  assertEqual(snap.solved, false, "partial beams do not solve");

  // Tracing: the live square trace, its channel and its live end — the last
  // cell of the drawn beam.
  assertNotNull(snap.tracing, "a live trace reports non-null tracing");
  assertEqual(snap.tracing?.channel, "square", "tracing.channel");
  assertDeepEqual(
    snap.tracing?.live,
    { col: 3, row: 1 },
    "tracing.live is the beam's last drawn cell",
  );

  // Pointer: position and pressed bit, pressed while the trace is live.
  assertEqual(typeof snap.pointer.x, "number", "pointer.x is a number");
  assertEqual(typeof snap.pointer.y, "number", "pointer.y is a number");
  assertEqual(snap.pointer.down, true, "the pointer reads pressed mid-trace");
});
