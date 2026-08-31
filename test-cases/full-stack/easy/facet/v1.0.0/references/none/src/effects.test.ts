import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ASSET_ROOT, AssetStore, assetManifest, type AssetIo } from "./assets";
import {
  BREAK_FRAME_SECONDS,
  PRISM_TURN_FRAME_SECONDS,
  Presentation,
  auraKey,
  prismTurnFrame,
  type StepReport,
} from "./effects";
import { BREAK_FRAMES, PRISM_TURN_FRAMES } from "./assets";
import { WAVE_SECONDS } from "./constants";
import { NO_POUR } from "./motion";
import { createInitialState, loadBoard, type FacetState } from "./core";
import { quietRows } from "./core/fixtures";
import type { ScratchCanvas } from "./runtime";

const PUBLIC = join(import.meta.dirname, "..", "public");

/** The committed sprites and systems, read straight off disk. */
function diskIo(): AssetIo {
  return {
    image: async (url) =>
      (await loadImage(join(PUBLIC, url))) as unknown as CanvasImageSource,
    json: (url) =>
      Promise.resolve(JSON.parse(readFileSync(join(PUBLIC, url), "utf8"))),
    bytes: () => Promise.resolve(new ArrayBuffer(0)),
  };
}

/** The manifest without the audio, which no effect reads. */
function silentManifest() {
  const manifest = assetManifest();
  return { images: manifest.images, systems: manifest.systems, sounds: {} };
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

/** A real 2D context of stage size, for the drawing checks. */
function stageContext(): CanvasRenderingContext2D {
  return createCanvas(1280, 720).getContext(
    "2d",
  ) as unknown as CanvasRenderingContext2D;
}

/** A settled game on the quiet board, which carries no cut gem at all. */
function quiet(): FacetState {
  return loadBoard(createInitialState(), quietRows());
}

/** One step that cleared the cells named, each at the wave it names. */
function step(
  cleared: readonly [number, number, string | null, boolean, number][],
  created: readonly [number, number][] = [],
): StepReport {
  return {
    cleared: cleared.map(([col, row, kind, flawed, wave]) => ({
      col,
      row,
      kind,
      flawed,
      wave,
    })),
    created: created.map(([col, row]) => ({ col, row })),
    waves: cleared.reduce((most, entry) => Math.max(most, entry[4]), 0),
  };
}

let assets: AssetStore;

beforeAll(async () => {
  assets = new AssetStore(diskIo(), silentManifest(), ASSET_ROOT);
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

describe("auraKey", () => {
  it("carries the cut, so a stone recut starts an aura of its own", () => {
    expect(auraKey({ col: 2, row: 3 }, "star")).not.toBe(
      auraKey({ col: 2, row: 3 }, "prism"),
    );
  });
});

describe("Presentation", () => {
  it("starts idle, with no pour running", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    expect(presentation.idle()).toBe(true);
    expect(presentation.pourAge()).toBe(NO_POUR);
  });

  it("plays a break sheet at each cleared cell, then retires it", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const board = quiet();
    presentation.observe(
      board,
      board,
      [step([[2, 3, "ruby", false, 0]])],
      assets,
    );
    expect(presentation.idle()).toBe(false);
    presentation.advance(BREAK_FRAMES * BREAK_FRAME_SECONDS + 0.001, assets);
    // The bursts outlive the sheet, so the sheet alone is checked by drawing.
    expect(() => {
      presentation.drawBreaks(stageContext(), assets);
    }).not.toThrow();
  });

  it("has no break sheet for a prism, which carries no kind", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const board = quiet();
    presentation.observe(
      board,
      board,
      [step([[0, 0, null, false, 0]])],
      assets,
    );
    // One clear burst was still thrown for it.
    expect(sizes).toEqual(["96x96"]);
  });

  it("throws the heavier detonation where a flawed gem cleared", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const board = quiet();
    presentation.observe(
      board,
      board,
      [step([[1, 1, "jade", true, 0]])],
      assets,
    );
    expect(sizes).toEqual(["256x256"]);
  });

  it("holds a cell's shatter back by the wave R6 gave it", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const board = quiet();
    presentation.observe(
      board,
      board,
      [
        step([
          [0, 0, "ruby", false, 0],
          [1, 0, "ruby", false, 2],
        ]),
      ],
      assets,
    );
    // The seed's burst is thrown at once; the cell two waves out is queued.
    expect(sizes).toEqual(["96x96"]);
    presentation.advance(2 * WAVE_SECONDS + 0.001, assets);
    expect(sizes).toEqual(["96x96", "96x96"]);
  });

  it("marks a created cut with the cut flash, once the set has gone", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const board = quiet();
    presentation.observe(
      board,
      board,
      [step([[0, 0, "ruby", false, 1]], [[4, 4]])],
      assets,
    );
    expect(sizes).not.toContain("128x128");
    presentation.advance(WAVE_SECONDS + 0.001, assets);
    expect(sizes).toContain("128x128");
  });

  it("pools its scratch canvases rather than making one per burst", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const board = quiet();
    const three = step([
      [0, 0, "ruby", false, 0],
      [1, 0, "ruby", false, 0],
      [2, 0, "ruby", false, 0],
    ]);
    presentation.observe(board, board, [three], assets);
    expect(sizes).toHaveLength(3);
    // Run them out, then throw three more: no new canvas is needed.
    presentation.advance(4, assets);
    expect(presentation.idle()).toBe(true);
    presentation.observe(board, board, [three], assets);
    expect(sizes).toHaveLength(3);
  });

  it("retires a burst once its particles are gone", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const board = quiet();
    presentation.observe(
      board,
      board,
      [step([[3, 3, "amber", false, 0]])],
      assets,
    );
    for (let frame = 0; frame < 200; frame += 1) {
      presentation.advance(1 / 60, assets);
    }
    expect(presentation.idle()).toBe(true);
  });

  it("drops everything when a board arrives that no step explains", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const first = quiet();
    const second = loadBoard(createInitialState(), quietRows());
    presentation.observe(
      first,
      first,
      [step([[3, 3, "amber", false, 0]])],
      assets,
    );
    expect(presentation.idle()).toBe(false);
    // A fresh deal, a posed board, or a reset: the board the next frame is
    // handed is not the one the effects were thrown on.
    presentation.observe(first, second, [], assets);
    expect(presentation.idle()).toBe(true);
  });

  it("keeps playing while the board is the one it last saw", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const board = quiet();
    presentation.observe(
      board,
      board,
      [step([[3, 3, "amber", false, 0]])],
      assets,
    );
    presentation.observe(board, board, [], assets);
    expect(presentation.idle()).toBe(false);
  });

  it("clears on request", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const board = quiet();
    presentation.observe(
      board,
      board,
      [step([[3, 3, "amber", false, 0]])],
      assets,
    );
    presentation.clear();
    expect(presentation.idle()).toBe(true);
  });

  it("draws every layer over a real context without throwing", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const board = quiet();
    presentation.observe(
      board,
      board,
      [
        step(
          [
            [2, 2, "ruby", false, 0],
            [2, 3, "ruby", true, 0],
          ],
          [[2, 4]],
        ),
      ],
      assets,
    );
    presentation.advance(0.05, assets);
    const ctx = stageContext();
    ctx.globalCompositeOperation = "source-over";
    presentation.drawBreaks(ctx, assets);
    presentation.drawBursts(ctx);
    presentation.drawAuras(ctx, () => [640, 360] as const);
    // The compositing mode the effects borrow is handed back as it was found.
    expect(ctx.globalCompositeOperation).toBe("source-over");
  });

  it("throws nothing where the platform can make no scratch canvas", () => {
    const presentation = new Presentation(() => null);
    const board = quiet();
    expect(() => {
      presentation.observe(
        board,
        board,
        [step([[0, 0, "ruby", false, 0]])],
        assets,
      );
      presentation.advance(0.1, assets);
    }).not.toThrow();
  });

  it("stops throwing bursts of one system once the board is full of them", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const board = quiet();
    const many = step(
      Array.from(
        { length: 40 },
        (_, index) =>
          [index % 8, Math.floor(index / 8), "ruby", false, 0] as [
            number,
            number,
            string,
            boolean,
            number,
          ],
      ),
    );
    presentation.observe(board, board, [many], assets);
    expect(sizes.length).toBeLessThan(40);
  });

  it("skips a break frame whose sprite has not arrived", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const empty = new AssetStore(
      {
        image: () => new Promise(() => {}),
        json: () => new Promise(() => {}),
        bytes: () => new Promise(() => {}),
      },
      silentManifest(),
      ASSET_ROOT,
    );
    const board = quiet();
    presentation.observe(
      board,
      board,
      [step([[1, 1, "ruby", false, 0]])],
      assets,
    );
    expect(() => {
      presentation.drawBreaks(stageContext(), empty);
    }).not.toThrow();
  });

  it("throws no burst before the systems have loaded", () => {
    const { scratch, sizes } = scratchFactory();
    const empty = new AssetStore(diskIo(), silentManifest(), ASSET_ROOT);
    const presentation = new Presentation(scratch);
    const board = quiet();
    presentation.observe(
      board,
      board,
      [step([[0, 0, "ruby", false, 0]])],
      empty,
    );
    expect(sizes).toEqual([]);
  });
});

