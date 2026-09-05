// harness — the case-owned code every validator in this directory rests on.
//
// The suites next door are validators: each decides one review point against the
// build. THIS FILE DECIDES NO REVIEW POINT, and no review item names it, so a run
// never loads it. It runs with the whole project, which is how a case author runs
// these suites while writing them:
//
//   npx vitest run --config validation/vitest.config.ts
//
// What it checks is the case's own machinery, in two parts.
//
// THE PURE HALF. The board notation, the fixtures, the geometry and the replay
// writer. Every one of these is a thing a validator TRUSTS: `quietBoard()` is
// asserted by every scenario to carry no run, `deadBoard()` is asserted by the
// game-over point to carry no legal swap, `betweenCells` is asserted to lie
// exactly `GEM_HIT_R` from two centers, and a wildcard in `assertBoardEquals` is
// what keeps a check off the cells R9's refill makes unpredictable. A fixture
// that quietly stopped being any of those would not fail here; it would make a
// dozen points decide the wrong thing. So each is proved rather than argued.
//
// THE PLUMBING HALF. That the harness can actually stand a build up: connect to
// the served site, find the surface, pose a written board, request a swap, carry
// the chain to its end, and read the outcome back. That reaches through the
// reference build, which is why it is here rather than in a suite — the readings
// it asserts are the harness's own plumbing (the board came back in the notation
// it went in as; a driven chain settles; a captured section reaches disk), not the
// build's conformance, and none of them is a point.

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  BASE_SCORE,
  CELL_PITCH,
  GAMEOVER_TITLE_TEXT,
  HUD_LEVEL_LABEL,
  HUD_SCORE_LABEL,
  PAUSED_TITLE_TEXT,
  REFUSAL_FRAMES_BEFORE,
  REFUSAL_SECONDS,
  STEP_SECONDS,
  SWAP_DRIVE_FRAMES,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
  GEM_HIT_R,
  GEM_KINDS,
  GRID_COLS,
  GRID_ROWS,
  FACET_DEBUG_VERSION,
  STAGE_H,
  STAGE_W,
  TICK_MS,
  TICK_S,
} from "./constants";
import {
  assertBoardEquals,
  betweenCells,
  cellCenter,
  cellX,
  cellY,
  deadBoard,
  formatToken,
  hasAnyRun,
  legalSwapExists,
  maskBoard,
  maximalRuns,
  offBoardPoint,
  parseRows,
  parseToken,
  quietBoard,
  quietRowsWith,
  renderCell,
  swapWouldMatch,
  tokenAt,
  tokenOf,
  WILDCARD,
} from "./board";
import {
  captureReplay,
  createHarness,
  cuesOnFrame,
  dragGem,
  drawOps,
  drawnText,
  drewText,
  framesPast,
  framesShortOf,
  loadBoard,
  patchDistance,
  poseBoardWithEscape,
  PROJECT_ROOT,
  REPLAY_BACKGROUND,
  REQUIRED_OPS,
  requestSwap,
  resolveChain,
  retable,
  showsText,
  siteRoot,
  STAGED_PROJECT_DIR,
  startRound,
  stepDriveFrames,
  swapAndResolve,
  swapAndStep,
  takeTarget,
  targetById,
  thinReplay,
  watchCues,
  WORKSPACE_ROOT,
  type DrawCall,
  type FacetSnapshot,
  type Harness,
  type Patch,
  type Phase,
  type RecordedFrame,
  type Recording,
} from "./harness";

/* -------------------------------------------------------------------------- */
/* The notation (specs/board.md)                                              */
/* -------------------------------------------------------------------------- */

it("reads every token specs/board.md names, and writes it back unchanged", () => {
  // The five the specification spells out by hand, plus one of every kind letter
  // and one of every strain digit, so no letter of the table is untested.
  const stated: [string, string | null, number, string][] = [
    ["R0", "ruby", 0, "plain"],
    ["J3", "jade", 3, "plain"],
    ["S1b", "sapphire", 1, "brilliant"],
    ["C0s", "citrine", 0, "star"],
    ["X0", null, 0, "prism"],
  ];
  for (const [token, kind, strain, cut] of stated) {
    const gem = parseToken(token);
    expect(gem.kind, token).toBe(kind);
    expect(gem.strain, token).toBe(strain);
    expect(gem.cut, token).toBe(cut);
    expect(formatToken(gem), token).toBe(token);
  }

  const letters = ["R", "A", "C", "J", "B", "S", "M"];
  letters.forEach((letter, index) => {
    expect(parseToken(`${letter}0`).kind, letter).toBe(GEM_KINDS[index]);
    expect(tokenOf(GEM_KINDS[index], 0), letter).toBe(`${letter}0`);
  });
  for (let strain = 0; strain <= 3; strain += 1) {
    expect(formatToken(parseToken(`B${strain}`))).toBe(`B${strain}`);
    expect(formatToken(parseToken(`X${strain}`))).toBe(`X${strain}`);
  }
});

it("reads the whole example board of specs/board.md", () => {
  // The eight lines the specification prints, verbatim.
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
  const gems = parseRows(example);
  expect(gems).toHaveLength(GRID_ROWS);
  expect(gems[0]).toHaveLength(GRID_COLS);
  // The cells the example puts a non-default value on, read back by hand. Every
  // one of them carries a `fell` of `0`: the notation writes a board standing
  // still, so a gem read out of a token has traveled nowhere.
  expect(gems[1][1]).toEqual({
    kind: "jade",
    cut: "plain",
    strain: 1,
    fell: 0,
  });
  expect(gems[2][2]).toEqual({
    kind: "amethyst",
    cut: "plain",
    strain: 2,
    fell: 0,
  });
  expect(gems[3][5]).toEqual({
    kind: "beryl",
    cut: "brilliant",
    strain: 0,
    fell: 0,
  });
  expect(gems[4][6]).toEqual({
    kind: "ruby",
    cut: "plain",
    strain: 3,
    fell: 0,
  });
  expect(gems[5][2]).toEqual({
    kind: "sapphire",
    cut: "star",
    strain: 2,
    fell: 0,
  });
  expect(gems[6][4]).toEqual({
    kind: null,
    cut: "prism",
    strain: 0,
    fell: 0,
  });
  // And written back as it came in.
  expect(gems.map((row) => row.map(formatToken).join(" "))).toEqual(example);
  expect(tokenAt(example, 5, 3)).toBe("B0b");
});

