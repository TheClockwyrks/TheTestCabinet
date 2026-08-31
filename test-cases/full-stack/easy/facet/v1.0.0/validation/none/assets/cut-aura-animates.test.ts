// assets/cut-aura-animates — a cut stone standing on a settled board is never
// still, and a plain stone beside it is.
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
// WHY A PLAIN GEM IS THE CONTROL. A background that animates under the whole
// field would move the pixels in every cell alike, and a reading of one cell
// could not tell that from an aura. So a plain gem of the SAME kind stands at
// another cell of the same board and is watched over the same frames: the
// brilliant's cell has to MOVE, by more than PATCH_DISTINCT_MIN, and the plain
// cell has to HOLD STILL, within PATCH_SAME_MAX. A build whose whole board
// shimmers fails the control rather than passing the point.
//
// WHY THE BOARD IS AT REST. The board carries no maximal run and no swap is made,
// so `phase` never leaves `idle` and nothing on it is falling, clearing or
// settling. Both cells are read through the box `readPatch` cuts, `PATCH_HALF`
// (20) logical units either side of the cell center, which sits inside `GEM_R`
// (30) and well inside half of `CELL_PITCH` (36), so neither cell's reading
// reaches into a neighbor's.
//
// WHAT IS NOT READ. What the aura looks like, how many particles it throws, how
// fast it runs, or whether two cut stones on one board run it separately.
// specs/assets.md leaves all of that to the build and says only that the effect
// is continuous, quiet, and at every cut stone.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { GEM_KINDS, PATCH_DISTINCT_MIN, PATCH_SAME_MAX } from "../constants";
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

/** The cut stone the aura is read at, and the plain stone that is the control. */
const CUT: CellRef = { col: 3, row: 3 };
const PLAIN: CellRef = { col: 5, row: 5 };

/** The two cells written over the run-free filler. */
const CELLS: readonly PlacedToken[] = [
  { col: CUT.col, row: CUT.row, token: tokenOf(KIND, 0, "brilliant") },
  { col: PLAIN.col, row: PLAIN.row, token: tokenOf(KIND, 0) },
];

/**
 * How the two cells are watched: how many instants are sampled, and how many
 * frames of the suite's 64 Hz clock separate two of them.
 *
 * Four frames is a sixteenth of a second, and seventeen samples span one whole
 * second of game time. A system that "runs on rather than firing once" has run on
 * through all of it, and a build that showed the same picture at every one of
 * those instants has left the stone standing still.
 */
const SAMPLES = 17;
const FRAMES_BETWEEN = 4;

/**
 * Real milliseconds the produced files are given before the sweep begins.
 *
 * specs/assets.md has the systems loaded at run time and decoded off the frame
 * loop, so a sweep begun before the aura's own `system.json` arrives would be
 * watching a stone the build has nothing to run at yet. This spends REAL time
 * only: the simulation stands still through it.
 */
const ART_SETTLE_MS = 500;

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

afterEach(async () => {
  await h.dispose();
});

it("keeps a cut stone moving on a settled board while a plain stone holds still", async () => {
  const posed = quietRowsWith(CELLS);

  // The scenario, established before the build is asked anything: no run stands
  // on the board, so it is a board that resolves nothing and both stones simply
  // stand where they were written.
  assertEqual(maximalRuns(posed).length, 0, "maximal runs on the posed board");

  const settled = await loadBoard(h, posed);
  assertEqual(
    settled.phase,
    "idle",
    "the phase a run-free posed board rests in",
  );
  await h.settle(ART_SETTLE_MS);

  const samples = await captureReplay(h, "aura", async () => {
    // One frame first, so the canvas is holding the board that was posed rather
    // than whatever the frame before the pose left on it.
    await h.advance(1);
    const cut: Patch[] = [];
    const plain: Patch[] = [];
    for (let index = 0; index < SAMPLES; index += 1) {
      if (index > 0) await h.advance(FRAMES_BETWEEN);
      cut.push(await h.patch(CUT.col, CUT.row));
      plain.push(await h.patch(PLAIN.col, PLAIN.row));
    }
    return { cut, plain };
  });

  // Nothing moved the board while the two cells were watched.
  assertEqual(
    (await h.snapshot()).phase,
    "idle",
    "the phase after the two cells were watched",
  );

  // The control first, so a board that shimmers under everything is reported as
  // the reason the point cannot be read rather than as the aura running.
  assertLessThanOrEqual(
    spread(samples.plain),
    PATCH_SAME_MAX,
    `how far the plain ${KIND} at (${PLAIN.col},${PLAIN.row}) reads from ` +
      `itself across the sweep`,
  );

  assertGreaterThan(
    spread(samples.cut),
    PATCH_DISTINCT_MIN,
    `how far the brilliant ${KIND} at (${CUT.col},${CUT.row}) reads from ` +
      `itself across the sweep`,
  );
});
