import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { AssetStore, type AssetIo } from "./assets";
import {
  BREAK_FRAME_SECONDS,
  PRISM_TURN_FRAME_SECONDS,
  Presentation,
  boardReplaced,
  isDealtBoard,
  prismTurnFrame,
  sameBoard,
  type StepReport,
} from "./effects";
import { BREAK_FRAMES, PRISM_TURN_FRAMES } from "./assets";
import { FALL_SECONDS_PER_ROW, WAVE_SECONDS } from "./constants";
import {
  applySwap,
  cellCenter,
  createInitialState,
  parseBoard,
  withGem,
  type BoardState,
  type FacetState,
} from "./core";
import { quietRows, quietRowsWith } from "./core/fixtures";
import type { ScratchCanvas } from "./scratch";

const PUBLIC = join(import.meta.dirname, "..", "public");

/** The committed sprites and systems, read straight off disk. */
function diskIo(): AssetIo {
  const at = (path: string): string => join(PUBLIC, "assets", path);
  return {
    image: async (path) =>
      (await loadImage(at(path))) as unknown as CanvasImageSource,
    json: (path) =>
      Promise.resolve(JSON.parse(readFileSync(at(path), "utf8")) as unknown),
  };
}

/** A scratch factory that records the field sizes it was asked for. */
function scratchFactory(): { scratch: ScratchCanvas; sizes: string[] } {
  const sizes: string[] = [];
  return {
    sizes,
    scratch: (width, height) => {
      sizes.push(`${width}x${height}`);
      return createCanvas(width, height).getContext(
        "2d",
      ) as unknown as CanvasRenderingContext2D;
    },
  };
}

/** One step that cleared the cells named, each at the wave it names. */
function step(
  cleared: readonly [number, number, string | null, boolean, number?][],
  created: readonly [number, number][] = [],
): StepReport {
  const waves = cleared.reduce(
    (highest, [, , , , wave]) => Math.max(highest, wave ?? 0),
    0,
  );
  return {
    cleared: cleared.map(([col, row, kind, flawed, wave]) => ({
      col,
      row,
      kind,
      flawed,
      wave: wave ?? 0,
    })),
    created: created.map(([col, row]) => ({ col, row })),
    waves,
  };
}

/** One board, and a board that is not it. */
const BOARD = parseBoard(quietRows());
const OTHER = parseBoard(quietRowsWith({ "0,0": "M0" }));

/** A round in play holding `board`, standing still. */
function at(board: BoardState): FacetState {
  return { ...createInitialState(), screen: "playing", board };
}

/** `board` with every gem dealt in from above its row, as a fresh deal is. */
function dealt(board: BoardState): BoardState {
  return {
    ...board,
    gems: board.gems.map((gem, index) =>
      gem === null ? gem : { ...gem, fell: Math.floor(index / board.cols) + 1 },
    ),
  };
}

/** `observe` over two boards, each standing in a round of its own. */
function observe(
  presentation: Presentation,
  before: BoardState,
  after: BoardState,
  steps: readonly StepReport[],
  assets: AssetStore,
): void {
  presentation.observe(at(before), at(after), steps, assets);
}

/** How much paint a cell's own square carries, which is where its sheet goes. */
function inkAround(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
): number {
  const [x, y] = cellCenter({ col, row });
  const data = ctx.getImageData(x - 24, y - 24, 48, 48).data;
  let count = 0;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 8) count += 1;
  }
  return count;
}

let assets: AssetStore;

beforeAll(async () => {
  assets = new AssetStore(diskIo());
  await assets.load();
});

describe("prismTurnFrame", () => {
  it("starts at the first frame and walks the loop in order", () => {
    for (let frame = 0; frame < PRISM_TURN_FRAMES; frame += 1) {
      expect(prismTurnFrame(frame * PRISM_TURN_FRAME_SECONDS + 0.001)).toBe(
        frame,
      );
    }
  });

  it("wraps, so the turn loops rather than ending", () => {
    expect(prismTurnFrame(PRISM_TURN_FRAMES * PRISM_TURN_FRAME_SECONDS)).toBe(
      0,
    );
  });

  it("is a pure function of game time, so a driven scenario reproduces it", () => {
    expect(prismTurnFrame(3.14159)).toBe(prismTurnFrame(3.14159));
  });
});