it("refuses a token the notation does not name", () => {
  // A fixture typo has to fail the FIXTURE. A token that crossed into the page
  // unread would fail the build for a mistake the case made.
  for (const bad of ["Z0", "R", "R4", "R0x", "", "R0 A0", "X0b"]) {
    expect(() => parseToken(bad), bad).toThrow();
  }
});

/* -------------------------------------------------------------------------- */
/* The fixtures                                                               */
/* -------------------------------------------------------------------------- */

it("poses a filler board carrying no run at all", () => {
  // What every scenario written with `poseBoard` rests on: nothing on the board
  // matches anything except what the scenario itself placed. Proved against R4
  // rather than argued from the formula.
  const quiet = quietBoard();
  expect(quiet).toHaveLength(GRID_ROWS);
  expect(maximalRuns(quiet)).toEqual([]);
  // And every cell of it is a plain gem at strain 0, so a scenario's own strain
  // and cut are the only ones on the board.
  for (const row of parseRows(quiet)) {
    for (const gem of row) {
      expect(gem.cut).toBe("plain");
      expect(gem.strain).toBe(0);
      expect(gem.kind).not.toBeNull();
    }
  }
});

it("writes a scenario's own cells over the filler and leaves the rest", () => {
  const posed = quietRowsWith([
    { col: 2, row: 4, token: "R0" },
    { col: 4, row: 4, token: "R0" },
    { col: 3, row: 3, token: "R0" },
  ]);
  expect(tokenAt(posed, 2, 4)).toBe("R0");
  expect(tokenAt(posed, 4, 4)).toBe("R0");
  expect(tokenAt(posed, 3, 3)).toBe("R0");
  // Untouched cells still hold the filler.
  expect(tokenAt(posed, 0, 0)).toBe(tokenAt(quietBoard(), 0, 0));
  // Placing three isolated gems of one kind creates no run on its own, and the
  // swap the scenario is about creates exactly one.
  expect(maximalRuns(posed)).toEqual([]);
  expect(swapWouldMatch(posed, { col: 3, row: 3 }, { col: 3, row: 4 })).toBe(
    true,
  );
});

it("poses a board with no run, no prism and no legal swap", () => {
  // The end-of-round fixture. `specs/rules.md` ends a round when the board settles
  // with no legal swap on it, and a legal swap is R1 and R3 over an adjacent pair
  // — so this has to be provably dead under those two rules, not merely
  // dead-looking.
  const dead = deadBoard();
  expect(dead).toHaveLength(GRID_ROWS);
  expect(hasAnyRun(dead)).toBe(false);
  expect(legalSwapExists(dead)).toBe(false);
  for (const row of parseRows(dead)) {
    for (const gem of row) {
      expect(gem.cut).not.toBe("prism");
      expect(gem.strain).toBe(0);
    }
  }
});

it("finds the legal swap a live board carries", () => {
  // The other side of the same predicate: it has to answer `true` when a swap is
  // there, or the game-over point would pass a build that ended every round at
  // once.
  const live = quietRowsWith([
    { col: 2, row: 4, token: "R0" },
    { col: 4, row: 4, token: "R0" },
    { col: 3, row: 3, token: "R0" },
  ]);
  expect(legalSwapExists(live)).toBe(true);
  // And a prism makes a pair legal on its own, whatever the board around it, by
  // the second half of R3.
  const withPrism = quietRowsWith([{ col: 0, row: 0, token: "X0" }]);
  expect(legalSwapExists(withPrism)).toBe(true);
});

it("reads a maximal run only where R4 puts one", () => {
  const four = quietRowsWith([
    { col: 1, row: 2, token: "S0" },
    { col: 2, row: 2, token: "S0" },
    { col: 3, row: 2, token: "S0" },
    { col: 4, row: 2, token: "S0" },
  ]);
  const runs = maximalRuns(four);
  expect(runs).toHaveLength(1);
  expect(runs[0].kind).toBe("sapphire");
  expect(runs[0].horizontal).toBe(true);
  expect(runs[0].cells).toHaveLength(4);

  // Two of a kind is not a run.
  expect(
    maximalRuns(
      quietRowsWith([
        { col: 1, row: 2, token: "S0" },
        { col: 2, row: 2, token: "S0" },
      ]),
    ),
  ).toEqual([]);

  // A prism belongs to no kind and joins no run: three sapphires with a prism in
  // the middle is nothing at all.
  expect(
    maximalRuns(
      quietRowsWith([
        { col: 1, row: 5, token: "S0" },
        { col: 2, row: 5, token: "X0" },
        { col: 3, row: 5, token: "S0" },
        { col: 4, row: 5, token: "S0" },
      ]),
    ),
  ).toEqual([]);

  // A run is read down a column as well as along a row.
  const down = maximalRuns(
    quietRowsWith([
      { col: 6, row: 1, token: "M0" },
      { col: 6, row: 2, token: "M0" },
      { col: 6, row: 3, token: "M0" },
    ]),
  );
  expect(down).toHaveLength(1);
  expect(down[0].horizontal).toBe(false);

  // Kind alone decides a run: strain and cut do not break one.
  const mixed = maximalRuns(
    quietRowsWith([
      { col: 1, row: 6, token: "J0" },
      { col: 2, row: 6, token: "J3" },
      { col: 3, row: 6, token: "J1b" },
    ]),
  );
  expect(mixed).toHaveLength(1);
  expect(mixed[0].kind).toBe("jade");
});

