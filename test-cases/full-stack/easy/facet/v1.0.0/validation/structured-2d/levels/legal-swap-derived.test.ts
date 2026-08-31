// levels/legal-swap-derived — `legalSwap` answers to the board that is standing,
// and it answers with R1 and R3.
//
// specs/instrumentation.md lists `legalSwap` among the snapshot's derived fields
// and says what derives it: "R1 and R3 in `specs/rules.md`, over the board as it
// stands". specs/rules.md says the same thing from the other side: "A legal swap
// is a pair of orthogonally adjacent cells whose exchange R1 and R3 both accept."
//
// THREE BOARDS, BECAUSE ONE READING PROVES NOTHING. A field wired to a constant
// `true` is right about every ordinary board; a field worked out once when a
// board was dealt and never again is right until the board changes underneath it.
// So the flag is read on a board carrying legal swaps, on a board carrying none,
// and then on that same dead board after ONE cell of it is rewritten — which is
// what "as it stands" means and is the reading a stale field cannot get right.
//
// AND FOUR MORE, BECAUSE A HALF-BLIND SEARCH GETS ALL THREE OF THOSE RIGHT. R1
// takes a pair "by `1` in column and `0` in row, or by `0` in column and `1` in
// row", so a search that answers for the whole board has to reach every cell's
// neighbor on each side of it and has to notice a run made by either of the two
// gems the exchange moves. A search that only ever pairs a cell with the one to
// its right, or only with the one below it, or that only asks what the gem it
// carried forward landed in and never what the gem coming the other way landed
// in, still says true on an ordinary crowded board and false on a dead one: the
// boards above cannot tell it apart from a whole one. So the flag is read on four
// more boards, each carrying EXACTLY ONE legal swap, and between them the one
// swap runs rightward, leftward, downward and upward. Each is written over the
// dead board, whose own legal swaps number none, so the exchange the fixture
// plants is the only one there is and a search that cannot look that way has to
// report false where the specification says true.
//
// WHAT THE CHECK COMPARES IT WITH. This project carries its own search over the
// notation, `legalSwapExists`, which is R1 and R3 written out and nothing else,
// and every board below is put to that search before the build is asked. And
// because a flag agreeing with a search is still only two opinions, the swap the
// live board is said to carry is then actually requested: the game's own
// acceptance path takes it, which is what makes "legal" mean what the field
// claims.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  areAdjacent,
  deadBoard,
  ESCAPE_SWAP,
  legalSwapExists,
  legalSwaps,
  maximalRuns,
  quietRowsWithEscape,
  swapIsLegal,
  swapped,
  withCells,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  requestSwap,
  type Harness,
} from "../harness";

/**
 * One prism written into the corner of the dead board.
 *
 * The smallest edit that gives a board a legal swap: R3 accepts an exchange "when
 * at least one of the two cells holds a `prism`", so the moment this cell exists
 * every one of its orthogonal neighbors is a legal partner for it, and no other
 * cell of the board has moved.
 */
const PRISM: readonly PlacedToken[] = [{ col: 0, row: 0, token: "X0" }];

/**
 * A board carrying exactly one legal swap, and the way that swap runs.
 *
 * `cells` is written over {@link deadBoard}, which carries none of its own, so
 * the exchange named here is the only legal swap on the board. `from` holds the
 * gem the exchange carries into the run and `to` is where it arrives: the run the
 * exchange makes reaches `to` and does not reach `from`, so a search that only
 * ever asks what happened at one end of a pair is looking at the wrong end here
 * for two of the four.
 *
 * The three cells of each fixture are `jade`, a kind the dead board holds
 * nowhere, so the run the exchange makes is made of the fixture's own cells and
 * of nothing the filler contributed.
 */
interface OneSwapBoard {
  /** The way the carried gem travels, which is what the fixture is named for. */
  readonly direction: string;
  /** The cells written over the dead board. */
  readonly cells: readonly PlacedToken[];
  /** The cell the carried gem leaves. */
  readonly from: CellRef;
  /** The cell it arrives at, which lies in the run the exchange makes. */
  readonly to: CellRef;
}

/**
 * One board per direction R1 reaches in.
 *
 * Each writes a `jade` three with its middle or its end missing, so the board
 * carries a pair and a single and no run at all, and the one exchange that joins
 * them carries a gem the one cell the fixture is named for. The claims are not
 * taken on trust: {@link oneSwapBoard} decides every one of them against this
 * project's own predicates before the board is posed.
 */
const ONE_SWAP_BOARDS: readonly OneSwapBoard[] = [
  {
    direction: "rightward",
    cells: [
      { col: 2, row: 2, token: "J0" },
      { col: 4, row: 2, token: "J0" },
      { col: 5, row: 2, token: "J0" },
    ],
    from: { col: 2, row: 2 },
    to: { col: 3, row: 2 },
  },
  {
    direction: "leftward",
    cells: [
      { col: 2, row: 2, token: "J0" },
      { col: 3, row: 2, token: "J0" },
      { col: 5, row: 2, token: "J0" },
    ],
    from: { col: 5, row: 2 },
    to: { col: 4, row: 2 },
  },
  {
    direction: "downward",
    cells: [
      { col: 2, row: 2, token: "J0" },
      { col: 2, row: 4, token: "J0" },
      { col: 2, row: 5, token: "J0" },
    ],
    from: { col: 2, row: 2 },
    to: { col: 2, row: 3 },
  },
  {
    direction: "upward",
    cells: [
      { col: 2, row: 2, token: "J0" },
      { col: 2, row: 3, token: "J0" },
      { col: 2, row: 5, token: "J0" },
    ],
    from: { col: 2, row: 5 },
    to: { col: 2, row: 4 },
  },
];

