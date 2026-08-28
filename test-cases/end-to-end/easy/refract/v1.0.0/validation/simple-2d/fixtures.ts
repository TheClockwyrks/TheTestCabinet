/**
 * fixtures.ts — small hand-built notation boards for validator scenarios.
 *
 * Every notation string uses the table in specs/board.md. Each fixture's
 * comment states what it poses; `legal` says whether validateBoard() accepts
 * it as a playable board (1..3 channels, exactly two emitters per channel),
 * and `solvable` says what the solver must report ('solved' / 'unsolvable').
 * A null `solvable` marks a fixture that is not a solver scenario.
 */

export interface Fixture {
  name: string;
  notation: string;
  /** What the fixture poses for a validator. */
  poses: string;
  /** validateBoard() returns no violations. */
  legal: boolean;
  /** Expected solver verdict; null when the fixture is not a solver scenario. */
  solvable: boolean | null;
}

/**
 * The minimal board: 2x1, one channel, its two emitters adjacent. One segment
 * completes the beam and solves the board — the smallest solve there is, and
 * the smallest board on which "solving ends the trace" can be exercised.
 */
export const MINIMAL_2X1 = "TT";

/**
 * A single-node 1x1 board holding one crystal. It parses (the notation is
 * well-formed and dimensions are in range) and pins the degenerate geometry:
 * cellCenter(0, 0, 1, 1) === (BOARD_CX, BOARD_CY). It is NOT a legal playable
 * board — it declares no channel (specs/board.md: a board declares 1 to 3
 * channels) — and validateBoard() must say so; nothing could ever spend the
 * crystal's charge, so the solver reports it unsolvable.
 */
export const SINGLE_1X1 = "1";

/**
 * 3x3 geometry board: corner and center cell-center spot checks
 * (cellX(0,3)=544, center (1,1)=(640,392), (2,2)=(736,488)). Solvable by the
 * forced diagonal T(0,0)-t(1,1)-T(2,2); the two diagonal segments sit in
 * different 2x2 blocks, so R4 permits both.
 */
export const GEO_3X3 = `
T..
.t.
..T
`;

/**
 * Full-size 7x6 geometry board (GRID_MAX_COLS x GRID_MAX_ROWS): centers span
 * x 352..928 and y 152..632 exactly as specs/board.md states. Solvable along
 * the lens diagonal T(0,0)..t(5,5) then across to T(6,5).
 */
export const GEO_7X6 = `
T......
.t.....
..t....
...t...
....t..
.....tT
`;

/**
 * R1 (adjacency): a 3x1 board whose two emitters are two cells apart with an
 * empty cell between. Poses (a) extending T(0,0) -> (2,0), nodes two columns
 * apart — refused R1; (b) extending T(0,0) -> (1,0), an empty cell holding no
 * node — refused R1 (a segment never spans an empty cell). Because no legal
 * segment exists at all, the board is unsolvable — a good adversarial check
 * that the build does not mark it solved.
 */
export const R1_NON_ADJACENT = "T.T";

/**
 * R2 (exclusion): triangle across the top, square across the bottom, a square
 * lens in the middle. Poses (a) triangle beam at T(0,0) extending to the
 * foreign lens s(1,1) — refused R2; (b) square beam [S(0,2), s(1,1)] extending
 * to the foreign lens t(1,0) — refused R2; (c) the same square beam extending
 * to the foreign emitter T(2,0) — refused R2. Solvable: triangle along the top
 * row, square S(0,2)-s(1,1)-S(2,2) on two diagonals of different blocks.
 */
export const R2_FOREIGN = `
TtT
.s.
S.S
`;

/**
 * R3 (segment exclusivity / redraw): after drawing T(0,0)-t(1,0), extending
 * from t(1,0) back to T(0,0) would redraw the same segment — refused R3
 * (poses the redraw distinctly from retracting, which removes the segment
 * instead). Solvable: T(0,0)-t(1,0)-T(2,0).
 */
export const R3_REDRAW = "TtT";

/**
 * R4 (diagonal exclusivity): a 2x2 board whose only routes are the two
 * diagonals of the single 2x2 block. Draw square S(1,0)-S(0,1) (one diagonal,
 * a complete square beam), then extend triangle T(0,0) -> T(1,1): the crossing
 * diagonal — refused R4, and cleanly (the segment is unused, both triangle
 * emitters are fresh, no foreign node is met). Each channel is solvable alone
 * but never both at once, so the whole board is unsolvable — the solver must
 * prove it.
 */
export const R4_CROSS_2X2 = `
TS
ST
`;

/**
 * R5 (emitter capacity): one channel, emitters stacked on the left, lenses on
 * the right. After drawing [T(0,0), t(1,0)] and resuming from the T(0,0) end
 * (reversal makes it the live end), extending T(0,0) -> t(1,1) would hang a
 * second segment on that emitter — refused R5; nothing else on the board
 * refuses it (the diagonal's block carries no diagonal yet). Solvable:
 * T(0,0)-t(1,0)-t(1,1)-T(0,1).
 */
export const R5_EMITTER = `
Tt
Tt
`;

/**
 * R5 (lens capacity): route T(0,0)-t(1,1)-t(0,1)-t(1,2), at which point lens
 * t(1,1) already carries two segments; extending t(1,2) -> t(1,1) is a fresh,
 * non-diagonal segment into a full lens — refused R5 alone. The trace then
 * finishes t(1,2)-T(2,2) and the board is solved, so the refusal is posable
 * mid-route on a solvable board.
 */
export const R5_LENS = `
T..
tt.
.tT
`;