/* -------------------------------------------------------------------------- */
/* Comparison and the wildcard                                                */
/* -------------------------------------------------------------------------- */

it("matches anything against a wildcard and nothing against a token", () => {
  // R9 refills from the game's own seeded generator, so a check states the cells
  // that survived and wildcards the rest. That is only sound if a wildcard really
  // matches whatever stands there AND a stated token really does not.
  const board = quietBoard();
  const masked = maskBoard(board, [
    { col: 0, row: 0 },
    { col: 7, row: 7 },
  ]);
  expect(tokenAt(masked, 0, 0)).toBe(tokenAt(board, 0, 0));
  expect(tokenAt(masked, 7, 7)).toBe(tokenAt(board, 7, 7));
  expect(tokenAt(masked, 3, 3)).toBe(WILDCARD);

  // A board that differs everywhere but the two kept cells still matches the mask.
  const elsewhere = quietRowsWith([
    { col: 3, row: 3, token: "X3" },
    { col: 4, row: 4, token: "S2b" },
  ]);
  expect(() => assertBoardEquals(elsewhere, masked)).not.toThrow();
  // And one that differs at a kept cell does not.
  const kept = quietRowsWith([{ col: 0, row: 0, token: "X0" }]);
  expect(() => assertBoardEquals(kept, masked)).toThrow(/\(0,0\)/);
});

it("names the first differing cell, and renders each board on one line", () => {
  // The runner stores a failure as an `Expected:`/`Actual:` PAIR and the console
  // renders that pair to a reviewer. A board rendered across eight lines would
  // arrive as eight lines of something the runner reads as one field, so both
  // boards go on one line each.
  const board = quietBoard();
  const changed = quietRowsWith([{ col: 5, row: 2, token: "X1" }]);
  let message = "";
  try {
    assertBoardEquals(changed, board, "after the swap");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).toMatch(/^Expected: /);
  expect(message.split("\n")).toHaveLength(2);
  expect(message).toContain("(5,2)");
  expect(message).toContain("after the swap");
  expect(message).toContain(" | ");
});

/* -------------------------------------------------------------------------- */
/* Geometry (specs/board.md)                                                  */
/* -------------------------------------------------------------------------- */

it("places every cell center where the board formulas put it", () => {
  // The specification states the two formulas and then states the range they
  // produce, so both are checked: the formulas against the stated range, and the
  // pitch between neighbors against `CELL_PITCH`.
  expect(cellX(0)).toBe(388);
  expect(cellX(GRID_COLS - 1)).toBe(892);
  expect(cellY(0)).toBe(144);
  expect(cellY(GRID_ROWS - 1)).toBe(648);
  for (let col = 1; col < GRID_COLS; col += 1) {
    expect(cellX(col) - cellX(col - 1), `col ${col}`).toBe(CELL_PITCH);
  }
  for (let row = 1; row < GRID_ROWS; row += 1) {
    expect(cellY(row) - cellY(row - 1), `row ${row}`).toBe(CELL_PITCH);
  }
  expect(cellCenter(3, 5)).toEqual({ x: cellX(3), y: cellY(5) });
  // Every center is on the stage, well inside it.
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const { x, y } = cellCenter(col, row);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(STAGE_W);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(STAGE_H);
    }
  }
});

it("puts the tie point exactly GEM_HIT_R from both centers", () => {
  // `specs/controls.md` settles a position lying exactly `GEM_HIT_R` from two
  // centers in favor of the lower row, and within one row the lower column. This
  // is the only position that poses that tie, so a check about it has to be
  // handed exactly this point and not a number of its own.
  const pairs: [{ col: number; row: number }, { col: number; row: number }][] =
    [
      [
        { col: 2, row: 3 },
        { col: 3, row: 3 },
      ],
      [
        { col: 2, row: 3 },
        { col: 2, row: 4 },
      ],
    ];
  for (const [a, b] of pairs) {
    const mid = betweenCells(a, b);
    const first = cellCenter(a.col, a.row);
    const second = cellCenter(b.col, b.row);
    expect(Math.hypot(mid.x - first.x, mid.y - first.y)).toBeCloseTo(
      GEM_HIT_R,
      9,
    );
    expect(Math.hypot(mid.x - second.x, mid.y - second.y)).toBeCloseTo(
      GEM_HIT_R,
      9,
    );
  }
});

it("puts the off-board point out of reach of every cell", () => {
  // The press that must target nothing. A point merely outside the grid's extent
  // would not do: it has to be farther than `GEM_HIT_R` from EVERY center.
  const point = offBoardPoint();
  let nearest = Infinity;
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const center = cellCenter(col, row);
      nearest = Math.min(
        nearest,
        Math.hypot(point.x - center.x, point.y - center.y),
      );
    }
  }
  expect(nearest).toBeGreaterThan(GEM_HIT_R);
  // And it is on the stage, so a build that clamps a pointer to the stage still
  // receives the press this poses.
  expect(point.x).toBeGreaterThanOrEqual(0);
  expect(point.x).toBeLessThanOrEqual(STAGE_W);
  expect(point.y).toBeGreaterThanOrEqual(0);
  expect(point.y).toBeLessThanOrEqual(STAGE_H);
});

/* -------------------------------------------------------------------------- */
/* The appearance instrument                                                  */
/* -------------------------------------------------------------------------- */