/** One cell written as the failures below name it. */
function cellKey(cell: CellRef): string {
  return `(${cell.col},${cell.row})`;
}

/**
 * A pair of cells written in reading order, so one pair has one name however it
 * was reached.
 */
function pairKey(a: CellRef, b: CellRef): string {
  const ordered = [a, b].sort(
    (first, second) => first.row - second.row || first.col - second.col,
  );
  return `${cellKey(ordered[0])}-${cellKey(ordered[1])}`;
}

/**
 * The written board a fixture poses, proved to be the board it claims to be.
 *
 * Every property the fixture is named for is decided here, off the written board,
 * by the same R1, R3 and R4 predicates the rest of the suite reads the rules
 * through: that the board rests with no run, that the pair is orthogonally
 * adjacent, that the exchange is legal, that it is the ONLY legal swap on the
 * board, and that the run it makes reaches the cell the carried gem arrives at
 * and not the one it left. A fixture that stopped being any of those fails as the
 * fixture fault it is, rather than traveling into the build and coming back as a
 * verdict about it.
 */
function oneSwapBoard(fixture: OneSwapBoard): string[] {
  const { direction, cells, from, to } = fixture;
  const rows = withCells(deadBoard(), cells);
  assertEqual(
    maximalRuns(rows).length,
    0,
    `${direction}: maximal runs on the posed board`,
  );
  assertEqual(
    areAdjacent(from, to),
    true,
    `${direction}: whether R1 takes the pair`,
  );
  assertEqual(
    swapIsLegal(rows, from, to),
    true,
    `${direction}: whether R1 and R3 accept the exchange`,
  );
  assertDeepEqual(
    legalSwaps(rows).map((pair) => pairKey(pair.a, pair.b)),
    [pairKey(from, to)],
    `${direction}: every legal swap on the board`,
  );
  const made = maximalRuns(swapped(rows, from, to))
    .flatMap((run) => run.cells)
    .map(cellKey);
  assertEqual(
    made.includes(cellKey(to)),
    true,
    `${direction}: whether the run the exchange makes reaches ${cellKey(to)}, where the carried gem arrives`,
  );
  assertEqual(
    made.includes(cellKey(from)),
    false,
    `${direction}: whether that run also reaches ${cellKey(from)}, which the carried gem left`,
  );
  return rows;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports whether a legal swap stands on the board it is asked about", async () => {
  // A board that carries legal swaps. The flag must say so.
  const alive = quietRowsWithEscape([]);
  assertEqual(
    legalSwapExists(alive),
    true,
    "R1 and R3 find an exchange on the live board",
  );
  const posed = loadBoard(h, alive);
  assertEqual(posed.legalSwap, true, "legalSwap on a board carrying swaps");

  // And what the flag calls legal, the game's own acceptance path takes: the
  // exchange R1 and R3 accept is requested and is set in motion rather than
  // refused. specs/rules.md puts an accepted swap into `swapping` at the request
  // itself, its first chain step resolving SWAP_SECONDS later, so the request's
  // own reading is what says the exchange was taken.
  const accepted = requestSwap(h, ESCAPE_SWAP.a, ESCAPE_SWAP.b);
  assertEqual(
    accepted.phase,
    "swapping",
    "the phase after requesting the swap the flag reported",
  );

  // Four boards whose only legal swap runs one way each. The flag has to find the
  // one exchange on every one of them, so a search that reaches in fewer
  // directions than R1 does answers at least one of the four wrongly.
  for (const fixture of ONE_SWAP_BOARDS) {
    const single = loadBoard(h, oneSwapBoard(fixture));
    assertEqual(
      single.legalSwap,
      true,
      `legalSwap on the board whose only legal swap is ${fixture.direction}`,
    );
  }

  // A board no exchange of adjacent cells makes a run on and no prism sits on:
  // R3 refuses every swap R1 would allow, so nothing on it is legal.
  const dead = deadBoard();
  assertEqual(
    legalSwapExists(dead),
    false,
    "R1 and R3 find no exchange on the dead board",
  );
  const stuck = loadBoard(h, dead);
  assertEqual(stuck.legalSwap, false, "legalSwap on a board carrying none");
  await h.advance(1);
  captureStill(h, "dead");

  // One cell of that same board is then rewritten, and nothing else. The flag
  // must follow the board it is asked about rather than the board it was dealt.
  const revived = withCells(dead, PRISM);
  assertEqual(
    legalSwapExists(revived),
    true,
    "R1 and R3 find an exchange once the prism is written",
  );
  for (const { col, row, token } of PRISM) {
    h.debug.setGem(col, row, token);
  }
  assertEqual(
    h.snapshot().legalSwap,
    true,
    "legalSwap after one cell of the dead board was rewritten",
  );
});
