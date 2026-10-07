// Facet — hud/hud-chain-shown: while a chain is resolving, the playing screen
// draws the CHAIN readout and the multiplier the state holds.
//
// specs/ui.md tables the readouts of the `playing` screen and gives this one a
// name of its own — `HUD_CHAIN_LABEL` (`CHAIN`) — against `state.multiplier`,
// "shown while `state.phase` is `resolving`". specs/rules.md makes every step of
// a chain worth more than the one before it, so the multiplier is the figure
// that tells a player what the step they are watching is paying; a build that
// never puts it on screen leaves the chain ladder invisible.
//
// THE ANTECEDENT IS THE FIRST HALF OF THE POINT, so the frame read below is read
// on a state that really is resolving — and reaching that state takes driving,
// not merely asking. specs/rules.md has an accepted swap exchange the two cells
// and enter `swapping` with `chainStep` at `0`, and step 1 does not resolve
// until `SWAP_SECONDS` (`0.18`) of game time has passed; only then does `phase`
// become `resolving`. `swapAndStep` is the drive sized for exactly that in
// `constants.ts`: 14 frames, `0.21875` s, which carries `swapTimer` past
// `SWAP_SECONDS` whether the build compares `>=` or `>` and leaves the game
// `0.03875` s into step 1's hold — far short of the `0.3` s that is the shortest
// hold any step can have, so exactly one step has resolved and the frame drawn
// below lands well inside it.
//
// THE SCENARIO IS A REAL SWAP, NOT A POSED PHASE. The surface has no operation
// that writes `phase`, and it should not: the readout is about what a player
// sees while a chain they started is running. Three rubies are posed across row
// 4 with an amethyst between two of them, and the swap that trades that amethyst
// out completes the run — the fixture proves that below, off the written board,
// before the board crosses into the build.
//
// WHAT THE FIGURE IS READ AGAINST. specs/ui.md says the readout shows
// `state.multiplier`, so the figure required here is the one the build's own
// snapshot reports at that moment rather than a number this check picked;
// whether that figure is the `min(chainStep, MAX_MULTIPLIER)` specs/rules.md
// derives is `scoring/score-multiplier`'s point. The score and the level score
// are posed to `0` and the level to `3` after the step has scored, so the
// figures the readouts beside it are built from — `0`, `3`, and the level's
// `6000` target — cannot be mistaken for the `1` a chain at step 1 is worth.
//
// The copy is read through `frameText`, which hands back a frame's draw calls
// and the page's own rendered DOM text alike, because specs/assets.md has an
// engineless build draw its chrome "in code (canvas or DOM)" and this point is
// not about which of the two it chose. `frameShows` then decides whether a
// string is on screen — the calls through the shared harness's
// `drewTextAnywhere`, the document by the same reading — across every shape
// specs/ui.md leaves open: one call per line, one per word, one per glyph, or a
// figure drawn beside its label in a single run.

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
  frameShows,
  loadBoard,
  shownText,
  swapAndStep,
  type FrameText,
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

/** The frame showed `wanted`, or the failure names it beside what it showed. */
function requireCopy(frame: FrameText, wanted: string): void {
  if (!frameShows(frame, wanted)) {
    fail(
      `the resolving frame to show ${JSON.stringify(wanted)}`,
      shownText(frame),
    );
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
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

  await loadBoard(h, posed);
  const resolving = await swapAndStep(h, SWAP_A, SWAP_B);

  // The antecedent: the swap animation is over and a chain really is running as
  // the frame below is drawn.
  assertEqual(resolving.screen, "playing", "the screen the readouts sit on");
  assertEqual(resolving.phase, "resolving", "the phase the swap opened");
  assertEqual(resolving.chainStep, 1, "the chain step the swap opened");

  // The other figures on the frame, posed after the step has scored so the
  // points it banked do not put a stray digit beside the multiplier.
  await h.debug.setScore(0);
  await h.debug.setLevelScore(0);
  await h.debug.setLevel(POSED_LEVEL);

  // One frame — a sixty-fourth of a second, far inside the step's own hold —
  // and everything it put on screen. The still is that same frame.
  const frame = await h.frameText();
  await captureStill(h, "hud");
  assertEqual(
    (await h.snapshot()).phase,
    "resolving",
    "the phase it was read at",
  );

  requireCopy(frame, HUD_CHAIN_LABEL);
  requireCopy(frame, String(resolving.multiplier));
});