it("measures a patch difference as the mean per-pixel RGB distance", () => {
  // The whole of what the appearance points rest on. A patch is compared with the
  // SAME cell holding something else, so what this has to get right is the scale:
  // an identical picture is 0, and a picture that differs on some of its pixels
  // is the mean of those differences rather than their sum or their maximum.
  const flat = (r: number, g: number, b: number, size = 4): Patch => {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i += 1) {
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    }
    return { half: 1, width: size, height: size, data };
  };

  expect(patchDistance(flat(10, 20, 30), flat(10, 20, 30))).toBe(0);
  expect(patchDistance(flat(0, 0, 0), flat(3, 4, 0))).toBeCloseTo(5, 9);

  // Half the pixels changed by 5 is a mean of 2.5, not 5 and not 40.
  const half = flat(0, 0, 0);
  for (let i = 0; i < 8; i += 1) half.data[i * 4] = 5;
  expect(patchDistance(half, flat(0, 0, 0))).toBeCloseTo(2.5, 9);

  // Alpha is not part of it: a build is free to draw its gem on an opaque board.
  const opaque = flat(9, 9, 9);
  const clear = flat(9, 9, 9);
  for (let i = 0; i < 16; i += 1) clear.data[i * 4 + 3] = 0;
  expect(patchDistance(opaque, clear)).toBe(0);

  // Two patches of different shapes are not comparable, and say so.
  expect(() => patchDistance(flat(0, 0, 0, 4), flat(0, 0, 0, 5))).toThrow(
    /Expected: /,
  );
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
/* Reading the copy a frame put on screen                                     */
/* -------------------------------------------------------------------------- */

it("finds copy a frame drew, in every shape the specification permits", () => {
  // `specs/ui.md` fixes the copy each screen shows and fixes nothing about how it
  // is drawn — "Facet fixes no palette, no font" — so four conformant builds put
  // the same words on screen in shapes that share no string. All four have to
  // read as the copy being there, or a text point would be deciding a
  // typographic choice the specification handed the build.
  const whole = ["FACET", "PRESSURE FINDS THE FLAW", "PLAY", "HOW TO PLAY"];
  const perWord = "FACET PRESSURE FINDS THE FLAW PLAY HOW TO PLAY".split(" ");
  const perGlyph = "FACETPRESSUREFINDSTHEFLAWPLAYHOWTOPLAY".split("");
  const decorated = [
    "FACET",
    "PRESSURE FINDS THE FLAW",
    "> PLAY <",
    "HOW TO PLAY",
  ];
  for (const drawn of [whole, perWord, perGlyph, decorated]) {
    expect(showsText(drawn, TITLE_TEXT)).toBe(true);
    expect(showsText(drawn, TAGLINE_TEXT)).toBe(true);
    expect(showsText(drawn, "HOW TO PLAY")).toBe(true);
    // And copy that is NOT on screen is not found, which is the half a check
    // about a screen being absent rests on.
    expect(showsText(drawn, PAUSED_TITLE_TEXT)).toBe(false);
    expect(showsText(drawn, "NO MOVES LEFT")).toBe(false);
    expect(showsText(drawn, HUD_SCORE_LABEL)).toBe(false);
  }
  // A label drawn in the same call as its value still answers a check about the
  // label, since `specs/ui.md` fixes the readout and not the call it took.
  expect(showsText(["SCORE 120", "LEVEL 1"], HUD_SCORE_LABEL)).toBe(true);
  // Case and whitespace are taken out of both sides, so a build is free to draw
  // its own capitalisation and letter spacing.
  expect(showsText(["Score"], HUD_SCORE_LABEL)).toBe(true);
  expect(showsText(["S c o r e"], HUD_SCORE_LABEL)).toBe(true);
  expect(showsText([], HUD_SCORE_LABEL)).toBe(false);
});

it("lists a frame's text one channel at a time, so an outline still spells", () => {
  // The grouping in `drawnText` is load-bearing rather than incidental. A build
  // that outlines each glyph issues a `strokeText` and a `fillText` per letter,
  // and a single list in true call order would read `F F A A C C E E T T` — a run
  // that spells nothing. Listed by channel, each channel spells the copy alone.
  const outlined: DrawCall[] = [];
  for (const glyph of TITLE_TEXT.split("")) {
    outlined.push({ kind: "call", method: "strokeText", args: [glyph, 0, 0] });
    outlined.push({ kind: "call", method: "fillText", args: [glyph, 0, 0] });
  }
  expect(drawnText(outlined).join("")).toBe(
    `${TITLE_TEXT}${TITLE_TEXT}`.toUpperCase(),
  );
  expect(drewText(outlined, TITLE_TEXT)).toBe(true);
  expect(drewText(outlined, PAUSED_TITLE_TEXT)).toBe(false);
  // A set is not a draw, and a non-string first argument is not copy.
  expect(
    drawnText([
      { kind: "set", property: "font", value: "20px sans-serif" },
      { kind: "call", method: "fillText", args: [12, 0, 0] },
    ]),
  ).toEqual([]);
});

/* -------------------------------------------------------------------------- */
/* The replay writer                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A recording of `length` frames, one operation apiece, at the rate the suite
 * drives at.
 *
 * Stated rather than driven because the recorder in the page thins as the section
 * runs, so a driven section never hands the writer the exact multiple of the cap
 * its arithmetic turns on.
 */
function synthetic(length: number): Recording {
  const frames: RecordedFrame[] = [];
  for (let i = 0; i < length; i += 1) {
    frames.push({
      count: i + 1,
      timeMs: (i + 1) * TICK_MS,
      deltaMs: TICK_MS,
      surface: { width: STAGE_W, height: STAGE_H },
      state: 0,
      stack: [],
      ops: [i],
    });
  }
  return {
    format: 1,
    width: STAGE_W,
    height: STAGE_H,
    background: REPLAY_BACKGROUND,
    images: [],
    resources: [],
    // One operation of its own per frame, so what the tables are rebuilt out of is
    // the frames that survived rather than a single entry every frame shares.
    ops: frames.map((frame) => ({
      op: "call" as const,
      method: "fillRect",
      args: [frame.count, 0, 1, 1],
    })),
    states: [
      {
        properties: { fillStyle: "#f2f5f7" },
        transform: null,
        lineDash: null,
        clip: [],
        path: [],
      },
    ],
    frames,
  };
}

it("spends the replay budget on the section, never one frame past it", () => {
  // The stride the writer thins by rounds up, which puts the sharp edge of the cap
  // at a section whose length is an exact multiple of it. Both rules still hold
  // there: nothing over the cap, and the section's last frame written, because it
  // is the frame the check's sweep stopped at.
  for (const length of [599, 600, 601]) {
    const at = `${length} frames`;
    const frames = thinReplay(synthetic(length)).frames;

    expect(frames.length, at).toBeLessThanOrEqual(300);
    expect(frames[frames.length - 1].count - frames[0].count, at).toBe(
      length - 1,
    );
    // Displacing a frame leaves the deltas summing to the elapsed time.
    const elapsed = frames.reduce((sum, frame) => sum + frame.deltaMs, 0);
    expect(elapsed, at).toBeCloseTo(length * TICK_MS, 3);
  }
});

it("holds a thinned recording's tables to what its kept frames name", () => {
  // Dropping a frame drops the last reference to whatever only that frame drew
  // with, so a table carried over whole would put dead weight in a document whose
  // whole point is to say each thing once.
  const thinned = thinReplay(synthetic(1200));
  expect(thinned.frames.length).toBeLessThanOrEqual(300);
  expect(thinned.ops).toHaveLength(thinned.frames.length);
  for (const frame of thinned.frames) {
    for (const op of frame.ops) {
      expect(op).toBeGreaterThanOrEqual(0);
      expect(op).toBeLessThan(thinned.ops.length);
    }
    expect(frame.state).toBeGreaterThanOrEqual(0);
    expect(frame.state).toBeLessThan(thinned.states.length);
  }
});

it("rewrites a field named __proto__ as a field", () => {
  // A field named `__proto__` written with an assignment reaches the prototype
  // setter instead of becoming a field, so a rewrite that assigned would silently
  // drop it and replace the object's prototype with whatever it held. Handed to
  // the rewrite directly, because no browser can deliver one: Playwright's
  // serializer drops it on the way out of the page.
  const held = JSON.parse('{"__proto__": {"tainted": true}}') as object;
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
        properties: JSON.parse('{"__proto__": 1}') as Record<string, unknown>,
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
  expect(Object.prototype.hasOwnProperty.call(written, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(written)).toBe(Object.prototype);
  const properties = rewritten.states[0].properties;
  expect(Object.prototype.hasOwnProperty.call(properties, "__proto__")).toBe(
    true,
  );
  expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
});

/* -------------------------------------------------------------------------- */
/* The plumbing: the harness against a real build                             */
/* -------------------------------------------------------------------------- */

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/** Where this file's own outputs land, under the staged project directory. */
const SUITE_DIR = join("validation", "harness.test.ts");

let h: Harness;
let mediaDir: string | null = null;
const priorMediaDir = process.env[MEDIA_DIR_ENV];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
  if (mediaDir !== null) rmSync(mediaDir, { recursive: true, force: true });
  mediaDir = null;
  if (priorMediaDir === undefined) delete process.env[MEDIA_DIR_ENV];
  else process.env[MEDIA_DIR_ENV] = priorMediaDir;
});

