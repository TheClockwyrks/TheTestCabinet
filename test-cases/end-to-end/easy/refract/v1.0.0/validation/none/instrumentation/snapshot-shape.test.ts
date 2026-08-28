// Refract — instrumentation/snapshot-shape: on a posed board carrying all three
// channels and a crystal, with a partial beam drawn, the snapshot reports the
// full documented shape.
//
// THE SHAPE IS THE CONTRACT EVERY OTHER CHECK READS THROUGH. A field missing, a
// type drifted, or a derivation of the build's own invention would not fail here
// alone — it would quietly bend every point that reads the snapshot — so this
// point holds the whole documented object against `specs/instrumentation.md` in
// one place, on a board that exercises every branch of it: three channels (one
// `beams` entry each), a crystal (the `channel: null`, `charges`, `spent`
// branch), and a partial beam ending on that crystal (a `spent` that is really
// derived from a crossing begun, a `complete` that is really false).
//
// FOUR FIELDS ARE DERIVED RATHER THAN STORED, and each is held against the
// case's own spec-derived oracle, never against any implementation: a node's
// `x`/`y` against the cell center formula in `specs/board.md`, a crystal's
// `spent` against the crossings the drawn beams have begun on it (`specs/beams.md`
// R5: the charge is spent on entry), and `complete` and `solved` against R6/R7
// and R9 as `rules.ts` states them.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertDefined,
  assertEqual,
  assertGreaterThanOrEqual,
  assertHasProperty,
  assertLength,
  assertNull,
} from "../assert";
import { cellCenter, parseBoard, type Channel } from "../notation";
import { beamComplete, r9Solved, type Beams } from "../rules";
import {
  captureStill,
  createHarness,
  loadBoard,
  REFRACT_DEBUG_VERSION,
  traceCells,
  type Harness,
  type RefractSnapshot,
} from "../harness";

/**
 * A 3x3 board exercising every branch of the shape: all three channels (each
 * with its two emitters, square and diamond each with a lens), and a crystal
 * carrying one charge at (1, 0), where the partial beam will end.
 */
const FULL_SHAPE = `
T1T
SsS
DdD
`;

/**
 * The partial beam: the triangle channel entering the crystal and stopping
 * there. One segment, incomplete (one emitter met, R6 fails), and a crossing
 * begun and not completed — so the crystal's derived `spent` is 1 while the
 * beam is anything but finished.
 */
const PARTIAL: readonly { col: number; row: number }[] = [
  { col: 0, row: 0 },
  { col: 1, row: 0 },
];

/** The drawn beams, as the rules oracle reads them. */
const DRAWN: Beams = { triangle: PARTIAL.map((cell) => ({ ...cell })) };

