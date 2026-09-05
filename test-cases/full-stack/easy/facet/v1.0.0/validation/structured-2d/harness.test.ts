// harness — the case-owned scaffolding the validators in this directory are
// built on, checked against itself. CASE-PROVIDED.
//
// The suites next door are validators: each decides ONE review item about the
// build. This file decides no review item, and no item names it, so a run never
// loads it. It runs with the whole project, which is how a case author runs these
// suites while writing them:
//
//   npx vitest run --config validation/vitest.config.ts
//
// It does two jobs.
//
//  1. IT KEEPS THE CASE'S OWN PURE CODE HONEST. The notation, the fixtures, the
//     geometry and the predicates in `board.ts` are the specification restated,
//     and every validator's expectation is written in them. A fixture that
//     quietly stopped being run-free, or a geometry formula that drifted, would
//     turn every check built on it into a lie that still passes. These are the
//     assertions that cannot be made from inside a validator.
//  2. IT PROVES THE HARNESS REALLY STANDS A BUILD UP. A harness that cannot pose
//     a board, drive a chain and read the result back is worth nothing, and the
//     failure would show up as forty broken validators rather than as one broken
//     harness. So this file poses an exactly-derived board through `loadBoard`,
//     requests one swap, and asserts the step the ruleset says that swap
//     produces — the clear count, the points, the strain the neighbors took, and
//     where the surviving gems landed.
//
// The second job reaches the build, which no VALIDATOR-shaped file in this
// directory should do without being a review item. That is deliberate and safe:
// nothing here can reach a verdict, because no review item declares this script.

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  assertBoardEquals,
  cellCenter,
  cellX,
  cellY,
  betweenCells,
  deadBoard,
  formatToken,
  hasAnyRun,
  hasPrism,
  legalSwapExists,
  maskBoard,
  maximalRuns,
  offBoardPoint,
  parseToken,
  quietBoard,
  quietRowsWith,
  renderCell,
  swapIsProductive,
  tokenOf,
  ESCAPE_SWAP,
  legalSwaps,
  quietRowsWithEscape,
  WILDCARD,
} from "./board";
import {
  BASE_SCORE,
  FRAMES_PER_STEP,
  GAMEOVER_TITLE_TEXT,
  GEM_HIT_R,
  GRID_COLS,
  GRID_ROWS,
  HUD_LEVEL_LABEL,
  HUD_SCORE_LABEL,
  LEVEL_TARGET_STEP,
  MAX_STRAIN,
  PAUSED_TITLE_TEXT,
  REFUSAL_FRAMES_BEFORE,
  REFUSAL_SECONDS,
  STAGE_H,
  STAGE_W,
  STEP_SECONDS,
  SWAP_DRIVE_FRAMES,
  TAGLINE_TEXT,
  TICK_S,
  TITLE_ITEMS,
  TITLE_TEXT,
} from "./constants";
import {
  captureReplay,
  captureStill,
  createHarness,
  dragGem,
  drawnText,
  drewText,
  framesPast,
  framesShortOf,
  loadBoard,
  patchDistance,
  poseBoard,
  poseBoardWithEscape,
  requestSwap,
  resolveChain,
  seconds,
  showsText,
  startRound,
  stepDriveFrames,
  swapAndStep,
  takeTarget,
  targetById,
  watchCues,
  type DrawCall,
  type Harness,
  type Patch,
} from "./harness";
import {
  FACET_DEBUG_VERSION,
  REQUIRED_OPS,
  type FacetSnapshot,
  type Phase,
} from "./surface";

/* -------------------------------------------------------------------------- */
/* The notation — specs/board.md                                              */
/* -------------------------------------------------------------------------- */

it("reads and writes every token specs/board.md gives as an example", () => {
  // Every gem read out of a token carries a `fell` of 0: the notation records
  // where a gem stands and nothing about how it got there, and specs/board.md
  // has every gem of a written board standing still in the cell it is written
  // at. `formatToken` writes the three fields the notation carries and never
  // that one, which is why the fixtures below are read back whole and written
  // back from the same object.
  const examples: [string, ReturnType<typeof parseToken>][] = [
    ["R0", { kind: "ruby", cut: "plain", strain: 0, fell: 0 }],
    ["J3", { kind: "jade", cut: "plain", strain: 3, fell: 0 }],
    ["S1b", { kind: "sapphire", cut: "brilliant", strain: 1, fell: 0 }],
    ["C0s", { kind: "citrine", cut: "star", strain: 0, fell: 0 }],
    ["X0", { kind: null, cut: "prism", strain: 0, fell: 0 }],
  ];
  for (const [token, gem] of examples) {
    expect(parseToken(token)).toEqual(gem);
    expect(formatToken(gem)).toBe(token);
  }
});

it("writes each kind letter specs/board.md tables", () => {
  const letters: [string, string][] = [
    ["ruby", "R"],
    ["amber", "A"],
    ["citrine", "C"],
    ["jade", "J"],
    ["beryl", "B"],
    ["sapphire", "S"],
    ["amethyst", "M"],
  ];
  for (const [kind, letter] of letters) {
    expect(tokenOf(kind as never, 0, "plain")).toBe(`${letter}0`);
  }
  expect(tokenOf(null, 2, "prism")).toBe("X2");
});