it("reaches the surface the build installed", async () => {
  // The harness's first job. Everything else in this project is a call through
  // this, so a fault here would show up as fifty unrelated failures.
  expect(h.surfaceFault).toBeNull();
  const probed = await h.probe(REQUIRED_OPS);
  for (const op of REQUIRED_OPS) {
    expect(probed[op], op).toBe("function");
  }
  // `specs/instrumentation.md` puts the version on the surface AND in the
  // snapshot, so both readers are exercised and both must answer the same
  // number. `debugVersion` is the surface half, which under this engine is a
  // value on `window.__facet` rather than an operation to call.
  expect(await h.debugVersion()).toBe(FACET_DEBUG_VERSION);
  expect((await h.snapshot()).version).toBe(FACET_DEBUG_VERSION);
  expect(h.pageErrors).toEqual([]);
});

it("poses a written board and reads the same board back", async () => {
  // The one operation this whole suite is built on. `loadBoard` writes the
  // notation in and `board()` reads the notation out, so if the two do not agree
  // no scenario below can mean anything.
  const posed = quietRowsWith([
    { col: 2, row: 4, token: "R0" },
    { col: 4, row: 4, token: "R0" },
    { col: 3, row: 3, token: "R0" },
    { col: 0, row: 7, token: "S2b" },
    { col: 7, row: 0, token: "X1" },
  ]);
  const snapshot = await loadBoard(h, posed);
  expect(snapshot.screen).toBe("playing");
  expect(snapshot.phase).toBe("idle");
  expect(snapshot.board.cols).toBe(GRID_COLS);
  expect(snapshot.board.rows).toBe(GRID_ROWS);
  expect(snapshot.board.cells).toHaveLength(GRID_COLS * GRID_ROWS);
  assertBoardEquals(await h.board(), posed);
  // And the cells the snapshot reports carry the centers the formulas give.
  const cell = snapshot.board.cells.find((c) => c.col === 3 && c.row === 5);
  expect(cell).toBeDefined();
  expect({ x: cell?.x, y: cell?.y }).toEqual(cellCenter(3, 5));
});

