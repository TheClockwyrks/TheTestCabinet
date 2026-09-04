// Facet — instrumentation/debug-api-snapshot-shape: `snapshot` reports the
// documented shape, off a board that is really in play.
//
// specs/instrumentation.md fixes the shape outright and adds "The shape is
// fixed, and every field is present on every screen." So every field is read at
// the type the specification gives it, and the reading is taken over a POSED
// BOARD rather than at rest, so what is read is live values rather than the
// resting ones a stub would answer with.
//
// WHAT IS READ, AND WHAT IS LEFT TO OTHERS. The four fields that may be `null`
// — `selection`, `offer`, `refusal` and `armedTarget` — are asked only to be
// REPORTED at all; their resting values are
// `instrumentation/snapshot-resting-values`. `targets` is asked to be a list;
// WHICH rectangles it holds is the `targets` category's.
//
// WHY THIS IS A POINT AT ALL. Under an engine the surface is handed back from
// `initialize` and the engine holds it. Nothing holds it here: an engineless
// build gets no runtime, so the global it is installed on, every operation on
// it, the version, and the snapshot shape are all deliverables of the build
// (specs/instrumentation.md). Every other automated point in this project
// reaches the game through it, so when the surface is missing or partial they
// all fail together; these three are the ones that name the fault plainly. The
// harness reports it as `surfaceFault` rather than by throwing so it lands here
// rather than in some unrelated check's setup.
//
// WHAT THE THREE DELIBERATELY DO NOT DECIDE. What each operation DOES:
// `loadBoard` writing the board it was given is `board/load-board-carries-the-
// tokens`, `requestSwap` going through R1-R3 is the `moves` points, and the
// derived fields of the snapshot — `levelTarget`, `multiplier`, `legalSwap` and
// a cell's center — each have a point of their own.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertContains,
  assertEqual,
  assertGreaterThanOrEqual,
  assertHasProperty,
  assertLength,
  assertTrue,
} from "../assert";
import { quietRowsWith } from "../board";
import {
  CUTS,
  GEM_KINDS,
  GRID_COLS,
  GRID_ROWS,
  MAX_STRAIN,
  POINTER_DEVICES,
  SCREENS,
} from "../constants";
import {
  captureStill,
  createHarness,
  failSurface,
  loadBoard,
  type Harness,
} from "../harness";

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

/**
 * Every snapshot field specs/instrumentation.md types as a plain number.
 *
 * The whole list rather than a sample, because the shape is what this point
 * decides: a build that reports nineteen of the twenty is caught here and
 * nowhere else, and the three timing figures in particular (`swapTimer`,
 * `stepTimer`, `stepHold`) are the ones a reader of the chain reaches for.
 */
const NUMBERS = [
  "menuIndex",
  "score",
  "level",
  "levelScore",
  "levelTarget",
  "chainStep",
  "multiplier",
  "swapTimer",
  "stepTimer",
  "stepHold",
  "lastCleared",
  "lastPoints",
  "lastWaves",
  "lastFall",
  "moveScore",
  "bestMove",
  "bestChain",
  "rngState",
  "simTime",
] as const;

/**
 * The three values `phase` may hold, from specs/rules.md: "`phase` is `idle`,
 * `swapping`, or `resolving`."
 *
 * Membership rather than a figure. The board this reading is taken over is posed
 * and at rest, so a conformant build reports `idle` here; what is decided is that
 * the field carries one of the three the specification names rather than a
 * spelling of its own.
 */
const PHASES = ["idle", "swapping", "resolving"] as const;

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
  assertContains(PHASES, s.phase, "snapshot.phase");
  assertEqual(typeof s.legalSwap, "boolean", "snapshot.legalSwap");
  assertEqual(typeof s.muted, "boolean", "snapshot.muted");
  for (const field of NUMBERS) {
    assertEqual(typeof s[field], "number", `snapshot.${field}`);
  }

  // The containers. `selection`, `offer`, `refusal` and `armedTarget` are the
  // four fields that may be `null`, so what is asked of them here is that they
  // are REPORTED at all — specs/instrumentation.md's "every field is present on
  // every screen" — and their resting value is
  // `instrumentation/snapshot-resting-values`.
  assertHasProperty(s, "selection", "the snapshot");
  assertHasProperty(s, "offer", "the snapshot");
  assertHasProperty(s, "refusal", "the snapshot");
  assertHasProperty(s, "armedTarget", "the snapshot");
  assertEqual(typeof s.pointer.x, "number", "snapshot.pointer.x");
  assertEqual(typeof s.pointer.y, "number", "snapshot.pointer.y");
  assertEqual(typeof s.pointer.down, "boolean", "snapshot.pointer.down");
  // The device the pointer was last driven by is part of the reported pointer,
  // and it is one of the three specs/controls.md names rather than a string of
  // the build's own.
  assertContains(POINTER_DEVICES, s.pointer.device, "snapshot.pointer.device");

  // `targets` is an array on every screen. WHICH rectangles it holds, and that
  // they satisfy specs/controls.md's four requirements, is the `targets`
  // category's; what this point decides is that the field is present and is the
  // list the shape says it is, so a reader that walks it never meets an
  // `undefined`.
  assertTrue(Array.isArray(s.targets), "snapshot.targets is a list");

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
    // R9 gives every gem a `fell`, "how far it traveled to reach the cell it now
    // holds, as a whole number of rows", so the field is reported on every cell
    // rather than on the ones a step moved. What figure a POSED board's gems
    // carry is `board/load-board-carries-the-tokens`'s point and what a settled
    // one's carry is
    // `settling`'s, so all that is read here is the type and the floor a whole
    // number of rows traveled cannot fall below.
    assertTrue(Number.isInteger(cell.fell), `a whole fell at ${at}`);
    assertGreaterThanOrEqual(cell.fell, 0, `the fell of ${at}`);
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