it("reads the whole example board specs/board.md writes out", () => {
  const example = [
    "R0 A0 C0 J0 B0 S0 M0 R0",
    "C0 J1 B0 S0 M0 R0 A0 C0",
    "B0 S0 M2 R1 A0 C0 J0 B0",
    "M0 R0 A0 C0 J0 B0b S0 M0",
    "A0 C0 J0 B0 S1 M0 R3 A0",
    "J0 B0 S2s M0 R0 A0 C0 J0",
    "S0 M0 R0 A0 X0 J0 B0 S0",
    "R0 A0 C0 J0 B0 S0 M0 R0",
  ];
  expect(parseToken("B0b").cut).toBe("brilliant");
  expect(parseToken("S2s").strain).toBe(2);
  expect(parseToken("X0").kind).toBeNull();
  // Round-trips through the grid unchanged, which is what a check compares.
  assertBoardEquals(example, example);
  expect(maximalRuns(example).length).toBe(0);
});

it("refuses a token that is not of the notation", () => {
  expect(() => parseToken("Z0")).toThrow(/Expected:/);
  expect(() => parseToken("R")).toThrow(/Expected:/);
  expect(() => parseToken(`R${MAX_STRAIN + 1}`)).toThrow(/Expected:/);
  expect(() => parseToken("X0b")).toThrow(/Expected:/);
});

/* -------------------------------------------------------------------------- */
/* The fixtures                                                               */
/* -------------------------------------------------------------------------- */

it("quietBoard really is quiet: no run, and no legal swap of its own", () => {
  const rows = quietBoard();
  expect(rows.length).toBe(GRID_ROWS);
  for (const row of rows) expect(row.split(" ").length).toBe(GRID_COLS);
  expect(maximalRuns(rows)).toEqual([]);
  expect(hasAnyRun(rows)).toBe(false);
  // The property that makes it an ISOLATING filler: the only productive swap on
  // a posed board is the one the scenario itself put there.
  expect(legalSwapExists(rows)).toBe(false);
  expect(hasPrism(rows)).toBe(false);
});

it("deadBoard really is dead: no run, no prism, and no legal swap", () => {
  const rows = deadBoard();
  expect(rows.length).toBe(GRID_ROWS);
  expect(hasAnyRun(rows)).toBe(false);
  expect(hasPrism(rows)).toBe(false);
  expect(legalSwapExists(rows)).toBe(false);
});

it("the escape cells plant a legal swap in the corner and no run", () => {
  const rows = quietRowsWithEscape([]);
  expect(hasAnyRun(rows)).toBe(false);
  const swaps = legalSwaps(rows);
  // Two, both in the bottom-left corner, and no others anywhere on the board.
  expect(swaps).toEqual([
    { a: { col: 1, row: 6 }, b: { col: 2, row: 6 } },
    ESCAPE_SWAP,
  ]);
  // And they stay out of the way of a mid-board scenario: the two the scenario
  // puts in the middle of the board are its own, and the corner's two are still
  // the corner's.
  const posed = quietRowsWithEscape([
    { col: 2, row: 4, token: "R0" },
    { col: 3, row: 4, token: "R0" },
  ]);
  expect(hasAnyRun(posed)).toBe(false);
  expect(legalSwaps(posed)).toEqual([
    { a: { col: 1, row: 3 }, b: { col: 1, row: 4 } },
    { a: { col: 4, row: 4 }, b: { col: 4, row: 5 } },
    { a: { col: 1, row: 6 }, b: { col: 2, row: 6 } },
    ESCAPE_SWAP,
  ]);
});

it("quietRowsWith writes the scenario's cells and nothing else", () => {
  const rows = quietRowsWith([
    { col: 2, row: 4, token: "R0" },
    { col: 3, row: 4, token: "R0" },
  ]);
  expect(rows[4].split(" ")[2]).toBe("R0");
  expect(rows[4].split(" ")[3]).toBe("R0");
  expect(rows[0]).toBe(quietBoard()[0]);
});

it("a cell a run would need is the only thing a productive swap turns on", () => {
  // The exact arrangement the live check below poses: two rubies at (2,4) and
  // (3,4), with the quiet filler's own ruby sitting at (4,5). Exchanging (4,5)
  // with (4,4) completes the row, and nothing else on the board does.
  const posed = quietRowsWith([
    { col: 2, row: 4, token: "R0" },
    { col: 3, row: 4, token: "R0" },
  ]);
  expect(swapIsProductive(posed, { col: 4, row: 5 }, { col: 4, row: 4 })).toBe(
    true,
  );
  expect(swapIsProductive(posed, { col: 0, row: 0 }, { col: 1, row: 0 })).toBe(
    false,
  );
});

/* -------------------------------------------------------------------------- */
/* Wildcards                                                                  */
/* -------------------------------------------------------------------------- */

it("an expected wildcard matches anything, and a real token does not", () => {
  const rows = quietBoard();
  const masked = maskBoard(rows, [{ col: 0, row: 0 }]);
  expect(masked[0].split(" ")[1]).toBe(WILDCARD);
  expect(masked[0].split(" ")[0]).toBe(rows[0].split(" ")[0]);
  // The mask matches the board it was made from, whatever the other cells hold.
  assertBoardEquals(rows, masked);
  assertBoardEquals(quietRowsWith([{ col: 5, row: 5, token: "X3" }]), masked);
  // And a named cell that differs is reported with its coordinates.
  expect(() =>
    assertBoardEquals(quietRowsWith([{ col: 0, row: 0, token: "X3" }]), masked),
  ).toThrow(/\(0,0\)/);
});