it("drives a swap into a chain and carries it to the end", async () => {
  // The whole drive path in one: pose, request, resolve. The figures asserted are
  // the specification's — a run of three clean gems on chain step 1 clears three
  // cells and scores `3 * BASE_SCORE * 1` — and every one of them was computed
  // from `specs/rules.md` rather than read off this build.
  const posed = quietRowsWith([
    { col: 2, row: 4, token: "R0" },
    { col: 4, row: 4, token: "R0" },
    { col: 3, row: 3, token: "R0" },
  ]);
  const before = await loadBoard(h, posed);
  expect(before.score).toBe(0);
  expect(before.phase).toBe("idle");

  const { first, settled } = await swapAndResolve(
    h,
    { col: 3, row: 3 },
    { col: 3, row: 4 },
  );

  // Step 1, reached by carrying the accepted swap through its animation.
  expect(first.phase).toBe("resolving");
  expect(first.chainStep).toBe(1);
  expect(first.multiplier).toBe(1);
  expect(first.lastCleared).toBe(3);
  expect(first.lastPoints).toBe(3 * BASE_SCORE);
  expect(first.score).toBe(3 * BASE_SCORE);
  expect(first.levelScore).toBe(3 * BASE_SCORE);

  // R7 raised the strain of the two gems flanking the run, and R9 left the
  // untouched columns exactly as they were.
  expect(renderCell(first, 1, 4)).toBe("C1");
  expect(renderCell(first, 5, 4)).toBe("M1");
  expect(renderCell(first, 0, 0)).toBe("R0");
  expect(renderCell(first, 7, 7)).toBe("R0");

  // And the chain ends rather than running forever.
  expect(settled.settled).toBe(true);
  expect(settled.snapshot.phase).toBe("idle");
  expect(settled.snapshot.chainStep).toBe(0);
  expect(settled.snapshot.board.cells).toHaveLength(GRID_COLS * GRID_ROWS);
  expect(h.pageErrors).toEqual([]);
});

it("runs exactly the frames it was asked for", async () => {
  // The frame counter and the simulated clock are what every timing figure in this
  // suite is stated in, so they have to be the frames the game actually ran.
  await loadBoard(h, quietBoard());
  const opened = await h.snapshot();
  await h.advance(32);
  expect(h.frame()).toBe(32);
  expect(h.timeMs()).toBeCloseTo(32 * TICK_MS, 9);
  const later = await h.snapshot();
  // `simTime` accumulates the delta of every update, whatever the screen.
  expect(later.simTime - opened.simTime).toBeCloseTo((32 * TICK_MS) / 1000, 3);
});

it("writes a captured section to the running suite's own address", async () => {
  // Media is addressed by the STAGED path of the suite that produced it, taken
  // from the suite vitest is running rather than from anything the caller names,
  // so a check cannot write its evidence under another point's address.
  mediaDir = mkdtempSync(join(tmpdir(), "facet-media-"));
  process.env[MEDIA_DIR_ENV] = mediaDir;

  await loadBoard(h, quietBoard());
  const value = await captureReplay(h, "chain", async () => {
    await h.advance(4);
    return "handed back";
  });
  expect(value).toBe("handed back");

  const directory = join(mediaDir, SUITE_DIR);
  expect(readdirSync(directory)).toEqual(["chain.json.gz"]);
  const document = JSON.parse(
    gunzipSync(readFileSync(join(directory, "chain.json.gz"))).toString("utf8"),
  ) as Recording;
  expect(document.format).toBe(1);
  expect(document.width).toBe(STAGE_W);
  expect(document.height).toBe(STAGE_H);
  expect(document.background).toBe(REPLAY_BACKGROUND);
  // One kept frame per frame the game ran under the capture.
  expect(document.frames).toHaveLength(4);
});

it("costs nothing and changes nothing when no one is collecting", async () => {
  // The normal state of a suite an author is running by hand. A capture that
  // behaved differently here would let a check pass in one place and fail in the
  // other.
  delete process.env[MEDIA_DIR_ENV];
  await loadBoard(h, quietBoard());
  const value = await captureReplay(h, "chain", async () => {
    await h.advance(2);
    return 41 + 1;
  });
  expect(value).toBe(42);
  expect(h.frame()).toBe(2);
});

it("puts the copy of a screen where a check can read it", async () => {
  // `frameText` runs one frame and gathers what it put on screen from both places
  // an engineless build is allowed to draw it — `specs/assets.md` has the chrome
  // "drawn in code (canvas or DOM)" — so a check reads a screen's copy without
  // knowing which the build chose. Its DOM half reads what is RENDERED, so text
  // in a hidden element is not on screen and is not gathered.
  const title = await h.frameText();
  expect(showsText(title, TITLE_TEXT)).toBe(true);
  expect(showsText(title, TAGLINE_TEXT)).toBe(true);
  expect(showsText(title, PAUSED_TITLE_TEXT)).toBe(false);

  const calls = await h.frameCalls();
  expect(calls.length).toBeGreaterThan(0);
  expect(drawOps(calls)).toBeGreaterThan(0);
});

it("reads the copy of a real screen through the frame's own draw calls", async () => {
  // `drewText` over a REAL render, which is the reading every text point makes.
  // The unit test above proves the four shapes; this proves the helper against a
  // build that actually drew a screen, because a semantics that reads only one
  // shape passes a synthetic list and then answers false for every string on
  // every conformant build — which is exactly how a dead text predicate hides.
  const title = await h.frameCalls();
  for (const copy of [TITLE_TEXT, TAGLINE_TEXT, ...TITLE_ITEMS]) {
    expect(drewText(title, copy), copy).toBe(true);
  }
  // And the copy of a screen that is NOT showing is not found on it.
  expect(drewText(title, PAUSED_TITLE_TEXT)).toBe(false);
  expect(drewText(title, HUD_SCORE_LABEL)).toBe(false);

  await startRound(h);
  const playing = await h.frameCalls();
  for (const copy of [TITLE_TEXT, HUD_SCORE_LABEL, HUD_LEVEL_LABEL]) {
    expect(drewText(playing, copy), copy).toBe(true);
  }
  expect(drewText(playing, "HOW TO PLAY")).toBe(false);
  expect(drewText(playing, GAMEOVER_TITLE_TEXT)).toBe(false);
});