describe("sameBoard", () => {
  it("compares by value, so a board rebuilt cell by cell is the same board", () => {
    // This build's state crosses the bridge twice a frame and comes back as
    // fresh objects, so an identity test here would wipe the effects one frame
    // after they were thrown.
    expect(sameBoard(BOARD, parseBoard(quietRows()))).toBe(true);
    expect(sameBoard(BOARD, BOARD)).toBe(true);
  });

  it("tells one board from another", () => {
    expect(sameBoard(BOARD, OTHER)).toBe(false);
    expect(sameBoard(BOARD, { cols: 0, rows: 0, gems: [] })).toBe(false);
    expect(sameBoard(BOARD, { ...BOARD, gems: BOARD.gems.slice(1) })).toBe(
      false,
    );
  });

  it("counts a gem that arrived from elsewhere as a different gem", () => {
    // Every gem carries the rows it fell to reach its cell, and a board whose
    // stones came from somewhere else is a different board.
    const fallen = withGem(
      BOARD,
      { col: 0, row: 0 },
      { kind: "ruby", cut: "plain", strain: 0, fell: 3 },
    );
    const standing = withGem(
      BOARD,
      { col: 0, row: 0 },
      { kind: "ruby", cut: "plain", strain: 0, fell: 0 },
    );
    expect(sameBoard(fallen, standing)).toBe(false);
  });

  it("counts an empty cell as different from a gem, and equal to an empty one", () => {
    const emptied = { ...BOARD, gems: [null, ...BOARD.gems.slice(1)] };
    expect(sameBoard(BOARD, emptied)).toBe(false);
    expect(sameBoard(emptied, { ...emptied, gems: [...emptied.gems] })).toBe(
      true,
    );
  });
});