/* -------------------------------------------------------------------------- */
/* Geometry — specs/board.md                                                  */
/* -------------------------------------------------------------------------- */

it("cell centers run the range specs/board.md states", () => {
  expect(cellX(0)).toBe(388);
  expect(cellX(GRID_COLS - 1)).toBe(892);
  expect(cellY(0)).toBe(144);
  expect(cellY(GRID_ROWS - 1)).toBe(648);
  for (let col = 0; col < GRID_COLS; col += 1) {
    for (let row = 0; row < GRID_ROWS; row += 1) {
      const { x, y } = cellCenter(col, row);
      expect(x).toBeGreaterThanOrEqual(388);
      expect(x).toBeLessThanOrEqual(892);
      expect(y).toBeGreaterThanOrEqual(144);
      expect(y).toBeLessThanOrEqual(648);
      expect(x).toBeLessThan(STAGE_W);
      expect(y).toBeLessThan(STAGE_H);
    }
  }
});

it("betweenCells lies exactly GEM_HIT_R from both centers", () => {
  const pairs: [{ col: number; row: number }, { col: number; row: number }][] =
    [
      [
        { col: 2, row: 3 },
        { col: 3, row: 3 },
      ],
      [
        { col: 5, row: 1 },
        { col: 5, row: 2 },
      ],
    ];
  for (const [a, b] of pairs) {
    const point = betweenCells(a, b);
    const first = cellCenter(a.col, a.row);
    const second = cellCenter(b.col, b.row);
    expect(Math.hypot(point.x - first.x, point.y - first.y)).toBeCloseTo(
      GEM_HIT_R,
      10,
    );
    expect(Math.hypot(point.x - second.x, point.y - second.y)).toBeCloseTo(
      GEM_HIT_R,
      10,
    );
  }
});

it("offBoardPoint is farther than GEM_HIT_R from every cell center", () => {
  const point = offBoardPoint();
  let nearest = Infinity;
  for (let col = 0; col < GRID_COLS; col += 1) {
    for (let row = 0; row < GRID_ROWS; row += 1) {
      const center = cellCenter(col, row);
      nearest = Math.min(
        nearest,
        Math.hypot(point.x - center.x, point.y - center.y),
      );
    }
  }
  expect(nearest).toBeGreaterThan(GEM_HIT_R);
  expect(point.x).toBeGreaterThanOrEqual(0);
  expect(point.y).toBeGreaterThanOrEqual(0);
});

/* -------------------------------------------------------------------------- */
/* The distinguishability instrument                                          */
/* -------------------------------------------------------------------------- */

/** A synthetic patch of one color, for the arithmetic below. */
function flat(r: number, g: number, b: number, size = 3): Patch {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { half: 1, width: size, height: size, data };
}

it("patchDistance is the mean per-pixel RGB distance", () => {
  expect(patchDistance(flat(10, 20, 30), flat(10, 20, 30))).toBe(0);
  expect(patchDistance(flat(0, 0, 0), flat(3, 4, 0))).toBeCloseTo(5, 10);
  expect(() => patchDistance(flat(0, 0, 0, 3), flat(0, 0, 0, 5))).toThrow(
    /Expected:/,
  );
});

it("patchDistance sees a difference of FORM at an identical mean color", () => {
  // Two 2x2 patches with the same mean and no pixel in common: a build that
  // tells two kinds apart by facet pattern alone must still register.
  const checker = (first: number, second: number): Patch => {
    const data = new Uint8ClampedArray(2 * 2 * 4);
    const values = [first, second, second, first];
    values.forEach((value, index) => {
      data[index * 4] = value;
      data[index * 4 + 1] = value;
      data[index * 4 + 2] = value;
      data[index * 4 + 3] = 255;
    });
    return { half: 1, width: 2, height: 2, data };
  };
  const a = checker(0, 200);
  const b = checker(200, 0);
  expect(patchDistance(a, b)).toBeGreaterThan(100);
});

it("reads a patch of no pixels as no distance", () => {
  // A degenerate patch is a reading rather than a division, so a box that came
  // back empty fails the check that asked the question rather than answering NaN.
  const empty = (): Patch => ({
    half: 0,
    width: 0,
    height: 0,
    data: new Uint8ClampedArray(0),
  });
  expect(patchDistance(empty(), empty())).toBe(0);
});

/* -------------------------------------------------------------------------- */
/* The harness against a real build                                           */
/* -------------------------------------------------------------------------- */

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/** Where this file's own outputs land: the staged project, then this suite. */
const SUITE_DIR = join("validation", "harness.test.ts");

let mediaDir: string;
let collecting: string | undefined;
let h: Harness;

beforeEach(async () => {
  collecting = process.env[MEDIA_DIR_ENV];
  mediaDir = mkdtempSync(join(tmpdir(), "facet-media-"));
  process.env[MEDIA_DIR_ENV] = mediaDir;
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
  if (collecting === undefined) delete process.env[MEDIA_DIR_ENV];
  else process.env[MEDIA_DIR_ENV] = collecting;
  rmSync(mediaDir, { recursive: true, force: true });
});