it("keeps a live log of everything the render and the network did", async () => {
  // The four standing readings a check reaches for without arranging anything.
  // `calls` grows with every frame driven, `requests` holds the whole of what the
  // page asked for rather than only what it failed to get, and a build served
  // whole fails nothing.
  await h.advance(2);
  expect(h.calls.length).toBeGreaterThan(0);
  expect(h.requests.some((url) => url.endsWith("/"))).toBe(true);
  expect(h.failedRequests).toEqual([]);
  expect(h.assetFailures).toEqual([]);
  // `frameCalls` clears the log and runs exactly one frame, so what it hands back
  // is that frame's own work and nothing before it.
  const one = await h.frameCalls();
  expect(h.calls).toEqual(one);
});

it("drives the menu from the keyboard, through the real input path", async () => {
  // `specs/controls.md` fixes the whole binding table for a build of every
  // engine, so an engineless build is driven by the same keys as one standing on
  // an engine and every action is pressable here. `tapAction` presses the
  // action's first binding, which is what a review item written as "fire the
  // `down` action" means. The keyboard drives the MENUS: the board is played
  // with the pointer alone.
  const opened = await h.snapshot();
  expect(opened.screen).toBe("title");
  expect(opened.menuIndex).toBe(0);

  await h.tapAction("down");
  expect((await h.snapshot()).menuIndex).toBe(1);

  // The highlight wraps, so `down` on the last item comes back to the first.
  await h.tapAction("down");
  expect((await h.snapshot()).menuIndex).toBe(0);

  // And `confirm` takes the highlighted item, which at index 0 is `PLAY`.
  await h.tapAction("confirm");
  expect((await h.snapshot()).screen).toBe("playing");
});

