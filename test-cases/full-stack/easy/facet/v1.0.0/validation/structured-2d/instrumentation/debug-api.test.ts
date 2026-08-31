// Facet — instrumentation/debug-api: the build returned a debug and automation
// surface that is WHOLE, that reports `FACET_DEBUG_VERSION` in both the places
// the specification puts it, and whose `snapshot` reports the documented shape
// off a board that is really in play.
//
// WHY THIS IS A POINT AT ALL, AND WHY IT IS THIS SHAPE. specs/instrumentation.md
// makes the surface a deliverable: "the game instance's `initialize` returns the
// finished surface. The engine holds it and returns it from `engine.debug`, and
// it is reached that way alone". Every operation, the version, and the snapshot
// shape are the build's. Every other automated point in this project reaches the
// game through that surface, so when it is missing or partial they all fail
// together; this is the one that names the fault plainly. The harness reports it
// as `surfaceFault` rather than by throwing so it lands here rather than in some
// unrelated check's setup.
//
// WHAT REFLECTION CAN AND CANNOT SAY. `probe` answers a `typeof` and nothing
// more, so it can say an operation is a function and can say nothing at all
// about a VALUE. specs/instrumentation.md fixes the version in two independent
// places — "The surface carries `version` (`FACET_DEBUG_VERSION`, `1`), a plain
// number" and the snapshot's own `version` field — so each is read by the reader
// that belongs to it and both are held to the same number. A build that put the
// version in one place and not the other conforms in neither.
//
// WHAT IT DELIBERATELY DOES NOT DECIDE. What each operation DOES: `loadBoard`
// posing the written board is `board/load-board`, `requestSwap` going through
// R1-R3 is the `moves` points, and the derived fields of the snapshot —
// `levelTarget`, `multiplier`, `legalSwap` and a cell's center — each have a
// point of their own. This one decides that the operations are THERE, that the
// version is right, and that the snapshot carries every documented field, with
// the documented type, over a board that is really in play rather than a shape
// filled with resting values.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertContains,
  assertEqual,
  assertHasProperty,
  assertLength,
  assertTrue,
} from "../assert";
import { quietRowsWith } from "../board";
import {
  CUTS,
  FACET_DEBUG_VERSION,
  GEM_KINDS,
  GRID_COLS,
  GRID_ROWS,
  MAX_STRAIN,
  SCREENS,
} from "../constants";
import {
  captureStill,
  createHarness,
  failSurface,
  loadBoard,
  type Harness,
} from "../harness";
import { REQUIRED_OPS } from "../surface";

let h: Harness;

/**
 * The board the snapshot is read off: every kind the filler already carries,
 * plus one cell at each of the three cuts a gem can be dealt into beyond
 * `plain` and one at each strain above `0`.
 *
 * It is posed so the per-cell assertions below run over the whole documented
 * range of `kind`, `cut` and `strain` rather than over sixty-four identical
 * plain gems — and, in particular, so a `prism` is on the board, since the
 * snapshot's rule that a prism's `kind` is `null` is empty without one. The five
 * cells are scattered, so the filler still carries no maximal run under R4 and
 * the posed board simply rests.
 */
const INSPECTED = quietRowsWith([
  { col: 0, row: 0, token: "X0" },
  { col: 7, row: 0, token: "X3" },
  { col: 4, row: 1, token: "J3" },
  { col: 2, row: 2, token: "R1b" },
  { col: 5, row: 5, token: "S2s" },
]);

/** Every snapshot field specs/instrumentation.md types as a plain number. */
const NUMBERS = [
  "menuIndex",
  "score",
  "level",
  "levelScore",
  "levelTarget",
  "chainStep",
  "multiplier",
  "stepTimer",
  "lastCleared",
  "lastPoints",
  "rngState",
  "simTime",
] as const;

/**
 * Fail with the harness's own account of what is missing, paired with what the
 * build owes.
 *
 * `assertNull(h.surfaceFault)` would render as "Expected: null" over the reason,
 * throwing away the half of the pair that says what the build owes. This is the
 * point whose whole job is to state that plainly.
 */
function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries every operation the specification names, as functions", async () => {
  // The whole operation list of specs/instrumentation.md. The clock is not on
  // it: under this engine the frame loop, the keyboard, the pointer and the
  // overlay "belong to the structured-2d engine" and the surface "carries no
  // operation for any of them". Reflected rather than called, so a build is held
  // to having the operation rather than to what one call of it happened to do.
  requireSurface();

  const probed = await h.probe(REQUIRED_OPS);
  for (const op of REQUIRED_OPS) {
    assertEqual(probed[op], "function", `typeof engine.debug.${op}`);
  }
});