/** What this suite wrote into its own output directory, by file name. */
function written(): string[] {
  try {
    return readdirSync(join(mediaDir, SUITE_DIR)).sort();
  } catch {
    // The directory is made only when there is something to put in it.
    return [];
  }
}

it("stands the build up on the title screen with the surface reachable", async () => {
  // `specs/instrumentation.md` puts the version on the surface AND in the
  // snapshot, so both readers are exercised and both must answer the same
  // number.
  expect(await h.debugVersion()).toBe(FACET_DEBUG_VERSION);
  const snapshot = h.snapshot();
  expect(snapshot.version).toBe(FACET_DEBUG_VERSION);
  expect(typeof snapshot).toBe("object");
  expect(snapshot.screen).toBe("title");
  expect(snapshot.board.cells.length).toBe(0);
  expect(snapshot.phase).toBe("idle");
  expect(snapshot.level).toBe(1);
  expect(snapshot.levelTarget).toBe(LEVEL_TARGET_STEP);
  expect(h.world).toBeTruthy();
  expect(h.state).toBeTruthy();
});

it("deals an opening board through start(), and it obeys specs/rules.md", () => {
  const snapshot = startRound(h);
  expect(snapshot.screen).toBe("playing");
  expect(snapshot.board.cells.length).toBe(GRID_COLS * GRID_ROWS);
  const rows = h.board();
  expect(hasAnyRun(rows)).toBe(false);
  expect(legalSwapExists(rows)).toBe(true);
});

it("poses the written board exactly, cell for cell", () => {
  const rows = quietRowsWith([
    { col: 2, row: 4, token: "R0" },
    { col: 3, row: 4, token: "R0" },
    { col: 6, row: 1, token: "X0" },
    { col: 0, row: 7, token: "J3" },
    { col: 1, row: 7, token: "S2b" },
  ]);
  loadBoard(h, rows);
  assertBoardEquals(h.board(), rows, "the board loadBoard was handed");
});

it("resolves the exact chain step specs/rules.md describes for one swap", async () => {
  // THE ARRANGEMENT. Two rubies at (2,4) and (3,4) over the run-free filler,
  // whose own gem at (4,5) is already a ruby. Exchanging (4,5) with (4,4)
  // completes a horizontal run of exactly three at row 4, columns 2-4, and
  // nothing else on the board matches. The pure predicates above prove that
  // this arrangement, and only this swap, is productive.
  poseBoard(h, [
    { col: 2, row: 4, token: "R0" },
    { col: 3, row: 4, token: "R0" },
  ]);

  // The request alone only puts the swap in motion; carried through the
  // animation, this reading is step 1.
  const first = await swapAndStep(h, { col: 4, row: 5 }, { col: 4, row: 4 });

  // R5 seeds the step with the union of the maximal runs: exactly three cells.
  expect(first.lastCleared).toBe(3);
  // Scoring: three clean gems at multiplier 1 (chainStep 1).
  expect(first.chainStep).toBe(1);
  expect(first.multiplier).toBe(1);
  expect(first.lastPoints).toBe(3 * BASE_SCORE);
  expect(first.score).toBe(3 * BASE_SCORE);
  expect(first.levelScore).toBe(3 * BASE_SCORE);
  expect(first.phase).toBe("resolving");

  // R7: every gem orthogonally adjacent to the clear set gains exactly one
  // strain, and R9 carries that strain down with the gem when it falls. The
  // three cells at row 4 are what fell from row 3; the two beside the set and
  // the three below it stayed where they were.
  expect(renderCell(first, 1, 4)).toBe("C1");
  expect(renderCell(first, 5, 4)).toBe("M1");
  expect(renderCell(first, 2, 4)).toBe("A1");
  expect(renderCell(first, 3, 4)).toBe("C1");
  expect(renderCell(first, 4, 4)).toBe("J1");
  expect(renderCell(first, 2, 5)).toBe("S1");
  expect(renderCell(first, 3, 5)).toBe("M1");
  expect(renderCell(first, 4, 5)).toBe("S1");

  // R9: the board is full again once the step settles.
  expect(first.board.cells.length).toBe(GRID_COLS * GRID_ROWS);

  // And the chain really ends, inside the cap, rather than running forever.
  const settled = await resolveChain(h);
  expect(settled.settled).toBe(true);
  expect(settled.snapshot.phase).toBe("idle");
  expect(settled.snapshot.chainStep).toBe(0);
  expect(settled.snapshot.score).toBeGreaterThanOrEqual(3 * BASE_SCORE);
});

it("reads back a refusal for a swap that makes nothing", () => {
  poseBoard(h, []);
  const refused = requestSwap(h, { col: 0, row: 0 }, { col: 1, row: 0 });
  expect(refused.phase).toBe("idle");
  expect(refused.refusal).not.toBeNull();
  expect(refused.refusal?.a).toEqual({ col: 0, row: 0 });
  expect(refused.refusal?.b).toEqual({ col: 1, row: 0 });
});

it("agrees with the case's own legalSwap predicate on a dead board", () => {
  const posed = loadBoard(h, deadBoard());
  expect(legalSwapExists(deadBoard())).toBe(false);
  expect(posed.legalSwap).toBe(false);
});