/**
 * R5 (spent crystal): the crystal carries one charge. Triangle solves across
 * the top through it (spending the charge; the board is not yet solved, so the
 * trace machinery is still live), then square S(0,1) -> crystal (1,0) is a
 * move into a crystal whose charges are all spent — refused R5. The square
 * channel has no other route, so the board as a whole is unsolvable.
 */
export const R5_SPENT_CRYSTAL = `
T1T
S.S
`;

/**
 * Shared-node two-beam board: the crystal carries two charges and both
 * channels cross it once — triangle straight across the top, square by two
 * diagonals (different blocks) underneath. After both beams pass, two beams
 * run through one node: a press there begins no trace (specs/controls.md — a
 * node more than one beam passes through matches no row). Solvable, with the
 * crystal's charges exactly spent.
 */
export const SHARED_CRYSTAL = `
T2T
S.S
`;

/**
 * A beam crossing one crystal twice: the crystal carries two charges and the
 * lone triangle beam must enter and leave it twice (four distinct segments)
 * to spend both — T(0,0) into the crystal, out to t(0,2), around by t(1,2)
 * back into the crystal, out through t(1,0), t(2,1), ending T(3,0). Poses
 * repeated same-channel crossings of one crystal (R5 capacity as a budget,
 * R8 exact spending).
 */
export const CRYSTAL_TWICE = `
Tt.T
.2t.
tt..
`;

/**
 * A beam ending on a crystal: on this 3x1 board the beam [T(0,0), crystal]
 * has spent the crystal's only charge, yet the crystal is unsatisfied — a
 * crossing begun and not completed (R8) — and the board is unsolved. Extending
 * on to T(2,0) completes the crossing and solves the board.
 */
export const CRYSTAL_END = "T1T";

/**
 * R9 / solving-ends-the-trace: a snake with an essentially unique solution —
 * t(0,1) can only join T(0,0) and t(1,1), and t(2,1) only t(1,1) and T(3,2),
 * so the route T(0,0)-t(0,1)-t(1,1)-t(2,1)-T(3,2) is forced (up to direction).
 * The final segment is the move that makes R9 hold, so a validator can assert
 * the trace ends on that exact move and the release that follows changes
 * nothing.
 */
export const R9_UNIQUE = `
T...
ttt.
...T
`;

export const FIXTURES: readonly Fixture[] = [
  {
    name: "MINIMAL_2X1",
    notation: MINIMAL_2X1,
    poses:
      "smallest board; one segment completes and solves; solving ends the trace",
    legal: true,
    solvable: true,
  },
  {
    name: "SINGLE_1X1",
    notation: SINGLE_1X1,
    poses:
      "degenerate 1x1 geometry (center = BOARD_CX/BOARD_CY); parses but is not a legal playable board (no channel)",
    legal: false,
    solvable: false,
  },
  {
    name: "GEO_3X3",
    notation: GEO_3X3,
    poses:
      "3x3 cell-center geometry spot checks; two diagonals in distinct blocks",
    legal: true,
    solvable: true,
  },
  {
    name: "GEO_7X6",
    notation: GEO_7X6,
    poses: "full-size 7x6 geometry: centers span 352..928 x 152..632",
    legal: true,
    solvable: true,
  },
  {
    name: "R1_NON_ADJACENT",
    notation: R1_NON_ADJACENT,
    poses:
      "R1 refusals: non-adjacent target and empty-cell target; board unsolvable",
    legal: true,
    solvable: false,
  },
  {
    name: "R2_FOREIGN",
    notation: R2_FOREIGN,
    poses:
      "R2 refusals: foreign lens and foreign emitter; both channels solvable",
    legal: true,
    solvable: true,
  },
  {
    name: "R3_REDRAW",
    notation: R3_REDRAW,
    poses: "R3 refusal: redrawing the segment just drawn",
    legal: true,
    solvable: true,
  },
  {
    name: "R4_CROSS_2X2",
    notation: R4_CROSS_2X2,
    poses:
      "R4 refusal: crossing diagonals of one 2x2 block; jointly unsolvable",
    legal: true,
    solvable: false,
  },
  {
    name: "R5_EMITTER",
    notation: R5_EMITTER,
    poses: "R5 refusal: a second segment on an emitter; solvable",
    legal: true,
    solvable: true,
  },
  {
    name: "R5_LENS",
    notation: R5_LENS,
    poses: "R5 refusal: a third segment into a lens; solvable",
    legal: true,
    solvable: true,
  },
  {
    name: "R5_SPENT_CRYSTAL",
    notation: R5_SPENT_CRYSTAL,
    poses:
      "R5 refusal: entering a crystal whose charges are all spent; board unsolvable",
    legal: true,
    solvable: false,
  },
  {
    name: "SHARED_CRYSTAL",
    notation: SHARED_CRYSTAL,
    poses:
      "two beams through one node (press begins no trace); crystal exactly spent by two channels",
    legal: true,
    solvable: true,
  },
  {
    name: "CRYSTAL_TWICE",
    notation: CRYSTAL_TWICE,
    poses:
      "one beam crossing one crystal twice (four distinct segments, both charges spent)",
    legal: true,
    solvable: true,
  },
  {
    name: "CRYSTAL_END",
    notation: CRYSTAL_END,
    poses:
      "a beam ending on a crystal: charge spent, crossing incomplete, R8 unsatisfied",
    legal: true,
    solvable: true,
  },
  {
    name: "R9_UNIQUE",
    notation: R9_UNIQUE,
    poses: "essentially unique solution; the solving move ends the trace",
    legal: true,
    solvable: true,
  },
];