describe("Presentation", () => {
  it("starts idle", () => {
    expect(new Presentation(scratchFactory().scratch).idle()).toBe(true);
  });

  it("plays a break sheet at each cleared cell, then retires it", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const board = BOARD;
    observe(
      presentation,
      board,
      board,
      [step([[2, 3, "ruby", false]])],
      assets,
    );
    expect(presentation.idle()).toBe(false);
    presentation.advance(BREAK_FRAMES * BREAK_FRAME_SECONDS + 0.001);
    // The bursts outlive the sheet, so the sheet alone is checked by drawing.
    const ctx = createCanvas(1280, 720).getContext(
      "2d",
    ) as unknown as CanvasRenderingContext2D;
    expect(() => {
      presentation.drawBreaks(ctx, assets);
    }).not.toThrow();
  });

  it("has no break sheet for a prism, which carries no kind", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const board = BOARD;
    observe(presentation, board, board, [step([[0, 0, null, false]])], assets);
    // One clear burst was still thrown for it.
    expect(sizes).toEqual(["96x96"]);
  });

  it("throws the heavier detonation where a flawed gem cleared", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const board = BOARD;
    observe(presentation, board, board, [step([[1, 1, "jade", true]])], assets);
    expect(sizes).toEqual(["256x256"]);
  });

  it("marks a created cut with the cut flash", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const board = BOARD;
    observe(presentation, board, board, [step([], [[4, 4]])], assets);
    expect(sizes).toEqual(["128x128"]);
  });

  it("pools its scratch canvases rather than making one per burst", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const board = BOARD;
    const three = step([
      [0, 0, "ruby", false],
      [1, 0, "ruby", false],
      [2, 0, "ruby", false],
    ]);
    observe(presentation, board, board, [three], assets);
    expect(sizes).toHaveLength(3);
    // Run them out, then throw three more: no new canvas is needed.
    presentation.advance(4);
    expect(presentation.idle()).toBe(true);
    observe(presentation, board, board, [three], assets);
    expect(sizes).toHaveLength(3);
  });

  it("retires a burst once its particles are gone", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const board = BOARD;
    observe(
      presentation,
      board,
      board,
      [step([[3, 3, "amber", false]])],
      assets,
    );
    for (let frame = 0; frame < 200; frame += 1) presentation.advance(1 / 60);
    expect(presentation.idle()).toBe(true);
  });

  it("drops everything when a board arrives that no step explains", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const first = BOARD;
    const second = OTHER;
    observe(
      presentation,
      first,
      first,
      [step([[3, 3, "amber", false]])],
      assets,
    );
    expect(presentation.idle()).toBe(false);
    // A fresh deal, a posed board, or a reset: the board the next frame is
    // handed is not the one the effects were thrown on.
    observe(presentation, first, second, [], assets);
    expect(presentation.idle()).toBe(true);
  });

  it("keeps playing while the board is the one it last saw", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const board = BOARD;
    observe(
      presentation,
      board,
      board,
      [step([[3, 3, "amber", false]])],
      assets,
    );
    observe(presentation, board, board, [], assets);
    expect(presentation.idle()).toBe(false);
  });

  it("clears on request", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const board = BOARD;
    observe(
      presentation,
      board,
      board,
      [step([[3, 3, "amber", false]])],
      assets,
    );
    presentation.clear();
    expect(presentation.idle()).toBe(true);
  });

  it("draws both layers over a real context without throwing", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const board = BOARD;
    observe(
      presentation,
      board,
      board,
      [
        step(
          [
            [2, 2, "ruby", false],
            [2, 3, "ruby", true],
          ],
          [[2, 4]],
        ),
      ],
      assets,
    );
    presentation.advance(0.05);
    const ctx = createCanvas(1280, 720).getContext(
      "2d",
    ) as unknown as CanvasRenderingContext2D;
    ctx.globalCompositeOperation = "source-over";
    presentation.drawBreaks(ctx, assets);
    presentation.drawBursts(ctx);
    // The compositing mode the bursts borrow is handed back as it was found.
    expect(ctx.globalCompositeOperation).toBe("source-over");
  });

  it("throws nothing where the platform can make no scratch canvas", () => {
    const presentation = new Presentation(() => null);
    const board = BOARD;
    expect(() => {
      observe(
        presentation,
        board,
        board,
        [step([[0, 0, "ruby", false]])],
        assets,
      );
      presentation.advance(0.1);
    }).not.toThrow();
  });

  it("stops throwing bursts of one system once the board is full of them", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const board = BOARD;
    const many = step(
      Array.from(
        { length: 40 },
        (_, index) =>
          [index % 8, Math.floor(index / 8), "ruby", false] as [
            number,
            number,
            string,
            boolean,
          ],
      ),
    );
    observe(presentation, board, board, [many], assets);
    expect(sizes.length).toBeLessThan(40);
  });

  it("skips a break frame whose sprite has not arrived", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const empty = new AssetStore({
      image: () => new Promise(() => {}),
      json: () => new Promise(() => {}),
    });
    const board = BOARD;
    observe(
      presentation,
      board,
      board,
      [step([[1, 1, "ruby", false]])],
      assets,
    );
    const ctx = createCanvas(1280, 720).getContext(
      "2d",
    ) as unknown as CanvasRenderingContext2D;
    expect(() => {
      presentation.drawBreaks(ctx, empty);
    }).not.toThrow();
  });

  it("throws no burst before the systems have loaded", () => {
    const { scratch, sizes } = scratchFactory();
    const empty = new AssetStore(diskIo());
    const presentation = new Presentation(scratch);
    const board = BOARD;
    observe(presentation, board, board, [step([[0, 0, "ruby", false]])], empty);
    expect(sizes).toEqual([]);
  });

  it("holds a wave's shatter back until that wave comes round", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const board = BOARD;
    // Wave 0 goes at once; wave 2 waits two wave-lengths into the step.
    observe(
      presentation,
      board,
      board,
      [
        step([
          [0, 0, "ruby", false, 0],
          [4, 4, "jade", false, 2],
        ]),
      ],
      assets,
    );
    const ctx = createCanvas(1280, 720).getContext(
      "2d",
    ) as unknown as CanvasRenderingContext2D;

    presentation.drawBreaks(ctx, assets);
    expect(inkAround(ctx, 0, 0)).toBeGreaterThan(0);
    expect(inkAround(ctx, 4, 4)).toBe(0);

    presentation.advance(2 * WAVE_SECONDS + 0.001);
    ctx.clearRect(0, 0, 1280, 720);
    presentation.drawBreaks(ctx, assets);
    expect(inkAround(ctx, 4, 4)).toBeGreaterThan(0);
  });

  it("waits the same wave before throwing that cell's burst", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const board = BOARD;
    observe(
      presentation,
      board,
      board,
      [step([[2, 2, "ruby", false, 3]])],
      assets,
    );
    // Nothing is composited while the burst is still waiting on its wave.
    expect(sizes).toEqual([]);
    presentation.advance(3 * WAVE_SECONDS + 0.001);
    expect(sizes).toEqual(["96x96"]);
  });

  it("holds one aura per cut gem standing on the board", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const withCuts = withGem(
      withGem(
        BOARD,
        { col: 1, row: 1 },
        {
          kind: "ruby",
          cut: "brilliant",
          strain: 0,
          fell: 0,
        },
      ),
      { col: 6, row: 6 },
      { kind: null, cut: "prism", strain: 0, fell: 0 },
    );
    observe(presentation, withCuts, withCuts, [], assets);
    // One 96x96 canvas per cut standing on the board, and none for the rest.
    expect(sizes).toEqual(["96x96", "96x96"]);

    // The aura goes when the stone does, and its canvas returns to the pool.
    observe(presentation, withCuts, BOARD, [], assets);
    observe(presentation, BOARD, withCuts, [], assets);
    expect(sizes).toEqual(["96x96", "96x96"]);
  });

  it("runs the auras on without ever reading as busy", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const withCut = withGem(
      BOARD,
      { col: 3, row: 3 },
      {
        kind: "jade",
        cut: "star",
        strain: 0,
        fell: 0,
      },
    );
    observe(presentation, withCut, withCut, [], assets);
    for (let frame = 0; frame < 120; frame += 1) presentation.advance(1 / 60);
    // An aura runs for as long as its stone stands, so it is not "flying".
    expect(presentation.idle()).toBe(true);

    const ctx = createCanvas(1280, 720).getContext(
      "2d",
    ) as unknown as CanvasRenderingContext2D;
    ctx.globalCompositeOperation = "source-over";
    presentation.drawAuras(ctx, (cell) => cellCenter(cell));
    expect(ctx.globalCompositeOperation).toBe("source-over");
    expect(ctx.globalAlpha).toBe(1);
  });

  it("pours a freshly dealt board that no step explains, and lands it", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    expect(presentation.pourAge()).toBeNull();

    const poured = dealt(BOARD);
    observe(presentation, BOARD, poured, [], assets);
    expect(presentation.pourAge()).toBe(0);

    presentation.advance(2 * FALL_SECONDS_PER_ROW);
    expect(presentation.pourAge()).toBeCloseTo(2 * FALL_SECONDS_PER_ROW, 6);
    // The bottom row came in from above the top one, eight rows up.
    presentation.advance(6 * FALL_SECONDS_PER_ROW);
    // The longest fall on it has landed, so nothing is pouring any more.
    expect(presentation.pourAge()).toBeNull();
  });

  it("starts no pour for a board that is standing still", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    observe(presentation, BOARD, OTHER, [], assets);
    expect(presentation.pourAge()).toBeNull();
  });

  it("starts no pour for a posed board only some of whose gems fell", () => {
    // A posed `setCell`, or a board a chain step left behind: some stones
    // carry a `fell`, but the board was not dealt, so it stands where it is.
    const presentation = new Presentation(scratchFactory().scratch);
    const posed = withGem(
      BOARD,
      { col: 0, row: 0 },
      { kind: "ruby", cut: "plain", strain: 0, fell: 4 },
    );
    observe(presentation, BOARD, posed, [], assets);
    expect(presentation.pourAge()).toBeNull();
  });

  it("neither pours nor clears when an accepted swap exchanges two cells", () => {
    // The board a swap leaves still carries every `fell` the deal or the last
    // step gave its stones. Reading the exchange as a new board would pour
    // the whole of it in from above on the frame the player let go — and do
    // it again on every later move, over whichever columns the previous chain
    // refilled.
    const presentation = new Presentation(scratchFactory().scratch);
    const before = dealt(BOARD);
    observe(
      presentation,
      before,
      before,
      [step([[3, 3, "amber", false]])],
      assets,
    );
    expect(presentation.idle()).toBe(false);

    const swap = { a: { col: 3, row: 3 }, b: { col: 3, row: 4 } };
    const swapping: FacetState = {
      ...at(applySwap(before, swap)),
      phase: "swapping",
      chainSwap: swap,
    };
    presentation.observe(at(before), swapping, [], assets);
    expect(presentation.pourAge()).toBeNull();
    expect(presentation.idle()).toBe(false);
  });

  it("clears, without pouring, for a posed board that stands still", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    observe(
      presentation,
      BOARD,
      BOARD,
      [step([[3, 3, "amber", false]])],
      assets,
    );
    expect(presentation.idle()).toBe(false);
    observe(presentation, BOARD, OTHER, [], assets);
    expect(presentation.idle()).toBe(true);
    expect(presentation.pourAge()).toBeNull();
  });
});

describe("isDealtBoard", () => {
  it("is true only when every gem came in from above its row", () => {
    expect(isDealtBoard(dealt(BOARD))).toBe(true);
    expect(isDealtBoard(BOARD)).toBe(false);
    expect(
      isDealtBoard(
        withGem(
          dealt(BOARD),
          { col: 2, row: 5 },
          { kind: "ruby", cut: "plain", strain: 0, fell: 5 },
        ),
      ),
    ).toBe(false);
    expect(isDealtBoard({ cols: 0, rows: 0, gems: [] })).toBe(false);
  });
});

describe("boardReplaced", () => {
  it("is a board that differs by value with no swap in motion", () => {
    expect(boardReplaced(at(BOARD), at(OTHER))).toBe(true);
    expect(
      boardReplaced(at(BOARD), at({ ...BOARD, gems: [...BOARD.gems] })),
    ).toBe(false);
    const swap = { a: { col: 0, row: 0 }, b: { col: 1, row: 0 } };
    const swapping: FacetState = {
      ...at(applySwap(BOARD, swap)),
      phase: "swapping",
      chainSwap: swap,
    };
    expect(boardReplaced(at(BOARD), swapping)).toBe(false);
  });
});