it("refuses a frame count that is not a whole number of frames", async () => {
  // A fixture error fails as one, the rule `loadBoard` follows: a count below
  // one, or a fractional count, is a mistake in the check rather than a verdict
  // about the build.
  await expect(h.advanceSeconds(1, 0)).rejects.toThrow(/Expected:/);
  await expect(h.advanceSeconds(1, 2.5)).rejects.toThrow(/Expected:/);
});

it("advances only when asked, and advanceSeconds spends the time it names", async () => {
  poseBoard(h, []);
  const before = h.snapshot();
  expect(before.simTime).toBeGreaterThanOrEqual(0);
  await h.advanceSeconds(1, 60);
  const after = h.snapshot();
  expect(after.simTime - before.simTime).toBeCloseTo(1, 6);
  expect(h.frame()).toBeGreaterThanOrEqual(60);
});

it("gives one frame's draw calls, and the strings that frame drew", async () => {
  startRound(h);
  const calls = await h.frameCalls();
  expect(calls.length).toBeGreaterThan(0);
  const text = await h.frameText();
  expect(Array.isArray(text)).toBe(true);
});

it("reads a device-pixel patch centered on a cell", async () => {
  poseBoard(h, [{ col: 3, row: 3, token: "R0" }]);
  await h.advance(1);
  const patch = h.patch(3, 3);
  expect(patch.width).toBe(patch.height);
  expect(patch.data.length).toBe(patch.width * patch.height * 4);
  expect(patchDistance(patch, patch)).toBe(0);
});

it("reads one box shape at a board edge and at its middle", async () => {
  // The box is the same shape wherever the cell sits: at a canvas edge the
  // ORIGIN slides inward rather than the box shrinking. `patchDistance` is a
  // MEAN over the box, so two readings of one cell answer for what was drawn in
  // it rather than for how the box was cut. A `half` of 120 logical units runs
  // off the bottom of the 1280x720 stage at the last row, which is what makes
  // this readable at all.
  poseBoardWithEscape(h, []);
  await h.advance(1);
  const middle = h.patch(3, 3, 120);
  const corner = h.patch(7, 7, 120);
  expect(middle.width).toBe(241);
  expect(middle.height).toBe(241);
  expect(corner.width).toBe(middle.width);
  expect(corner.height).toBe(middle.height);
  // And two boxes of one shape are comparable, which is the whole point of it.
  expect(patchDistance(middle, corner)).toBeGreaterThanOrEqual(0);
});

it("writes a still and a replay under the running suite's own address", async () => {
  poseBoard(h, [
    { col: 2, row: 4, token: "R0" },
    { col: 3, row: 4, token: "R0" },
  ]);
  await h.advance(1);
  captureStill(h, "posed");
  const settled = await captureReplay(h, "chain", async () => {
    await swapAndStep(h, { col: 4, row: 5 }, { col: 4, row: 4 });
    return resolveChain(h);
  });
  expect(settled.settled).toBe(true);
  expect(written()).toEqual(["chain.json.gz", "posed.png"]);
});

it("writes nothing at all when nobody is collecting", async () => {
  delete process.env[MEDIA_DIR_ENV];
  poseBoard(h, []);
  await h.advance(1);
  captureStill(h, "posed");
  const value = await captureReplay(h, "chain", () => 7);
  // The scenario's own value comes straight back, collecting or not.
  expect(value).toBe(7);
  expect(written()).toEqual([]);
});

it("keeps the round alive when a chain settles over the escape swap", async () => {
  poseBoardWithEscape(h, [
    { col: 2, row: 4, token: "R0" },
    { col: 3, row: 4, token: "R0" },
  ]);
  const first = await swapAndStep(h, { col: 4, row: 5 }, { col: 4, row: 4 });
  expect(first.lastCleared).toBe(3);
  const settled = await resolveChain(h);
  expect(settled.settled).toBe(true);
  // The corner swap survives the scenario's clear, so the round goes on.
  expect(settled.snapshot.legalSwap).toBe(true);
  expect(settled.snapshot.screen).toBe("playing");
});

it("ends the round when a chain settles on a board with no swap left", async () => {
  // The same scenario over the bare filler, which carries no legal swap of its
  // own: specs/rules.md ends the round, and that is what a check about the end
  // of a round relies on.
  poseBoard(h, [
    { col: 2, row: 4, token: "R0" },
    { col: 3, row: 4, token: "R0" },
  ]);
  await swapAndStep(h, { col: 4, row: 5 }, { col: 4, row: 4 });
  const settled = await resolveChain(h);
  expect(settled.settled).toBe(true);
  expect(settled.snapshot.legalSwap).toBe(false);
  expect(settled.snapshot.screen).toBe("gameover");
});

it("stamps a cue with the frame that played it", async () => {
  // Cues are raised by a FRAME, never by a pose (specs/ui.md), so the press is
  // delivered as a real pointer event and read inside a frame's own update
  // rather than posed through the surface.
  const cues = watchCues(h);
  poseBoardWithEscape(h, [
    { col: 2, row: 4, token: "R0" },
    { col: 3, row: 4, token: "R0" },
  ]);
  await h.advance(1);
  const at = h.frame();
  const center = cellCenter(4, 5);
  h.press(center.x, center.y);
  await h.advance(1);
  expect(cues.length).toBeGreaterThan(0);
  expect(cues.every((cue) => cue.frame === at + 1)).toBe(true);
  expect(h.snapshot().selection).toEqual({ col: 4, row: 5 });
});

