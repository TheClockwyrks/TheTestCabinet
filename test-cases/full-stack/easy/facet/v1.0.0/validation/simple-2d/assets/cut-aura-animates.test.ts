// assets/cut-aura-animates — a cut stone standing on a settled board is never
// still.
//
// specs/assets.md, "Particle systems — particle-2d", produces four systems and
// gives the fourth to the cut stones: "The cut aura, a continuous system played
// at the cell of every `brilliant`, every `star`, and every `prism` standing on
// the board, for as long as that gem stands there. It runs on rather than firing
// once, so a cut stone is never still". specs/board.md states the same from the
// board's side — "A cut gem is never still ... so the three a chain earns are
// picked out by motion as well as by their treatment" — and adds the line that
// makes the control below the right one: "A gem's strain raises no such effect:
// damage is read off the stone itself." specs/assets.md's closing list refuses a
// build that "leaves a cut stone standing still".
//
// WHY THE STONE READ IS A BRILLIANT. A `brilliant` carries no produced sequence
// of its own: specs/assets.md gives the break sheets to the seven kinds and plays
// them when a chain step REMOVES a gem, and gives the idle turn to the `prism`
// alone. So a `brilliant` standing on a board where nothing is happening has
// exactly one thing that could be moving at it, and that is the fourth particle
// system. A prism would leave the two indistinguishable, which is why
// `assets/prism-turn-animates` reads the sequence there and this reads the aura
// here.
//
// WHAT THE PLAIN GEM BESIDE IT IS FOR. A plain gem of the same kind stands at
// another cell of the posed board, so a reviewer watching the replay sees the
// cut stone against a stone of the same art. Nothing is asserted of it:
// specs/board.md hands "the animation" to the build along with the rest of the
// presentation and nowhere requires a stone to stand still, so a build that
// gives every gem a slow glint is conformant and this point is not the place to
// say otherwise.
//
// WHY THE BOARD IS AT REST. The board carries no maximal run and no swap is made,
// so `phase` never leaves `idle` and nothing on it is falling, clearing or
// settling. Both cells are read through the box `readPatch` cuts, `PATCH_HALF`
// (20) logical units either side of the cell center, which sits inside `GEM_R`
// (30) and well inside half of `CELL_PITCH` (36), so neither cell's reading
// reaches into a neighbor's.
//
// WHAT IS NOT READ. What the aura looks like, how many particles it throws, how
// far the cell's pixels travel, how fast it runs, or whether two cut stones on
// one board run it separately. specs/assets.md leaves all of that to the build
// and says only that the effect is continuous, quiet, and at every cut stone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { GEM_KINDS } from "../constants";
import {
  maximalRuns,
  quietRowsWith,
  tokenOf,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  patchDistance,
  type Harness,
  type Patch,
} from "../harness";

/**
 * The kind both stones carry.
 *
 * The same kind for both, so the two cells differ by the CUT alone and the
 * control is a stone of the same art with no aura at it. Nothing about the point
 * depends on which kind it is.
 */
const KIND = GEM_KINDS[0];

/** The cut stone the aura is read at, and the plain stone standing beside it. */
const CUT: CellRef = { col: 3, row: 3 };
const PLAIN: CellRef = { col: 5, row: 5 };

/** The two cells written over the run-free filler. */
const CELLS: readonly PlacedToken[] = [
  { col: CUT.col, row: CUT.row, token: tokenOf(KIND, 0, "brilliant") },
  { col: PLAIN.col, row: PLAIN.row, token: tokenOf(KIND, 0) },
];

/**
 * How the cut stone's cell is watched: how many instants are sampled, and how
 * many frames of the suite's 64 Hz clock separate two of them.
 *
 * Four frames is a sixteenth of a second, and seventeen samples span one whole
 * second of game time. A system that "runs on rather than firing once" has run on
 * through all of it, and a build that showed the same picture at every one of
 * those instants has left the stone standing still.
 */
const SAMPLES = 17;
const FRAMES_BETWEEN = 4;

/** How far the widest pair of samples of one cell stands apart. */
function spread(samples: readonly Patch[]): number {
  let widest = 0;
  for (let a = 0; a < samples.length; a += 1) {
    for (let b = a + 1; b < samples.length; b += 1) {
      widest = Math.max(widest, patchDistance(samples[a], samples[b]));
    }
  }
  return widest;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps a cut stone moving on a settled board", async () => {
  const posed = quietRowsWith(CELLS);

  // The scenario, established before the build is asked anything: no run stands
  // on the board, so it is a board that resolves nothing and both stones simply
  // stand where they were written.
  assertEqual(maximalRuns(posed).length, 0, "maximal runs on the posed board");

  const settled = loadBoard(h, posed);
  assertEqual(
    settled.phase,
    "idle",
    "the phase a run-free posed board rests in",
  );

  const samples = await captureReplay(h, "aura", async () => {
    // One frame first, so the canvas is holding the board that was posed rather
    // than whatever the frame before the pose left on it.
    await h.advance(1);
    const cut: Patch[] = [];
    for (let index = 0; index < SAMPLES; index += 1) {
      if (index > 0) await h.advance(FRAMES_BETWEEN);
      cut.push(h.patch(CUT.col, CUT.row));
    }
    return { cut };
  });

  // Nothing moved the board while the cell was watched.
  assertEqual(
    h.snapshot().phase,
    "idle",
    "the phase after the cell was watched",
  );

  assertGreaterThan(
    spread(samples.cut),
    0,
    `how far the brilliant ${KIND} at (${CUT.col},${CUT.row}) reads from ` +
      `itself across the sweep`,
  );
});