it("reports FACET_DEBUG_VERSION on the surface and in the snapshot", async () => {
  // Two readers, because the specification fixes two places. `debugVersion`
  // reads the member off the surface itself; the snapshot's `version` is read
  // through the operation. Both are the same plain number, `1`.
  requireSurface();

  assertEqual(
    await h.debugVersion(),
    FACET_DEBUG_VERSION,
    "engine.debug.version",
  );
  assertEqual(
    h.snapshot().version,
    FACET_DEBUG_VERSION,
    "the version the snapshot reports",
  );
});

it("reports the whole documented snapshot shape, off a board in play", async () => {
  requireSurface();
  loadBoard(h, INSPECTED);
  // One frame, so the still below is of the board the reading was taken over
  // rather than of whatever the page last drew.
  await h.advance(1);
  captureStill(h, "state");

  const s = h.snapshot();

  // The scalars, field by field, at the type the specification gives each.
  assertEqual(typeof s.version, "number", "snapshot.version");
  assertContains(SCREENS, s.screen, "snapshot.screen");
  assertContains(["idle", "resolving"], s.phase, "snapshot.phase");
  assertEqual(typeof s.legalSwap, "boolean", "snapshot.legalSwap");
  assertEqual(typeof s.muted, "boolean", "snapshot.muted");
  for (const field of NUMBERS) {
    assertEqual(typeof s[field], "number", `snapshot.${field}`);
  }

  // The containers. `selection` and `refusal` are the two fields that may be
  // `null`, so what is asked of them here is that they are REPORTED at all —
  // specs/instrumentation.md's "every field is present on every screen" — and
  // their resting value is `instrumentation/snapshot-resting-values`.
  assertEqual(typeof s.cursor.col, "number", "snapshot.cursor.col");
  assertEqual(typeof s.cursor.row, "number", "snapshot.cursor.row");
  assertHasProperty(s, "selection", "the snapshot");
  assertHasProperty(s, "refusal", "the snapshot");
  assertEqual(typeof s.pointer.x, "number", "snapshot.pointer.x");
  assertEqual(typeof s.pointer.y, "number", "snapshot.pointer.y");
  assertEqual(typeof s.pointer.down, "boolean", "snapshot.pointer.down");

  // A board is really in play, so these are live values rather than the resting
  // ones a stub would answer with.
  assertEqual(s.screen, "playing", "the screen a posed board is read on");
  assertEqual(s.board.cols, GRID_COLS, "snapshot.board.cols");
  assertEqual(s.board.rows, GRID_ROWS, "snapshot.board.rows");
  assertLength(s.board.cells, GRID_COLS * GRID_ROWS, "snapshot.board.cells");

  // "`cells` lists every cell of the board in reading order from the top-left
  // cell to the bottom-right", so the cell at index `i` is the one at column
  // `i % cols` of row `floor(i / cols)`. A build that listed its board down the
  // columns reports every cell and still breaks every reader that walks the
  // list.
  s.board.cells.forEach((cell, index) => {
    assertEqual(cell.col, index % GRID_COLS, `the col of cells[${index}]`);
    assertEqual(
      cell.row,
      Math.floor(index / GRID_COLS),
      `the row of cells[${index}]`,
    );
  });

  for (const cell of s.board.cells) {
    const at = `the cell at (${cell.col},${cell.row})`;
    assertEqual(typeof cell.x, "number", `the x of ${at}`);
    assertEqual(typeof cell.y, "number", `the y of ${at}`);
    assertContains(CUTS, cell.cut, `the cut of ${at}`);
    assertTrue(Number.isInteger(cell.strain), `a whole strain at ${at}`);
    assertBetween(cell.strain, 0, MAX_STRAIN, `the strain of ${at}`);
    // "a cell's `kind` is `null` for a `prism`" — and, being the other half of
    // the same sentence, a kind for everything else.
    if (cell.cut === "prism") {
      assertEqual(cell.kind, null, `the kind of ${at}, a prism`);
    } else {
      assertContains(GEM_KINDS, cell.kind, `the kind of ${at}`);
    }
  }

  // The rule above says nothing at all unless a prism was on the board to say it
  // about, and one was posed, so its absence here is a reading this check cannot
  // make rather than a build that passed.
  assertTrue(
    s.board.cells.some((cell) => cell.cut === "prism"),
    "a prism among the reported cells, which the board was posed with",
  );
});