it("counts the frames that stop short of a duration, and that carry past it", () => {
  // A step's hold is the step's own figure rather than a constant, so the drives
  // below are counted from a duration. The one duration the suite also writes
  // down by hand is what the arithmetic is held against.
  expect(framesShortOf(REFUSAL_SECONDS)).toBe(REFUSAL_FRAMES_BEFORE);
  expect(framesShortOf(REFUSAL_SECONDS) * TICK_S).toBeLessThan(REFUSAL_SECONDS);
  expect(framesShortOf(16 * TICK_S)).toBe(15);

  // Past the duration by a whole frame, so a build comparing `>` has fired as
  // surely as one comparing `>=`, and by at most two, so the drive is nowhere
  // near a second threshold of the same length.
  for (const duration of [0.18, 0.25, 0.3, 0.42, 16 * TICK_S]) {
    const covered = framesPast(duration) * TICK_S;
    expect(covered).toBeGreaterThan(duration + TICK_S - 1e-9);
    expect(covered).toBeLessThan(duration + 2 * TICK_S + 1e-9);
  }
});

it("sizes a step's drive from the hold that step reports", () => {
  // The three fields the drive is computed from, as a snapshot. A cast rather
  // than a whole snapshot because the function reads exactly these three, and a
  // fabricated board would say nothing about which.
  const timing = (
    phase: Phase,
    stepHold: number,
    stepTimer: number,
  ): FacetSnapshot =>
    ({ phase, stepHold, stepTimer }) as unknown as FacetSnapshot;

  expect(stepDriveFrames(timing("resolving", STEP_SECONDS, 0))).toBe(
    framesPast(STEP_SECONDS),
  );
  // What has already run comes off the drive, so the overshoot past the boundary
  // stays inside two frames however deep into the hold this is asked.
  expect(
    stepDriveFrames(timing("resolving", STEP_SECONDS, STEP_SECONDS / 2)),
  ).toBe(framesPast(STEP_SECONDS / 2));
  // A swap in motion is timed by SWAP_SECONDS instead, and is the one case the
  // hold has nothing to say about.
  expect(stepDriveFrames(timing("swapping", STEP_SECONDS, 0))).toBe(
    SWAP_DRIVE_FRAMES,
  );
});

it("plays a move as the whole gesture, and never as a shortcut", async () => {
  // specs/controls.md plays a move by taking hold of a gem, carrying it onto a
  // neighbor, and letting go: the RELEASE is what requests the swap. The gesture
  // helper goes through `pointerDown`, `pointerMove` and `pointerUp` and through
  // nothing else, so what decides the outcome is the build's own press, move and
  // release rules.
  poseBoardWithEscape(h, [
    { col: 2, row: 4, token: "R0" },
    { col: 3, row: 4, token: "R0" },
  ]);
  const played = dragGem(h, { col: 4, row: 5 }, { col: 4, row: 4 });

  // The release requested the swap and let the gem go.
  expect(played.phase).toBe("swapping");
  expect(played.offer).toBeNull();
  expect(played.selection).toBeNull();

  const settled = await resolveChain(h);
  expect(settled.settled).toBe(true);
  expect(settled.snapshot.score).toBeGreaterThanOrEqual(3 * BASE_SCORE);
});

it("takes a reported pointer target, by mouse and by touch", () => {
  // A target's rectangle is the BUILD's, so a check reads the one it is going to
  // press off the snapshot. specs/instrumentation.md fixes that pressing and
  // releasing at a listed target's center takes that target.
  const play = targetById(h.snapshot(), "menu-0");
  expect(play.w).toBeGreaterThan(0);
  const opened = takeTarget(h, play, "touch");
  expect(opened.screen).toBe("playing");
  expect(opened.pointer.device).toBe("touch");

  // And a target the screen does not carry fails as the fixture error it is,
  // naming the ids that were reported.
  expect(() => targetById(opened, "menu-1")).toThrow(/Expected:/);
});

it("keeps the two looping music beds apart from the one-shot cues", async () => {
  const cues = watchCues(h);
  await h.advance(2);
  // A bed loops on the title screen, and it is NOT a cue.
  expect(h.loops.length).toBeGreaterThan(0);
  expect(cues.length).toBe(0);
});

it("options.seed reaches the build, and the same seed deals the same board", async () => {
  const a = await createHarness({ seed: 7 });
  const first = (startRound(a), a.board());
  a.dispose();
  const b = await createHarness({ seed: 7 });
  const again = (startRound(b), b.board());
  b.dispose();
  assertBoardEquals(again, first, "the same seed, dealt twice");
});

/* -------------------------------------------------------------------------- */
/* The real pointer — specs/controls.md                                       */
/* -------------------------------------------------------------------------- */
//
// The `pointer` review items are about the press, move and release RULES and
// pose through `debug.pointerDown`, `debug.pointerMove` and `debug.pointerUp`,
// which specs/instrumentation.md says take effect at the call. These are about the OTHER path: the pointer verbs deliver an ordinary
// pointer event to the engine, so a check whose evidence is a CUE — which
// specs/ui.md plays from a frame and never from a pose — has a way to make the
// press a player would make. A verb nothing drives is a verb that has never been
// shown to work, so it is driven here.

