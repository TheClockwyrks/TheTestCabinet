// harness — the case-owned code every validator in this directory rests on.
//
// The suites next door are validators: each decides one review point against
// the build. THIS FILE DECIDES NO POINT, and no review item names it, so a run
// never loads it. It runs with the whole project, which is how a case author
// runs these suites while writing them:
//
//   npx vitest run --config validation/vitest.config.ts
//
// What it checks is the machinery a validator would otherwise be trusting
// blind: the board notation and its fixtures (a fixture that is not the board
// it claims to be would make every check written on it meaningless), the
// geometry the pointer checks measure against, the wildcard comparison the
// post-chain checks rest on, the pixel instrument the appearance checks read,
// the replay capture a reviewer's evidence is written with — and, at the end,
// that the harness can really stand a build up, pose an exact board, drive a
// chain and read the outcome back.
//
// That last section runs the BUILD, and it is still not a point: what it
// asserts is a consequence of specs/rules.md so plain that a build failing it
// fails a dozen real items too. It is here because a harness nobody has stood a
// build up with is a harness nobody knows works.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Recording } from "@test-cabinet/simple-2d";
import {
  assertBoardEquals,
  betweenCells,
  cellCenter,
  cellX,
  cellY,
  deadBoard,
  distanceToNearestCell,
  formatToken,
  hasAnyRun,
  hasPrism,
  insideCell,
  legalSwapExists,
  maskBoard,
  maximalRuns,
  offBoardPoint,
  parseRows,
  parseToken,
  quietBoard,
  quietRowsWith,
  renderBoard,
  swapWouldMatch,
  tokenAt,
  tokenOf,
  withRow,
} from "./board";
import {
  BASE_SCORE,
  GEM_HIT_R,
  GRID_COLS,
  GRID_ROWS,
  HUD_LEVEL_LABEL,
  HUD_SCORE_LABEL,
  LEVEL_TARGET_STEP,
  MAX_REPLAY_FRAMES,
  REFUSAL_FRAMES_AFTER,
  REFUSAL_FRAMES_BEFORE,
  REFUSAL_SECONDS,
  STEP_SECONDS,
  SWAP_DRIVE_FRAMES,
  TAGLINE_TEXT,
  TICK_MS,
  TICK_S,
  TITLE_ITEMS,
  TITLE_TEXT,
} from "./constants";
import {
  advanceStep,
  captureReplay,
  createHarness,
  dragGem,
  drawnText,
  drewText,
  framesPast,
  framesShortOf,
  loadBoard,
  patchDistance,
  poseBoard,
  requestSwap,
  resolveChain,
  retable,
  showsText,
  startRound,
  stepDriveFrames,
  swapAndStep,
  takeTarget,
  targetById,
  type DrawCall,
  type Harness,
  type Patch,
} from "./harness";
import { FACET_DEBUG_VERSION, type FacetSnapshot, type Phase } from "./surface";

/* -------------------------------------------------------------------------- */
/* The notation                                                               */
/* -------------------------------------------------------------------------- */

describe("the board notation", () => {
  it("reads every token specs/board.md writes out", () => {
    expect(parseToken("R0")).toEqual({
      kind: "ruby",
      cut: "plain",
      strain: 0,
      fell: 0,
    });
    expect(parseToken("J3")).toEqual({
      kind: "jade",
      cut: "plain",
      strain: 3,
      fell: 0,
    });
    expect(parseToken("S1b")).toEqual({
      kind: "sapphire",
      cut: "brilliant",
      strain: 1,
      fell: 0,
    });
    expect(parseToken("C0s")).toEqual({
      kind: "citrine",
      cut: "star",
      strain: 0,
      fell: 0,
    });
    expect(parseToken("X0")).toEqual({
      kind: null,
      cut: "prism",
      strain: 0,
      fell: 0,
    });
  });

  it("writes back every token it reads", () => {
    for (const token of ["R0", "A1", "C2", "J3", "B0b", "S2s", "M1", "X3"]) {
      expect(formatToken(parseToken(token))).toBe(token);
    }
  });

  it("names a kind, a strain and a cut as one token", () => {
    expect(tokenOf("ruby", 0)).toBe("R0");
    expect(tokenOf("amethyst", 2, "brilliant")).toBe("M2b");
    expect(tokenOf("beryl", 1, "star")).toBe("B1s");
    expect(tokenOf(null, 0, "prism")).toBe("X0");
  });

  it("refuses a token that is not of the notation", () => {
    for (const bad of ["", "R", "R4", "Z0", "R0x", "X0b", "r0"]) {
      expect(() => parseToken(bad), bad).toThrow(/Expected:/);
    }
  });

  it("reads the eight-line board specs/board.md prints", () => {
    // The example board from specs/board.md, verbatim.
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
    const cells = parseRows(example);
    expect(cells.length).toBe(GRID_ROWS);
    expect(cells[0].length).toBe(GRID_COLS);
    expect(cells[2][2]).toEqual({
      kind: "amethyst",
      cut: "plain",
      strain: 2,
      fell: 0,
    });
    expect(cells[3][5]).toEqual({
      kind: "beryl",
      cut: "brilliant",
      strain: 0,
      fell: 0,
    });
    expect(cells[5][2]).toEqual({
      kind: "sapphire",
      cut: "star",
      strain: 2,
      fell: 0,
    });
    expect(cells[6][4]).toEqual({
      kind: null,
      cut: "prism",
      strain: 0,
      fell: 0,
    });
    expect(tokenAt(example, 6, 4)).toBe("R3");
  });

  it("refuses a board that is not eight rows of eight tokens", () => {
    expect(() => parseRows(quietBoard().slice(1))).toThrow(/Expected: 8 rows/);
    const short = ["R0 A0 C0", ...quietBoard().slice(1)];
    expect(() => parseRows(short)).toThrow(/Expected: 8 tokens in row 0/);
  });
});