it("counts the frames that stop short of a duration, and that carry past it", () => {
  // A step's hold is the step's own figure rather than a constant, so a drive
  // across one is counted from a duration. The one duration the suite also
  // writes down by hand is what the arithmetic is held against.
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

it("holds an accepted swap in motion before step 1 resolves", async () => {
  // `specs/rules.md` exchanges the two cells at once, sets `phase` to
  // `swapping`, and clears nothing until `SWAP_SECONDS` of game time has passed
  // — so the request helper and the stepping helper read two different moments,
  // and a check that reached for the wrong one would be reading a board no step
  // has touched.
  const posed = quietRowsWith([
    { col: 2, row: 4, token: "R0" },
    { col: 4, row: 4, token: "R0" },
    { col: 3, row: 3, token: "R0" },
  ]);
  await loadBoard(h, posed);

  const requested = await requestSwap(
    h,
    { col: 3, row: 3 },
    { col: 3, row: 4 },
  );
  expect(requested.phase).toBe("swapping");
  expect(requested.chainStep).toBe(0);
  expect(requested.lastCleared).toBe(0);
  // The exchange itself happened at the request: the ruby is standing at (3,4).
  expect(tokenAt(await h.board(), 3, 4)).toBe("R0");

  // The same request, posed again from the same board and carried through the
  // animation, comes back as step 1 already resolved.
  await loadBoard(h, posed);
  const first = await swapAndStep(h, { col: 3, row: 3 }, { col: 3, row: 4 });
  expect(first.phase).toBe("resolving");
  expect(first.chainStep).toBe(1);
  expect(first.lastCleared).toBe(3);
});

it("plays a move as the whole gesture, and never as a shortcut", async () => {
  // `specs/controls.md` plays a move by taking hold of a gem, carrying it onto a
  // neighbor, and letting go: the RELEASE is what requests the swap. The gesture
  // helper goes through `pointerDown`, `pointerMove` and `pointerUp` and through
  // nothing else, so what decides the outcome is the build's own press, move and
  // release rules.
  await loadBoard(
    h,
    quietRowsWith([
      { col: 2, row: 4, token: "R0" },
      { col: 4, row: 4, token: "R0" },
      { col: 3, row: 3, token: "R0" },
    ]),
  );
  const played = await dragGem(h, { col: 3, row: 3 }, { col: 3, row: 4 });

  // The release requested the swap and let the gem go.
  expect(played.phase).toBe("swapping");
  expect(played.offer).toBeNull();
  expect(played.selection).toBeNull();

  // And it is the same move: the chain the gesture began scores the run of
  // three the arrangement planted.
  const settled = await resolveChain(h);
  expect(settled.settled).toBe(true);
  expect(settled.snapshot.score).toBeGreaterThanOrEqual(3 * BASE_SCORE);
});

it("takes a reported pointer target, by mouse and by touch", async () => {
  // A target's rectangle is the BUILD's, so a check reads the one it is going to
  // press off the snapshot. `specs/instrumentation.md` fixes that pressing and
  // releasing at a listed target's center takes that target.
  const play = targetById(await h.snapshot(), "menu-0");
  expect(play.w).toBeGreaterThan(0);
  const opened = await takeTarget(h, play, "touch");
  expect(opened.screen).toBe("playing");
  expect(opened.pointer.device).toBe("touch");

  // And a target the screen does not carry fails as the fixture error it is,
  // naming the ids that were reported.
  expect(() => targetById(opened, "menu-1")).toThrow(/Expected:/);
});

it("refuses a frame count that is not a whole number of frames", async () => {
  // A fixture error fails as one, the rule `loadBoard` follows: a count below
  // one, or a fractional count, is a mistake in the check rather than a verdict
  // about the build.
  await expect(h.advanceSeconds(1, 0)).rejects.toThrow(/Expected:/);
  await expect(h.advanceSeconds(1, 2.5)).rejects.toThrow(/Expected:/);
});

it("reads one box shape at a board edge and at its middle", async () => {
  // The box is the same shape wherever the cell sits: at a canvas edge the
  // ORIGIN slides inward rather than the box shrinking. `patchDistance` is a
  // MEAN over the box, so two readings of one cell answer for what was drawn in
  // it rather than for how the box was cut. A `half` of 120 logical units runs
  // off the bottom of the 1280x720 stage at the last row, which is what makes
  // this readable at all.
  await poseBoardWithEscape(h, []);
  await h.advance(1);
  const middle = await h.patch(3, 3, 120);
  const corner = await h.patch(7, 7, 120);
  expect(middle.width).toBe(241);
  expect(middle.height).toBe(241);
  expect(corner.width).toBe(middle.width);
  expect(corner.height).toBe(middle.height);
  // And two boxes of one shape are comparable, which is the whole point of it.
  expect(patchDistance(middle, corner)).toBeGreaterThanOrEqual(0);
});

it("presses a real mouse where a logical point is", async () => {
  // The pointer path that goes through the BROWSER rather than through the
  // surface. A check about what a press does poses one; a check about the sound a
  // press makes needs this, because `specs/ui.md` lets a build raise no cue at all
  // for a posed press. The verb arms the press and the next frame delivers it,
  // which is why every reading below follows an `advance(1)`.
  await loadBoard(h, quietBoard());
  const center = cellCenter(4, 2);
  await h.press(center.x, center.y);
  await h.advance(1);
  expect((await h.snapshot()).selection).toEqual({ col: 4, row: 2 });
  await h.lift();

  // A real press outside every cell's reach targets no cell, and
  // `specs/controls.md` has such a press clear the selection and any offer while
  // leaving the board exactly as it stands.
  const off = offBoardPoint();
  await h.press(off.x, off.y);
  await h.advance(1);
  expect((await h.snapshot()).selection).toBeNull();
  await h.lift();

  // And the pointer the build reads is at the point the check named, so a drag
  // that crossed the board arrives where it was aimed rather than at a multiple
  // of it. At the default shape a logical unit IS a client pixel, which is what
  // makes this readable at all.
  expect(h.client(center.x, center.y)).toEqual({ x: center.x, y: center.y });
  await h.moveTo(center.x, center.y);
  await h.advance(1);
  const pointer = (await h.snapshot()).pointer;
  expect(pointer.x).toBeCloseTo(center.x, 0);
  expect(pointer.y).toBeCloseTo(center.y, 0);
});

it("presses the point it was given on a high-density surface too", async () => {
  // The fit is stated in DEVICE pixels and a browser's mouse takes CSS pixels, so
  // a press that skipped the conversion would land at `dpr` times the point the
  // check named — right at the default shape, where the two coincide, and wrong
  // everywhere else. At `dpr: 2` the stage is unchanged and only the density
  // moves, so a logical point is still its own client point and the cell under it
  // is still the cell the check asked for.
  const dense = await createHarness({ dpr: 2 });
  try {
    await loadBoard(dense, quietBoard());
    const center = cellCenter(4, 2);
    expect(dense.client(center.x, center.y)).toEqual({
      x: center.x,
      y: center.y,
    });
    // The same point in the canvas's backing store, which IS doubled.
    expect(dense.device(center.x, center.y)).toEqual({
      x: center.x * 2,
      y: center.y * 2,
    });
    await dense.press(center.x, center.y);
    await dense.advance(1);
    expect((await dense.snapshot()).selection).toEqual({ col: 4, row: 2 });
    await dense.lift();
  } finally {
    await dense.dispose();
  }
});

it("opens the build's audio and hears a sound on the frame that made it", async () => {
  // What every audio point rests on. `specs/assets.md` decodes the produced
  // `.wav`s asynchronously and `specs/ui.md` opens audio only after a real
  // interaction, so a build's first frames are legitimately silent; `warmAudio`
  // waits that out. What is asserted after it is the specification's own
  // requirement: a sound on the frame its event happened, and not on the frames
  // around it.
  expect(await h.warmAudio()).toBe(true);
  await loadBoard(h, quietBoard());
  const cues = watchCues(h);

  const center = cellCenter(0, 0);
  await h.press(center.x, center.y);
  await h.advance(1);
  const sounded = h.frame();
  await h.lift();
  expect(cuesOnFrame(cues, sounded).length).toBeGreaterThan(0);

  // And silence while nothing happens, so a build that blips every frame is not
  // read as one that plays a cue.
  await h.advance(4);
  expect(cues.filter((cue) => cue.frame > sounded)).toEqual([]);
});

it("mounts the build under a sub-path, and answers everything it asks for", async () => {
  // `specs/assets.md`: the site "is not guaranteed to be served from the root of
  // its origin; it is played back mounted under a per-run sub-path". The page
  // really is opened under the sub-path, so a page-relative URL resolves from
  // there and every request the build made is written down — which is what a
  // check about page-relative assets reads. Nothing is refused: the produced
  // files stand up here as they do for every other check.
  const mounted = await createHarness({ basePath: "/runs/7/build/" });
  try {
    expect(mounted.surfaceFault).toBeNull();
    expect(new URL(mounted.page.url()).pathname).toBe("/runs/7/build/");
    expect(mounted.requests.length).toBeGreaterThan(0);
    for (const url of mounted.requests) {
      expect(new URL(url).pathname.startsWith("/runs/7/build/"), url).toBe(
        true,
      );
    }
    expect(mounted.failedRequests).toEqual([]);
    expect(mounted.assetFailures).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});

it("finds the built tree a produced-file check walks from disk", () => {
  // Four asset points read a produced file off disk rather than off the page,
  // and they all start here. `specs/assets.md` commits them under
  // `public/assets/` and has the build copy that tree into its output unchanged,
  // so either layout answers the same path.
  const root = siteRoot();
  expect(root).not.toBeNull();
  expect(existsSync(join(root as string, "index.html"))).toBe(true);
  expect(join(WORKSPACE_ROOT, STAGED_PROJECT_DIR)).toBe(PROJECT_ROOT);
});

it("lets real time pass without advancing the game", async () => {
  // `settle` is for the work a build does off the frame loop — a decode, a fetch.
  // If it advanced the simulation, every figure a check states in frames would be
  // wrong by however long the host took.
  await loadBoard(h, quietBoard());
  const before = await h.snapshot();
  const frames = h.frame();
  await h.settle(120);
  const after = await h.snapshot();
  expect(after.simTime).toBe(before.simTime);
  expect(h.frame()).toBe(frames);
});