it("a real pointer press selects the cell it landed on", async () => {
  poseBoardWithEscape(h, []);
  const center = cellCenter(4, 5);

  h.press(center.x, center.y);
  await h.advance(1);

  const snapshot = h.snapshot();
  expect(snapshot.selection).toEqual({ col: 4, row: 5 });
  // The conversion round-trips: the engine placed the event back on the exact
  // logical point the verb was given, which is what makes `client(x, y)` right
  // rather than merely close.
  expect(snapshot.pointer).toEqual({
    x: center.x,
    y: center.y,
    down: true,
    device: "mouse",
  });
});

it("a press away from the board targets nothing", async () => {
  poseBoardWithEscape(h, []);
  const away = offBoardPoint();

  h.press(away.x, away.y);
  await h.advance(1);

  expect(h.snapshot().selection).toBeNull();
});

it("a second press offers, and the release plays the move", async () => {
  // The arrangement the pure predicates above already prove: two rubies at
  // (2,4) and (3,4) over the quiet filler, whose own gem at (4,5) is a ruby, so
  // exchanging (4,5) with (4,4) completes a run of exactly three and nothing
  // else on the board matches. The escape keeps the round alive afterwards.
  poseBoardWithEscape(h, [
    { col: 2, row: 4, token: "R0" },
    { col: 3, row: 4, token: "R0" },
  ]);
  const from = cellCenter(4, 5);
  const to = cellCenter(4, 4);

  h.press(from.x, from.y);
  await h.advance(1);
  expect(h.snapshot().selection).toEqual({ col: 4, row: 5 });

  // The press on the neighbor OFFERS the held gem into it and plays nothing:
  // specs/controls.md puts the whole move behind the release.
  h.lift();
  h.press(to.x, to.y);
  await h.advance(1);
  const offered = h.snapshot();
  expect(offered.selection).toEqual({ col: 4, row: 5 });
  expect(offered.offer).toEqual({ col: 4, row: 4 });
  expect(offered.phase).toBe("idle");

  // The release requests the swap, which enters `swapping` for SWAP_SECONDS
  // before its first step resolves.
  h.lift();
  await h.advance(1);
  const played = h.snapshot();
  expect(played.phase).toBe("swapping");
  expect(played.selection).toBeNull();
  expect(played.offer).toBeNull();

  await h.advance(SWAP_DRIVE_FRAMES);
  const swapped = h.snapshot();
  expect(swapped.phase).toBe("resolving");
  expect(swapped.chainStep).toBe(1);
  expect(swapped.lastCleared).toBe(3);
});

it("a drag onto the neighbor offers, and letting go plays the move", async () => {
  poseBoardWithEscape(h, [
    { col: 2, row: 4, token: "R0" },
    { col: 3, row: 4, token: "R0" },
  ]);
  const from = cellCenter(4, 5);
  const between = betweenCells({ col: 4, row: 5 }, { col: 4, row: 4 });
  const to = cellCenter(4, 4);

  // Press and two moves, then ONE frame. specs/controls.md requires of this
  // engine that a drag crossing several cells between two frames arrive as every
  // position it visited rather than as the last one alone, so all three samples
  // are delivered and resolved in arrival order inside that single frame.
  h.press(from.x, from.y);
  h.moveTo(between.x, between.y);
  h.moveTo(to.x, to.y);
  await h.advance(1);

  // The carry has offered the gem into its neighbor; the board is untouched.
  const dragged = h.snapshot();
  expect(dragged.selection).toEqual({ col: 4, row: 5 });
  expect(dragged.offer).toEqual({ col: 4, row: 4 });
  expect(dragged.phase).toBe("idle");

  h.lift();
  await h.advance(1 + SWAP_DRIVE_FRAMES);

  const played = h.snapshot();
  expect(played.phase).toBe("resolving");
  expect(played.chainStep).toBe(1);
  expect(played.lastCleared).toBe(3);
  expect(played.selection).toBeNull();
  expect(played.offer).toBeNull();
});

it("client maps a logical stage point at a canvas denser than its layout", async () => {
  // At the default shape a logical unit IS a device pixel and a CSS pixel, so
  // the conversion is invisible; at dpr 2 it is the whole of what keeps a press
  // on the cell it names. A press is delivered in CSS pixels and the engine
  // multiplies by dpr, so the verb must divide by it.
  const dense = await createHarness({ dpr: 2 });
  try {
    const center = cellCenter(4, 5);
    const at = dense.client(center.x, center.y);
    expect(at).toEqual({ x: center.x, y: center.y });

    poseBoardWithEscape(dense, []);
    dense.press(center.x, center.y);
    await dense.advance(1);
    expect(dense.snapshot().selection).toEqual({ col: 4, row: 5 });
  } finally {
    dense.dispose();
  }
});

it("tapAction fires the action its name gives, through the real input path", async () => {
  // The keyboard drives the MENUS (specs/controls.md), so the reading is the
  // title menu's highlight rather than anything on the board. `down` is bound to
  // ArrowDown, and `tapAction` is what presses an action's first binding.
  await h.advance(1);
  expect(h.snapshot().menuIndex).toBe(0);

  await h.tapAction("down");

  expect(h.snapshot().menuIndex).toBe(1);
});