/** Every field `specs/instrumentation.md` lists on the snapshot. */
const SNAPSHOT_FIELDS = [
  "version",
  "screen",
  "mode",
  "menuIndex",
  "boardIndex",
  "solvedBoards",
  "unlockedCount",
  "selectIndex",
  "solvedCount",
  "tier",
  "board",
  "beams",
  "solved",
  "tracing",
  "pointer",
  "muted",
  "simTime",
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Pose the board, draw the partial beam, render one frame, and read back. */
async function poseAndRead(): Promise<RefractSnapshot> {
  await loadBoard(h, FULL_SHAPE);
  await traceCells(h, PARTIAL);
  await h.advance(1);
  return h.snapshot();
}

it("reports the version and every documented field, with its documented type", async () => {
  const snapshot = await poseAndRead();
  await captureStill(h, "posed");

  assertEqual(snapshot.version, REFRACT_DEBUG_VERSION, "version");
  for (const field of SNAPSHOT_FIELDS) {
    assertHasProperty(snapshot, field, "every documented field is present");
  }

  assertEqual(snapshot.screen, "playing", "loadBoard moves to playing");
  assertContains(
    ["campaign", "cascade"],
    snapshot.mode,
    "mode is one of the two documented modes",
  );
  // `menuIndex` is live on every screen with a menu and rests at 0 on playing.
  assertEqual(snapshot.menuIndex, 0, "menuIndex rests at 0 on playing");

  for (const field of [
    "boardIndex",
    "unlockedCount",
    "selectIndex",
    "solvedCount",
    "tier",
    "simTime",
  ] as const) {
    assertEqual(typeof snapshot[field], "number", `typeof ${field}`);
  }
  assertEqual(
    Array.isArray(snapshot.solvedBoards),
    true,
    "solvedBoards is an array",
  );
  for (const entry of snapshot.solvedBoards) {
    assertEqual(typeof entry, "number", "solvedBoards holds numbers");
  }
  assertGreaterThanOrEqual(snapshot.simTime, 0, "simTime accumulates seconds");

  assertEqual(typeof snapshot.muted, "boolean", "typeof muted");
  assertEqual(typeof snapshot.solved, "boolean", "typeof solved");

  // The trace was released, so no trace is live.
  assertNull(snapshot.tracing, "tracing is null with no trace live");

  assertEqual(typeof snapshot.pointer, "object", "pointer is an object");
  assertEqual(typeof snapshot.pointer.x, "number", "typeof pointer.x");
  assertEqual(typeof snapshot.pointer.y, "number", "typeof pointer.y");
  assertEqual(
    snapshot.pointer.down,
    false,
    "the pointer reads up after the trace's release",
  );

  // One beams entry per channel present — all three here — and no other.
  assertDeepEqual(
    Object.keys(snapshot.beams).sort(),
    ["diamond", "square", "triangle"],
    "one beams entry per channel present",
  );
  for (const [channel, beam] of Object.entries(snapshot.beams)) {
    assertEqual(
      Array.isArray(beam.cells),
      true,
      `beams.${channel}.cells is an array`,
    );
    assertEqual(
      typeof beam.complete,
      "boolean",
      `typeof beams.${channel}.complete`,
    );
  }
});

it("derives x/y, spent, complete, and solved exactly as the specs state", async () => {
  const board = parseBoard(FULL_SHAPE);
  const snapshot = await poseAndRead();

  assertEqual(snapshot.board.cols, board.cols, "board.cols");
  assertEqual(snapshot.board.rows, board.rows, "board.rows");
  assertLength(
    snapshot.board.nodes,
    board.nodes.length,
    "one reported node per posed node",
  );

  for (const posed of board.nodes) {
    const at = `node (${posed.col}, ${posed.row})`;
    const reported = snapshot.board.nodes.find(
      (node) => node.col === posed.col && node.row === posed.row,
    );
    assertDefined(reported, at);
    if (reported === undefined) continue;

    assertEqual(reported.kind, posed.kind, `${at}: kind`);
    // A node's channel is null for a crystal.
    assertEqual(reported.channel, posed.channel, `${at}: channel`);

    // x and y come from the cell center formula in specs/board.md.
    const center = cellCenter(posed.col, posed.row, board.cols, board.rows);
    assertEqual(reported.x, center.x, `${at}: x on the cell center formula`);
    assertEqual(reported.y, center.y, `${at}: y on the cell center formula`);

    if (posed.kind === "crystal") {
      assertEqual(reported.charges, posed.charges, `${at}: charges`);
      // spent is derived from the crossings the drawn beams have begun on it:
      // the partial beam ends on this crystal, a crossing begun, charge spent.
      assertEqual(reported.spent, 1, `${at}: spent counts the crossing begun`);
    } else {
      // charges and spent are null for an emitter and for a lens.
      assertNull(reported.charges, `${at}: charges is null`);
      assertNull(reported.spent, `${at}: spent is null`);
    }
  }

  // complete is derived from R6 and R7, and solved from R9, held against the
  // case's own rules oracle over the drawn beams.
  assertDeepEqual(
    snapshot.beams.triangle?.cells,
    PARTIAL,
    "the partial beam's cells, in drawn order",
  );
  for (const channel of ["triangle", "square", "diamond"] as Channel[]) {
    assertEqual(
      snapshot.beams[channel]?.complete,
      beamComplete(board, DRAWN, channel),
      `beams.${channel}.complete per R6 and R7`,
    );
  }
  assertEqual(snapshot.solved, r9Solved(board, DRAWN), "solved per R9");
});