/* -------------------------------------------------------------------------- */
/* The fixtures                                                               */
/* -------------------------------------------------------------------------- */

describe("the fixtures are the boards they claim to be", () => {
  it("poses a quiet board that carries no maximal run", () => {
    const rows = quietBoard();
    expect(rows.length).toBe(GRID_ROWS);
    expect(maximalRuns(rows)).toEqual([]);
    expect(hasAnyRun(rows)).toBe(false);
    // Every gem on it is plain at strain 0, so a scenario's own cells are the
    // only cuts and the only strain on the board.
    for (const gem of parseRows(rows).flat()) {
      expect(gem.cut).toBe("plain");
      expect(gem.strain).toBe(0);
    }
  });

  it("keeps the quiet board quiet around the cells a scenario writes", () => {
    const rows = quietRowsWith([
      { col: 1, row: 1, token: "R0" },
      { col: 2, row: 1, token: "R0" },
    ]);
    expect(tokenAt(rows, 1, 1)).toBe("R0");
    expect(tokenAt(rows, 2, 1)).toBe("R0");
    expect(hasAnyRun(rows)).toBe(false);
    // Two of a kind is not a run, and the third makes one: that is R4's
    // MATCH_MIN, and it is what every scenario in this suite is built on.
    expect(
      hasAnyRun(
        quietRowsWith([
          { col: 1, row: 1, token: "R0" },
          { col: 2, row: 1, token: "R0" },
          { col: 3, row: 1, token: "R0" },
        ]),
      ),
    ).toBe(true);
  });

  it("poses a dead board with no run, no prism and no legal swap", () => {
    const rows = deadBoard();
    expect(hasAnyRun(rows)).toBe(false);
    expect(hasPrism(rows)).toBe(false);
    expect(legalSwapExists(rows)).toBe(false);
  });

  it("finds the one legal swap a scenario arranges", () => {
    const rows = quietRowsWith([
      { col: 1, row: 1, token: "R0" },
      { col: 2, row: 1, token: "R0" },
      { col: 3, row: 2, token: "R0" },
    ]);
    expect(legalSwapExists(rows)).toBe(true);
    expect(swapWouldMatch(rows, { col: 3, row: 1 }, { col: 3, row: 2 })).toBe(
      true,
    );
    // A pair well away from the arrangement makes nothing.
    expect(swapWouldMatch(rows, { col: 6, row: 6 }, { col: 7, row: 6 })).toBe(
      false,
    );
  });

  it("accepts a swap that moves a prism, whatever it would match", () => {
    // R3 accepts a swap when either cell holds a prism, so a board carrying one
    // is never dead.
    const rows = quietRowsWith([{ col: 4, row: 4, token: "X0" }]);
    expect(hasAnyRun(rows)).toBe(false);
    expect(legalSwapExists(rows)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The comparison                                                             */
/* -------------------------------------------------------------------------- */

describe("comparing two written boards", () => {
  it("accepts a board that agrees cell for cell", () => {
    expect(() => assertBoardEquals(quietBoard(), quietBoard())).not.toThrow();
  });

  it("lets a wildcard stand for a cell the refill decides", () => {
    const posed = quietRowsWith([{ col: 0, row: 0, token: "X2" }]);
    const expected = maskBoard(posed, [{ col: 0, row: 0 }]);
    expect(expected[0].startsWith("X2 ..")).toBe(true);
    // Everything but the kept cell is a wildcard, so a different board with the
    // same kept cell still agrees.
    const other = withRow(posed, 3, [
      "R1",
      "A1",
      "C1",
      "J1",
      "B1",
      "S1",
      "M1",
      "R1",
    ]);
    expect(() => assertBoardEquals(other, expected)).not.toThrow();
  });

  it("names the first differing cell", () => {
    const actual = quietBoard();
    const expected = quietRowsWith([{ col: 3, row: 5, token: "J1" }]);
    expect(() => assertBoardEquals(actual, expected)).toThrow(/\(3,5\)/);
    // One line each, so the runner still reads a two-line pair.
    try {
      assertBoardEquals(actual, expected);
    } catch (error) {
      const message = (error as Error).message;
      expect(message.split("\n")).toHaveLength(2);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The geometry                                                               */
/* -------------------------------------------------------------------------- */

describe("the cell geometry", () => {
  it("puts the centers where specs/board.md says they run", () => {
    expect(cellX(0)).toBe(388);
    expect(cellX(GRID_COLS - 1)).toBe(892);
    expect(cellY(0)).toBe(144);
    expect(cellY(GRID_ROWS - 1)).toBe(648);
    expect(cellCenter(0, 0)).toEqual({ x: 388, y: 144 });
    expect(cellCenter(7, 7)).toEqual({ x: 892, y: 648 });
    // Adjacent centers are one pitch apart on both axes.
    expect(cellX(1) - cellX(0)).toBe(72);
    expect(cellY(1) - cellY(0)).toBe(72);
  });

  it("puts the midpoint of two neighbors exactly GEM_HIT_R from both", () => {
    for (const [a, b] of [
      [
        { col: 2, row: 3 },
        { col: 3, row: 3 },
      ],
      [
        { col: 2, row: 3 },
        { col: 2, row: 4 },
      ],
    ]) {
      const point = betweenCells(a, b);
      const first = cellCenter(a.col, a.row);
      const second = cellCenter(b.col, b.row);
      expect(Math.hypot(point.x - first.x, point.y - first.y)).toBe(GEM_HIT_R);
      expect(Math.hypot(point.x - second.x, point.y - second.y)).toBe(
        GEM_HIT_R,
      );
    }
  });

  it("puts an off-board point out of every cell's reach", () => {
    const point = offBoardPoint();
    expect(distanceToNearestCell(point.x, point.y)).toBeGreaterThan(GEM_HIT_R);
  });

  it("keeps an inside-cell offset within GEM_HIT_R, and refuses one that is not", () => {
    const point = insideCell(4, 4, 10, -10);
    expect(distanceToNearestCell(point.x, point.y)).toBeLessThan(GEM_HIT_R);
    expect(() => insideCell(4, 4, GEM_HIT_R, 0)).toThrow(/Expected:/);
  });
});

/* -------------------------------------------------------------------------- */
/* The pixel instrument                                                       */
/* -------------------------------------------------------------------------- */

/** A patch of one flat color, for the instrument's own arithmetic. */
function flatPatch(r: number, g: number, b: number, size = 4): Patch {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { half: size / 2, width: size, height: size, data };
}

describe("counting frames for a duration", () => {
  it("stops strictly short of the duration it is given", () => {
    // The one duration the suite writes both counts down for by hand, so the
    // arithmetic here is held against a figure a reader can check.
    expect(framesShortOf(REFUSAL_SECONDS)).toBe(REFUSAL_FRAMES_BEFORE);
    expect(framesShortOf(REFUSAL_SECONDS) * TICK_S).toBeLessThan(
      REFUSAL_SECONDS,
    );
    // A duration that is an exact whole number of frames still stops short.
    expect(framesShortOf(16 * TICK_S)).toBe(15);
    expect(framesShortOf(0)).toBe(0);
  });

  it("carries a whole frame past the duration it is given", () => {
    expect(framesPast(REFUSAL_SECONDS)).toBeGreaterThanOrEqual(
      REFUSAL_FRAMES_AFTER,
    );
    // A whole frame beyond, so a build comparing `>` has fired as surely as one
    // comparing `>=`, and at most two, so the drive is nowhere near a second
    // threshold of the same length.
    for (const seconds of [0.18, 0.25, 0.3, 0.42, 16 * TICK_S]) {
      const covered = framesPast(seconds) * TICK_S;
      expect(covered).toBeGreaterThan(seconds + TICK_S - 1e-9);
      expect(covered).toBeLessThan(seconds + 2 * TICK_S + 1e-9);
    }
  });

  it("sizes a step's drive from the hold that step reports", () => {
    // The three fields the drive is computed from, as a snapshot. A cast rather
    // than a whole snapshot because the function reads exactly these three and a
    // fabricated board would say nothing about which.
    const timing = (
      phase: Phase,
      stepHold: number,
      stepTimer: number,
    ): FacetSnapshot =>
      ({ phase, stepHold, stepTimer }) as unknown as FacetSnapshot;

    // A step's hold is the step's own figure, so the drive is read off the
    // snapshot rather than fixed.
    expect(stepDriveFrames(timing("resolving", STEP_SECONDS, 0))).toBe(
      framesPast(STEP_SECONDS),
    );

    // What has already run comes off the drive, so the overshoot past the
    // boundary stays inside two frames however deep into the hold this is asked.
    expect(
      stepDriveFrames(timing("resolving", STEP_SECONDS, STEP_SECONDS / 2)),
    ).toBe(framesPast(STEP_SECONDS / 2));

    // A swap in motion is timed by SWAP_SECONDS instead, and is the one case
    // the hold has nothing to say about.
    expect(stepDriveFrames(timing("swapping", STEP_SECONDS, 0))).toBe(
      SWAP_DRIVE_FRAMES,
    );
  });
});

describe("the patch instrument", () => {
  it("reads two identical patches as no distance at all", () => {
    expect(patchDistance(flatPatch(10, 20, 30), flatPatch(10, 20, 30))).toBe(0);
  });

  it("reads black against white as the full range", () => {
    expect(
      patchDistance(flatPatch(0, 0, 0), flatPatch(255, 255, 255)),
    ).toBeCloseTo(Math.hypot(255, 255, 255), 6);
  });

  it("measures a difference in one channel alone", () => {
    expect(patchDistance(flatPatch(0, 0, 0), flatPatch(30, 0, 0))).toBeCloseTo(
      30,
      6,
    );
  });

  it("refuses two patches of different shapes", () => {
    expect(() =>
      patchDistance(flatPatch(0, 0, 0, 4), flatPatch(0, 0, 0, 6)),
    ).toThrow(/Expected:/);
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
});

/* -------------------------------------------------------------------------- */
/* Reading a frame's text                                                     */
/* -------------------------------------------------------------------------- */

describe("finding a string a frame drew", () => {
  /** A frame that drew each string as its own `fillText`. */
  const frame = (...strings: string[]): DrawCall[] =>
    strings.map((text) => ({
      kind: "call",
      method: "fillText",
      args: [text, 0, 0],
    }));

  it("lists the fill channel and then the stroke channel", () => {
    // A build that OUTLINES its title issues a `strokeText` and a `fillText` per
    // glyph, and a single list in true call order would read `F F A A C C E E
    // T T` — a run that spells nothing. Listed by channel, each channel spells
    // the copy on its own.
    const outlined: DrawCall[] = ["F", "A", "C", "E", "T"].flatMap((glyph) => [
      { kind: "call", method: "strokeText", args: [glyph, 0, 0] },
      { kind: "call", method: "fillText", args: [glyph, 0, 0] },
    ]);
    expect(drawnText(outlined)).toEqual([
      "F",
      "A",
      "C",
      "E",
      "T",
      "F",
      "A",
      "C",
      "E",
      "T",
    ]);
    expect(drewText(outlined, TITLE_TEXT)).toBe(true);
  });

  it("finds a heading a build drew one letter at a time", () => {
    // A letter-spaced title is drawn glyph by glyph, so a per-string search
    // would report a screen showing exactly the right word as showing none of
    // it.
    const calls = frame("F", "A", "C", "E", "T");
    expect(drewText(calls, "FACET")).toBe(true);
    expect(drewText(calls, "facet")).toBe(true);
  });

  it("finds a line a build drew one word at a time", () => {
    expect(drewText(frame("HOW", "TO", "PLAY"), "HOW TO PLAY")).toBe(true);
  });

  it("finds a label a build drew with its value in one call", () => {
    expect(showsText(["SCORE 120"], HUD_SCORE_LABEL)).toBe(true);
    expect(showsText(["> PLAY <"], TITLE_ITEMS[0])).toBe(true);
  });

  it("does not find a string the frame never drew", () => {
    expect(drewText(frame("SCORE", "LEVEL"), "PAUSED")).toBe(false);
    expect(showsText(["SCORE", "0", "LEVEL", "1"], TITLE_TEXT)).toBe(false);
    expect(showsText(["SCORE", "0", "LEVEL", "1"], TAGLINE_TEXT)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The replay document                                                        */
/* -------------------------------------------------------------------------- */

describe("re-tabling a recording", () => {
  it("rewrites a field named __proto__ as a field", () => {
    // The tables a recording carries are rebuilt out of the frames that
    // survived thinning, and every value inside one is rewritten as it is
    // reached. A field named `__proto__` written with an assignment reaches the
    // prototype setter instead of becoming a field, so the rewrite would
    // silently drop it and replace the object's prototype with whatever it
    // held.
    const held = JSON.parse('{"__proto__": {"tainted": true}}') as Record<
      string,
      never
    >;
    const recording: Recording = {
      format: 1,
      width: 8,
      height: 8,
      background: null,
      images: [],
      resources: [],
      ops: [{ op: "set", property: "fillStyle", value: held }],
      states: [
        {
          properties: held,
          transform: null,
          lineDash: null,
          clip: [],
          path: [],
        },
      ],
      frames: [
        {
          count: 1,
          timeMs: 8,
          deltaMs: 8,
          surface: { width: 8, height: 8 },
          state: 0,
          stack: [],
          ops: [0],
        },
      ],
    };

    const rewritten = retable(recording, recording.frames);
    const written = (rewritten.ops[0] as { value: object }).value;
    expect(Object.prototype.hasOwnProperty.call(written, "__proto__")).toBe(
      true,
    );
    expect(Object.getPrototypeOf(written)).toBe(Object.prototype);
    const properties = rewritten.states[0].properties;
    expect(Object.prototype.hasOwnProperty.call(properties, "__proto__")).toBe(
      true,
    );
    expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
  });

  it("drops what no kept frame names", () => {
    const op = (method: string) => ({ op: "call", method, args: [] }) as const;
    const state = {
      properties: {},
      transform: null,
      lineDash: null,
      clip: [],
      path: [],
    };
    const frame = (count: number, ops: number[]) => ({
      count,
      timeMs: count * 10,
      deltaMs: 10,
      surface: { width: 8, height: 8 },
      state: 0,
      stack: [],
      ops,
    });
    const recording: Recording = {
      format: 1,
      width: 8,
      height: 8,
      background: null,
      images: [],
      resources: [],
      ops: [op("fill"), op("stroke"), op("clip")],
      states: [state, state],
      frames: [frame(1, [0]), frame(2, [1]), frame(3, [2])],
    };

    const kept = retable(recording, [recording.frames[0], recording.frames[2]]);
    expect(kept.frames.length).toBe(2);
    // Two operations survive, and each kept frame's index addresses the table
    // it was interned into rather than the one it came from.
    expect(kept.ops.length).toBe(2);
    expect(kept.states.length).toBe(1);
    for (const held of kept.frames) {
      for (const index of held.ops) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(kept.ops.length);
      }
      expect(held.state).toBeLessThan(kept.states.length);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The harness, over a real build                                             */
/* -------------------------------------------------------------------------- */

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/** Where this file's own outputs land: the staged project, then this suite. */
const SUITE_DIR = join("validation", "harness.test.ts");

/**
 * A board on which exactly one swap — `(3, 1)` against `(3, 2)` — completes a
 * run, and that run is exactly three rubies along row 1.
 *
 * It is the quiet filler with two rubies written beside the cell the swap
 * brings a third into, so what it clears, what it strains, and what falls into
 * the gap all follow from specs/rules.md rather than from the seed.
 */
function threeInARow(): string[] {
  return quietRowsWith([
    { col: 1, row: 1, token: "R0" },
    { col: 2, row: 1, token: "R0" },
    { col: 3, row: 1, token: "C0" },
  ]);
}

describe("the harness stands a build up", () => {
  let mediaDir: string;
  let collecting: string | undefined;
  let h: Harness;

  beforeEach(async () => {
    collecting = process.env[MEDIA_DIR_ENV];
    mediaDir = mkdtempSync(join(tmpdir(), "facet-replay-"));
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

  it("reaches the build's surface and reads a snapshot off it", async () => {
    // `specs/instrumentation.md` puts the version on the surface AND in the
    // snapshot, so both readers are exercised and both must answer the same
    // number.
    expect(await h.debugVersion()).toBe(FACET_DEBUG_VERSION);
    const snapshot = h.snapshot();
    expect(snapshot.version).toBe(FACET_DEBUG_VERSION);
    expect(snapshot.screen).toBe("title");
    expect(snapshot.board.cells).toEqual([]);
    expect(snapshot.score).toBe(0);
    expect(snapshot.level).toBe(1);
    expect(snapshot.levelTarget).toBe(LEVEL_TARGET_STEP);
  });

  it("poses the written board exactly, and reads it back as notation", () => {
    const posed = threeInARow();
    const snapshot = loadBoard(h, posed);
    expect(snapshot.screen).toBe("playing");
    expect(snapshot.phase).toBe("idle");
    assertBoardEquals(renderBoard(snapshot), posed);
    // A posed board sits where a dealt board sits.
    const first = snapshot.board.cells.find(
      (cell) => cell.col === 0 && cell.row === 0,
    );
    expect(first?.x).toBe(cellX(0));
    expect(first?.y).toBe(cellY(0));
  });

  it("refuses a fixture whose token the notation does not name", () => {
    // The rows are parsed on this side FIRST, so a typo fails the FIXTURE with
    // the token it could not read rather than crossing into the build and
    // failing it for a mistake the check made. The board the build already held
    // is still standing afterwards, so nothing half-posed reaches a later check.
    const rows = quietBoard();
    loadBoard(h, rows);
    const before = renderBoard(h.snapshot());
    const typo = [
      ["Z9", ...rows[0].split(" ").slice(1)].join(" "),
      ...rows.slice(1),
    ];
    expect(() => loadBoard(h, typo)).toThrow(/Expected:/);
    assertBoardEquals(renderBoard(h.snapshot()), before);
  });

  it("rests until a swap is accepted, and advances no frame on a pose", () => {
    const posed = poseBoard(h, [{ col: 4, row: 4, token: "X0" }]);
    const before = h.frame();
    expect(posed.stepTimer).toBe(0);
    expect(posed.chainStep).toBe(0);
    expect(h.frame()).toBe(before);
  });

  it("holds an accepted swap in motion before step 1 resolves", async () => {
    // specs/rules.md exchanges the two cells at once, sets `phase` to
    // `swapping`, and clears nothing until SWAP_SECONDS of game time has passed
    // — so the two helpers read two different moments and a check that reached
    // for the wrong one would be reading a board no step has touched.
    loadBoard(h, threeInARow());
    const requested = requestSwap(h, { col: 3, row: 1 }, { col: 3, row: 2 });
    expect(requested.phase).toBe("swapping");
    expect(requested.chainStep).toBe(0);
    expect(requested.lastCleared).toBe(0);
    // The exchange itself happened at the request: the ruby the filler holds at
    // (3,2) is standing at (3,1), completing the run that step 1 will take.
    expect(tokenAt(renderBoard(requested), 3, 1)).toBe("R0");
    expect(tokenAt(renderBoard(requested), 3, 2)).toBe("C0");

    const stepped = await advanceStep(h);
    expect(stepped.phase).toBe("resolving");
    expect(stepped.chainStep).toBe(1);
    expect(stepped.lastCleared).toBe(3);
  });

  it("clears a run of three, scores it, strains its neighbors and settles", async () => {
    loadBoard(h, threeInARow());

    // Carried through the swap animation, this reading is step 1: three clean
    // rubies at multiplier 1.
    const first = await swapAndStep(h, { col: 3, row: 1 }, { col: 3, row: 2 });
    expect(first.phase).toBe("resolving");
    expect(first.chainStep).toBe(1);
    expect(first.multiplier).toBe(1);
    expect(first.lastCleared).toBe(3);
    expect(first.lastPoints).toBe(3 * BASE_SCORE);
    expect(first.score).toBe(3 * BASE_SCORE);
    expect(first.levelScore).toBe(3 * BASE_SCORE);

    // What the step left on the board, cell by cell, from R7 and R9: the three
    // gems that stood above the cleared row have fallen into it carrying the
    // strain their being beside the clear set gave them, and every other
    // neighbor of the clear set carries one strain. The refilled cells along
    // the top are the seeded generator's business and are wildcards.
    assertBoardEquals(renderBoard(first), [
      ".. .. .. .. .. .. .. ..",
      "C1 A1 C1 J1 M1 .. .. ..",
      ".. S1 M1 C1 .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
    ]);

    const settled = await resolveChain(h);
    expect(settled.settled).toBe(true);
    expect(settled.snapshot.phase).toBe("idle");
    expect(settled.snapshot.chainStep).toBe(0);
    expect(settled.snapshot.stepTimer).toBe(0);
    // Nothing was taken away by settling: the chain only ever adds.
    expect(settled.snapshot.score).toBeGreaterThanOrEqual(3 * BASE_SCORE);
    // Every cell holds a gem once a step settles (R9).
    expect(settled.snapshot.board.cells.length).toBe(GRID_COLS * GRID_ROWS);
  });

  it("advances exactly the frames and the game time it is asked for", async () => {
    loadBoard(h, threeInARow());
    const before = h.snapshot();
    const frame = h.frame();

    await h.advance(10);

    expect(h.frame()).toBe(frame + 10);
    expect(h.snapshot().simTime - before.simTime).toBeCloseTo(
      (10 * TICK_MS) / 1000,
      9,
    );

    // The same second of game time, in one frame and in sixty.
    const at = h.snapshot().simTime;
    await h.advanceSeconds(1, 60);
    expect(h.snapshot().simTime - at).toBeCloseTo(1, 9);
  });

  it("records the frame the build drew, and reads its pixels", async () => {
    loadBoard(h, threeInARow());
    const calls = await h.frameCalls();
    expect(calls.length).toBeGreaterThan(0);

    const patch = h.patch(0, 0);
    expect(patch.width).toBe(patch.height);
    expect(patch.data.length).toBe(patch.width * patch.height * 4);
    // The instrument reads the same cell as itself as unchanged.
    expect(patchDistance(patch, h.patch(0, 0))).toBe(0);
  });

  it("reads one box shape at a board edge and at its middle", async () => {
    // The box is the same shape wherever the cell sits: at a canvas edge the
    // ORIGIN slides inward rather than the box shrinking. `patchDistance` is a
    // MEAN over the box, so two readings of one cell answer for what was drawn
    // in it rather than for how the box was cut. A `half` of 120 logical units
    // runs off the bottom of the 1280x720 stage at the last row, which is what
    // makes this readable at all.
    loadBoard(h, quietBoard());
    await h.advance(1);
    const middle = h.patch(3, 3, 120);
    const corner = h.patch(7, 7, 120);
    expect(middle.width).toBe(241);
    expect(middle.height).toBe(241);
    expect(corner.width).toBe(middle.width);
    expect(corner.height).toBe(middle.height);
    // And two boxes of one shape are comparable, which is the whole point.
    expect(patchDistance(middle, corner)).toBeGreaterThanOrEqual(0);
  });

  it("writes a captured section as gzip and hands the value back", async () => {
    loadBoard(h, threeInARow());
    const frames = await captureReplay(h, "chain", async () => {
      await swapAndStep(h, { col: 3, row: 1 }, { col: 3, row: 2 });
      await resolveChain(h);
      return 7;
    });

    expect(frames).toBe(7);
    expect(written()).toEqual(["chain.json.gz"]);
    const bytes = readFileSync(join(mediaDir, SUITE_DIR, "chain.json.gz"));
    // The framing read off the bytes rather than off the name: a gzip member
    // opens `0x1f 0x8b` (RFC 1952).
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    const recording = JSON.parse(
      gunzipSync(bytes).toString("utf8"),
    ) as Recording;
    expect(recording.format).toBeGreaterThan(0);
    expect(recording.frames.length).toBeGreaterThan(0);
    expect(recording.frames.length).toBeLessThanOrEqual(MAX_REPLAY_FRAMES);
  });

  it("writes nothing at all for a section that drew no frames", async () => {
    await captureReplay(h, "nothing", () => undefined);
    expect(written()).toEqual([]);
  });

  it("delivers a real pointer press and a real key press to the game", async () => {
    // The debug surface's own pointer operations take effect at the call, which
    // is what a check about the press rules uses. These two are the OTHER path:
    // the events the engine listens for, delivered inside a frame's `update`,
    // which is the only way an event a build answers with a cue can be seen —
    // specs/ui.md fixes that a cue is played by a frame and never by a pose.
    loadBoard(h, threeInARow());
    const center = cellCenter(2, 2);

    h.press(center.x, center.y);
    await h.advance(1);
    expect(h.snapshot().selection).toEqual({ col: 2, row: 2 });
    expect(h.snapshot().pointer.down).toBe(true);
    expect(h.snapshot().pointer.x).toBeCloseTo(center.x, 6);

    h.lift();
    await h.advance(1);
    expect(h.snapshot().pointer.down).toBe(false);

    // specs/controls.md binds `mute` to KeyM for a build of every engine.
    const muted = h.snapshot().muted;
    await h.tap("KeyM");
    expect(h.snapshot().muted).toBe(!muted);

    // The same press written at the level the checklist writes at.
    await h.tapAction("mute");
    expect(h.snapshot().muted).toBe(muted);
  });

  it("plays a move as the whole gesture, and never as a shortcut", async () => {
    // specs/controls.md plays a move by taking hold of a gem, carrying it onto a
    // neighbor, and letting go: the RELEASE is what requests the swap. The
    // gesture helper goes through `pointerDown`, `pointerMove` and `pointerUp`
    // and through nothing else, so what decides the outcome is the build's own
    // press, move and release rules.
    loadBoard(h, threeInARow());
    const played = dragGem(h, { col: 3, row: 2 }, { col: 3, row: 1 });

    // The release requested the swap and let the gem go.
    expect(played.phase).toBe("swapping");
    expect(played.offer).toBeNull();
    expect(played.selection).toBeNull();

    const settled = await resolveChain(h);
    expect(settled.settled).toBe(true);
    expect(settled.snapshot.score).toBeGreaterThanOrEqual(3 * BASE_SCORE);
  });

  it("takes a reported pointer target, by mouse and by touch", async () => {
    // A target's rectangle is the BUILD's, so a check reads the one it is going
    // to press off the snapshot. specs/instrumentation.md fixes that pressing
    // and releasing at a listed target's center takes that target.
    const play = targetById(h.snapshot(), "menu-0");
    expect(play.w).toBeGreaterThan(0);
    const opened = takeTarget(h, play, "touch");
    expect(opened.screen).toBe("playing");
    expect(opened.pointer.device).toBe("touch");

    // And a target the screen does not carry fails as the fixture error it is,
    // naming the ids that were reported.
    expect(() => targetById(opened, "menu-1")).toThrow(/Expected:/);
  });

  it("reaches the surface with no fault, and reflects over it", async () => {
    expect(h.surfaceFault).toBeNull();
    const ops = await h.probe(["snapshot", "loadBoard", "nothingLikeThis"]);
    expect(ops.snapshot).toBe("function");
    expect(ops.loadBoard).toBe("function");
    // A name the surface does not carry is reported, not thrown: that is what
    // lets `instrumentation/debug-api-operations-present` decide an operation by
    // `typeof`.
    expect(ops.nothingLikeThis).toBe("undefined");
  });

  it("refuses a frame count that is not a whole number of frames", async () => {
    // A fixture error fails as one, the rule `loadBoard` follows: a count below
    // one, or a fractional count, is a mistake in the check rather than a
    // verdict about the build.
    await expect(h.advanceSeconds(1, 0)).rejects.toThrow(/Expected:/);
    await expect(h.advanceSeconds(1, 2.5)).rejects.toThrow(/Expected:/);
  });

  it("keeps the copy specs/ui.md fixes readable off the title frame", async () => {
    // specs/ui.md fixes the COPY and nothing about how many calls a build spends
    // on it, so this is the reading `showsText` makes rather than an assertion
    // about draw calls. The reference draws each heading one glyph per call; a
    // build that drew each in a single call reads exactly the same way.
    const pieces = await h.frameText();
    expect(showsText(pieces, TITLE_TEXT)).toBe(true);
    expect(showsText(pieces, TAGLINE_TEXT)).toBe(true);
    expect(showsText(pieces, TITLE_ITEMS[0])).toBe(true);
    expect(showsText(pieces, TITLE_ITEMS[1])).toBe(true);
  });

  it("keeps the HUD's own labels readable off a playing frame", async () => {
    startRound(h);
    const pieces = await h.frameText();
    expect(showsText(pieces, HUD_SCORE_LABEL)).toBe(true);
    expect(showsText(pieces, HUD_LEVEL_LABEL)).toBe(true);
    // And the reading is not a blanket yes: the title's tagline is not here.
    expect(showsText(pieces, TAGLINE_TEXT)).toBe(false);
  });

  it("waits until the build has actually made a sound", async () => {
    // specs/assets.md has the produced `.wav`s decoded asynchronously, so a
    // build whose first frames are silent is conformant and a cue check that
    // read the very first event would be reading the decoder.
    expect(await h.warmAudio()).toBe(true);
    expect(h.cues.length + h.loops.length).toBeGreaterThan(0);
  });
});