/* -------------------------------------------------------------------------- */
/* Text on screen — specs/ui.md                                               */
/* -------------------------------------------------------------------------- */

it("showsText reads every rendering of a line specs/ui.md permits", () => {
  // specs/ui.md fixes the COPY and nothing about the shape of the drawing, and
  // its own "Facet fixes no palette, no font" hands the typography to the build.
  // All four of these are conformant renderings of one screen.
  expect(showsText(["FACET"], TITLE_TEXT)).toBe(true);
  expect(showsText(["F", "A", "C", "E", "T"], TITLE_TEXT)).toBe(true);
  expect(showsText(["HOW", " ", "TO", " ", "PLAY"], "HOW TO PLAY")).toBe(true);
  expect(showsText(["> PLAY <"], "PLAY")).toBe(true);
  expect(showsText(["SCORE 120"], HUD_SCORE_LABEL)).toBe(true);
  // And a screen that shows none of it says so.
  expect(showsText(["SCORE", "0", "LEVEL", "1"], TITLE_TEXT)).toBe(false);
  expect(showsText(["SCORE", "0"], GAMEOVER_TITLE_TEXT)).toBe(false);
});

it("drawnText lists the two text channels apart, so an outline still spells", () => {
  // A build that outlines its title issues a `strokeText` and a `fillText` for
  // each glyph. In true call order that reads `F F A A C C E E T T`, which
  // spells nothing; listed by channel each channel spells the copy on its own.
  const outlined: DrawCall[] = [];
  for (const glyph of ["F", "A", "C", "E", "T"]) {
    outlined.push({ kind: "call", method: "strokeText", args: [glyph, 0, 0] });
    outlined.push({ kind: "call", method: "fillText", args: [glyph, 0, 0] });
  }
  expect(drawnText(outlined)).toEqual([..."FACET", ..."FACET"]);
  expect(drewText(outlined, TITLE_TEXT)).toBe(true);
});

it("drewText finds the copy the build really put on the title screen", async () => {
  const calls = await h.frameCalls();

  expect(drewText(calls, TITLE_TEXT)).toBe(true);
  expect(drewText(calls, TAGLINE_TEXT)).toBe(true);
  for (const item of TITLE_ITEMS) expect(drewText(calls, item)).toBe(true);

  // The negatives, which is what says the readings above are not vacuous: no
  // screen shows every string, and this one shows none of these.
  expect(drewText(calls, GAMEOVER_TITLE_TEXT)).toBe(false);
  expect(drewText(calls, PAUSED_TITLE_TEXT)).toBe(false);
});

it("drewText finds the labeled readouts on the playing screen", async () => {
  startRound(h);
  const calls = await h.frameCalls();

  expect(drewText(calls, HUD_SCORE_LABEL)).toBe(true);
  expect(drewText(calls, HUD_LEVEL_LABEL)).toBe(true);
  expect(drewText(calls, GAMEOVER_TITLE_TEXT)).toBe(false);
  expect(drewText(calls, "HOW TO PLAY")).toBe(false);
});

/* -------------------------------------------------------------------------- */
/* The rest of the vocabulary                                                 */
/* -------------------------------------------------------------------------- */

it("probe reflects over the surface without invoking any of it", async () => {
  const before = h.snapshot().score;
  const reflected = await h.probe([...REQUIRED_OPS, "noSuchOperation"]);

  for (const name of REQUIRED_OPS) expect(reflected[name]).toBe("function");
  expect(reflected.noSuchOperation).toBe("undefined");
  // Reflection alone: nothing on the surface was called.
  expect(h.snapshot().score).toBe(before);
});

it("reports no surface fault for a build whose surface is there", () => {
  expect(h.surfaceFault).toBeNull();
  expect(h.pageErrors).toEqual([]);
});

it("records every path the build asked for, not only the ones that failed", () => {
  expect(h.requests.length).toBeGreaterThan(0);
  expect(h.failedRequests).toEqual([]);
  // specs/assets.md has every produced file loaded page-relative, so nothing the
  // build asked for names a host or the site root.
  for (const asked of h.requests) {
    expect(asked.startsWith("/")).toBe(false);
    expect(/^[a-z][a-z0-9+.-]*:\/\//iu.test(asked)).toBe(false);
  }
});

it("serves the build from a sub-path with its produced files intact", async () => {
  const mounted = await createHarness({ basePath: "/preview/facet/" });
  try {
    expect(mounted.failedRequests).toEqual([]);
    expect(mounted.requests.length).toBeGreaterThan(0);
  } finally {
    mounted.dispose();
  }
});

it("warmAudio waits, in real time, until a sound has actually gone out", async () => {
  await h.armAudio();
  const heard = await h.warmAudio();
  expect(heard).toBe(true);
  expect(h.cues.length + h.loops.length).toBeGreaterThan(0);
});

it("settle spends real time without advancing the simulation", async () => {
  const before = h.frame();
  const started = Date.now();
  await h.settle(30);
  expect(h.frame()).toBe(before);
  expect(Date.now() - started).toBeGreaterThanOrEqual(25);
});

it("seconds converts frames of the suite's clock to the time they cover", () => {
  expect(seconds(FRAMES_PER_STEP)).toBeCloseTo(STEP_SECONDS, 12);
});
