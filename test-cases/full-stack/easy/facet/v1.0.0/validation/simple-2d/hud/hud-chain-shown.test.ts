// Facet — hud/hud-chain-shown: while a chain is resolving, the playing screen
// draws the CHAIN readout and the multiplier the state holds.
//
// specs/ui.md tables the readouts of the `playing` screen and gives this one a
// name of its own — `HUD_CHAIN_LABEL` (`CHAIN`) — against `state.multiplier`,
// "shown while `state.phase` is `resolving`". specs/rules.md makes every step
// of a chain worth more than the one before it, so the multiplier is the figure
// that tells a player what the step they are watching is paying; a build that
// never puts it on screen leaves the chain ladder invisible.
//
// THE ANTECEDENT IS THE FIRST HALF OF THE POINT, so the frame read below is
// read on a state that really is resolving. specs/rules.md has an accepted swap
// set `chainStep` to `1`, set `phase` to `resolving` and resolve step 1 on the
// spot, and hold that board for `STEP_SECONDS` (`0.25`) before the next step is
// read — so the single frame this drives, a sixty-fourth of a second, lands
// well inside step 1 and the snapshot taken beside it says so.
//
// THE SCENARIO IS A REAL SWAP, NOT A POSED PHASE. The surface has no operation
// that writes `phase`, and it should not: the readout is about what a player
// sees while a chain they started is running. Three rubies are posed across row
// 4 with an amethyst between two of them, and the swap that trades that
// amethyst out completes the run — the fixture proves that below, off the
// written board, before the board crosses into the build.
//
// WHAT THE FIGURE IS READ AGAINST. specs/ui.md says the readout shows
// `state.multiplier`, so the figure required here is the one the build's own
// snapshot reports at that moment rather than a number this check picked;
// whether that figure is the `min(chainStep, MAX_MULTIPLIER)` specs/rules.md
// derives is a different point. The score and the level score are posed to `0`
// and the level to `3` after the swap has scored, so the figures the readouts
// beside it are built from — `0`, `3`, and the level's `6000` target — cannot
// be mistaken for the `1` a chain at step 1 is worth.
//
// The copy is read through `frameText`, which hands back every string one frame
// put on screen, and `showsText` decides whether a string is among them across
// every shape specs/ui.md leaves open — one call per line, one per word, one
// per glyph, or a figure drawn beside its label in a single run.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue, fail } from "../assert";
import {
  maximalRuns,
  quietRowsWith,
  swapIsLegal,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import { HUD_CHAIN_LABEL } from "../constants";
import {
  captureStill,
  createHarness,
  loadBoard,
  showsText,
  swap,
  type Harness,
} from "../harness";

/** Three rubies across row 4, parted by the amethyst the swap trades out. */
const RUN_CELLS: PlacedToken[] = [
  { col: 3, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 5, row: 4, token: "M0" },
  { col: 6, row: 4, token: "R0" },
];

/** The swap that carries the ruby at (6,4) into the row and opens the chain. */
const SWAP_A: CellRef = { col: 5, row: 4 };
const SWAP_B: CellRef = { col: 6, row: 4 };

/** The level posed for the frame: its target is `6000`, which carries no `1`. */
const POSED_LEVEL = 3;

let h: Harness;

/** The frame showed `wanted`, or the failure names it beside what it drew. */
function requireCopy(drawn: readonly string[], wanted: string): void {
  if (!showsText(drawn, wanted)) {
    fail(`the resolving frame to show ${JSON.stringify(wanted)}`, drawn);
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shows the chain label and the multiplier while a chain resolves", async () => {
  const posed = quietRowsWith(RUN_CELLS);
  // The fixture's own guarantees, so anything that fails below is the build's:
  // the posed board carries no run of its own, R1 and R3 both accept the swap,
  // and the swap makes exactly the one run the scenario planted.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  assertLength(
    maximalRuns(swapped(posed, SWAP_A, SWAP_B)),
    1,
    "maximal runs the swap makes",
  );

  loadBoard(h, posed);
  const resolving = swap(h, SWAP_A, SWAP_B);

  // The antecedent: a chain really is running as the frame below is drawn.
  assertEqual(resolving.screen, "playing", "the screen the readouts sit on");
  assertEqual(resolving.phase, "resolving", "the phase the swap opened");
  assertEqual(resolving.chainStep, 1, "the chain step the swap opened");

  // The other figures on the frame, posed after the swap has scored so the
  // points it banked do not put a stray digit beside the multiplier.
  h.debug.setScore(0);
  h.debug.setLevelScore(0);
  h.debug.setLevel(POSED_LEVEL);

  // One frame — a sixty-fourth of a second, far inside the 0.25 s step — and
  // everything it put on screen. The still is that same frame.
  const drawn = await h.frameText();
  captureStill(h, "hud");
  assertEqual(h.snapshot().phase, "resolving", "the phase it was read at");

  requireCopy(drawn, HUD_CHAIN_LABEL);
  requireCopy(drawn, String(resolving.multiplier));
});
