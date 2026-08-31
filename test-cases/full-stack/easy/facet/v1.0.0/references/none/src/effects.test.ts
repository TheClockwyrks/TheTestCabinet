import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ASSET_ROOT, AssetStore, assetManifest, type AssetIo } from "./assets";
import {
  BREAK_FRAME_SECONDS,
  PRISM_TURN_FRAME_SECONDS,
  Presentation,
  prismTurnFrame,
  type StepReport,
} from "./effects";
import { BREAK_FRAMES, PRISM_TURN_FRAMES } from "./assets";
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

/** One step that cleared the cells named, none of them flawed. */
function step(
  cleared: readonly [number, number, string | null, boolean][],
  created: readonly [number, number][] = [],
): StepReport {
  return {
    cleared: cleared.map(([col, row, kind, flawed]) => ({
      col,
      row,
      kind,
      flawed,
    })),
    created: created.map(([col, row]) => ({ col, row })),
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

describe("Presentation", () => {
  it("starts idle", () => {
    expect(new Presentation(scratchFactory().scratch).idle()).toBe(true);
  });

  it("plays a break sheet at each cleared cell, then retires it", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const board = {};
    presentation.observe(board, board, [step([[2, 3, "ruby", false]])], assets);
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
    const board = {};
    presentation.observe(board, board, [step([[0, 0, null, false]])], assets);
    // One clear burst was still thrown for it.
    expect(sizes).toEqual(["96x96"]);
  });

  it("throws the heavier detonation where a flawed gem cleared", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const board = {};
    presentation.observe(board, board, [step([[1, 1, "jade", true]])], assets);
    expect(sizes).toEqual(["256x256"]);
  });

  it("marks a created cut with the cut flash", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const board = {};
    presentation.observe(board, board, [step([], [[4, 4]])], assets);
    expect(sizes).toEqual(["128x128"]);
  });

  it("pools its scratch canvases rather than making one per burst", () => {
    const { scratch, sizes } = scratchFactory();
    const presentation = new Presentation(scratch);
    const board = {};
    const three = step([
      [0, 0, "ruby", false],
      [1, 0, "ruby", false],
      [2, 0, "ruby", false],
    ]);
    presentation.observe(board, board, [three], assets);
    expect(sizes).toHaveLength(3);
    // Run them out, then throw three more: no new canvas is needed.
    presentation.advance(4);
    expect(presentation.idle()).toBe(true);
    presentation.observe(board, board, [three], assets);
    expect(sizes).toHaveLength(3);
  });

  it("retires a burst once its particles are gone", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const board = {};
    presentation.observe(
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
    const first = {};
    const second = {};
    presentation.observe(
      first,
      first,
      [step([[3, 3, "amber", false]])],
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
    const board = {};
    presentation.observe(
      board,
      board,
      [step([[3, 3, "amber", false]])],
      assets,
    );
    presentation.observe(board, board, [], assets);
    expect(presentation.idle()).toBe(false);
  });

  it("clears on request", () => {
    const presentation = new Presentation(scratchFactory().scratch);
    const board = {};
    presentation.observe(
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
    const board = {};
    presentation.observe(
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
    const board = {};
    expect(() => {
      presentation.observe(
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
    const board = {};
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
    const board = {};
    presentation.observe(board, board, [step([[1, 1, "ruby", false]])], assets);
    const ctx = createCanvas(1280, 720).getContext(
      "2d",
    ) as unknown as CanvasRenderingContext2D;
    expect(() => {
      presentation.drawBreaks(ctx, empty);
    }).not.toThrow();
  });

  it("throws no burst before the systems have loaded", () => {
    const { scratch, sizes } = scratchFactory();
    const empty = new AssetStore(diskIo(), silentManifest(), ASSET_ROOT);
    const presentation = new Presentation(scratch);
    const board = {};
    presentation.observe(board, board, [step([[0, 0, "ruby", false]])], empty);
    expect(sizes).toEqual([]);
  });
});