describe("the cut auras", () => {
  /** The quiet board with one cut stone written into it. */
  function withCut(token: string): FacetState {
    const rows = [...quietRows()];
    rows[3] = rows[3]
      .split(" ")
      .map((cell, col) => (col === 4 ? token : cell))
      .join(" ");
    return loadBoard(createInitialState(), rows);
  }

  it("runs one at every cut stone standing on the board, and none elsewhere", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const plain = quiet();
    presentation.observe(plain, plain, [], assets);
    expect(sizes).toEqual([]);

    const cut = withCut("R0b");
    presentation.observe(plain, cut, [], assets);
    expect(sizes).toEqual(["96x96"]);
  });

  it("leaves a running aura alone rather than restarting it every frame", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const cut = withCut("C0s");
    presentation.observe(cut, cut, [], assets);
    presentation.advance(0.1, assets);
    presentation.observe(cut, cut, [], assets);
    expect(sizes).toEqual(["96x96"]);
  });

  it("retires an aura once the stone it belonged to has gone", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const cut = withCut("X0");
    presentation.observe(cut, cut, [], assets);
    expect(sizes).toEqual(["96x96"]);
    const plain = quiet();
    presentation.observe(cut, plain, [], assets);
    // The freed canvas is pooled, so the next cut stone reuses it.
    presentation.observe(plain, withCut("R0b"), [], assets);
    expect(sizes).toEqual(["96x96"]);
  });

  it("draws each aura where the renderer says its stone is", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const cut = withCut("R0b");
    presentation.observe(cut, cut, [], assets);
    presentation.advance(0.2, assets);
    const asked: string[] = [];
    presentation.drawAuras(stageContext(), (cell) => {
      asked.push(`${cell.col},${cell.row}`);
      return [0, 0] as const;
    });
    expect(asked).toEqual(["4,3"]);
  });
});

describe("the pour clock", () => {
  it("runs for a board every gem of which came in from above it", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const title = createInitialState();
    const dealt = { ...title, screen: "playing" as const };
    // A dealt board is what `start` leaves behind, so pose one that way.
    const round = loadBoard(title, quietRows());
    const poured: FacetState = {
      ...round,
      board: {
        ...round.board,
        gems: round.board.gems.map((gem, index) =>
          gem
            ? { ...gem, fell: Math.floor(index / round.board.cols) + 1 }
            : gem,
        ),
      },
    };
    presentation.observe(dealt, poured, [], assets);
    expect(presentation.pourAge()).toBe(0);
    presentation.advance(0.25, assets);
    expect(presentation.pourAge()).toBeCloseTo(0.25, 6);
  });

  it("runs for no board whose gems are standing where they were written", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const title = createInitialState();
    presentation.observe(title, quiet(), [], assets);
    expect(presentation.pourAge()).toBe(NO_POUR);
  });

  it("stands aside for a chain step, whose fall the step timer runs", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const board = quiet();
    presentation.observe(
      board,
      board,
      [step([[0, 0, "ruby", false, 0]])],
      assets,
    );
    expect(presentation.pourAge()).toBe(NO_POUR);
  });
});
