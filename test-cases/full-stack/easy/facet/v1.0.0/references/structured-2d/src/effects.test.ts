// The presentation layer: the break sheets and the particle bursts.

import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  BREAK_FRAME_SECONDS,
  domScratch,
  Presentation,
  prismTurnFrame,
  type StepReport,
} from "./effects";
import { napiScratch } from "./harness";
import { buildStore, BREAK_FRAMES, PRISM_TURN_FRAMES } from "./assets";
import type { AssetIo } from "./assets";
import { PRISM_TURN_FRAME_SECONDS } from "./effects";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadImage } from "@napi-rs/canvas";

const PUBLIC = fileURLToPath(new URL("../public/assets/", import.meta.url));

/** The committed tree, read straight off disk rather than over the engine. */
const io: AssetIo = {
  loadImage: async (path) =>
    (await loadImage(readFileSync(PUBLIC + path))) as unknown as ImageBitmap,
  load: async (path) => new Response(readFileSync(PUBLIC + path)).blob(),
};

function ctx2d(width = 1280, height = 720): CanvasRenderingContext2D {
  return createCanvas(width, height).getContext(
    "2d",
  ) as unknown as CanvasRenderingContext2D;
}

/** How many pixels of the canvas are not fully transparent. */
function painted(target: CanvasRenderingContext2D): number {
  const { data } = target.getImageData(
    0,
    0,
    target.canvas.width,
    target.canvas.height,
  );
  let count = 0;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 8) count += 1;
  }
  return count;
}

const CLEARED_RUBY: StepReport = {
  cleared: [
    { col: 0, row: 0, kind: "ruby", flawed: false },
    { col: 1, row: 0, kind: "ruby", flawed: true },
    { col: 2, row: 0, kind: null, flawed: false },
  ],
  created: [{ col: 1, row: 0 }],
};

describe("the prism's idle turn", () => {
  it("is a pure function of game time, and loops", () => {
    expect(prismTurnFrame(0)).toBe(0);
    expect(prismTurnFrame(PRISM_TURN_FRAME_SECONDS * 1.5)).toBe(1);
    expect(prismTurnFrame(PRISM_TURN_FRAME_SECONDS * PRISM_TURN_FRAMES)).toBe(
      0,
    );
    expect(prismTurnFrame(1000)).toBeLessThan(PRISM_TURN_FRAMES);
    expect(prismTurnFrame(1000)).toBeGreaterThanOrEqual(0);
  });
});

describe("break sheets", () => {
  it("play a kind's sheet at its cell, and retire when it has run", async () => {
    const store = await buildStore(io);
    const presentation = new Presentation(napiScratch());
    presentation.push([CLEARED_RUBY], store);
    expect(presentation.idle()).toBe(false);

    const target = ctx2d();
    presentation.drawBreaks(target, store);
    // Two of the three cleared gems carry a kind; the prism has no sheet.
    expect(painted(target)).toBeGreaterThan(200);

    presentation.advance(BREAK_FRAMES * BREAK_FRAME_SECONDS + 0.01);
    const after = ctx2d();
    presentation.drawBreaks(after, store);
    expect(painted(after)).toBe(0);
  });

  it("walks the sheet's frames as it ages", async () => {
    const store = await buildStore(io);
    const presentation = new Presentation(napiScratch());
    presentation.push(
      [
        {
          cleared: [{ col: 3, row: 3, kind: "jade", flawed: false }],
          created: [],
        },
      ],
      store,
    );
    const first = ctx2d();
    presentation.drawBreaks(first, store);
    presentation.advance(BREAK_FRAME_SECONDS * 3);
    const later = ctx2d();
    presentation.drawBreaks(later, store);
    expect(painted(first)).not.toBe(painted(later));
  });

  it("draws nothing for a sheet whose sprite is not in", async () => {
    const store = await buildStore({
      loadImage: async () => {
        throw new Error("no sprites");
      },
      load: io.load,
    });
    const presentation = new Presentation(napiScratch());
    presentation.push([CLEARED_RUBY], store);
    const target = ctx2d();
    presentation.drawBreaks(target, store);
    expect(painted(target)).toBe(0);
  });
});

describe("particle bursts", () => {
  it("simulates the produced systems and composites them onto the board", async () => {
    const store = await buildStore(io);
    const presentation = new Presentation(napiScratch());
    presentation.push([CLEARED_RUBY], store);

    // A burst emits over time, so the first frames are what fill it.
    presentation.advance(0.05);
    const target = ctx2d();
    presentation.drawBursts(target);
    expect(painted(target)).toBeGreaterThan(0);
  });

  it("retires a burst once the system has run", async () => {
    const store = await buildStore(io);
    const presentation = new Presentation(napiScratch());
    presentation.push([CLEARED_RUBY], store);
    expect(presentation.idle()).toBe(false);
    // Longer than any of the three systems' own durations.
    for (let step = 0; step < 400; step += 1) presentation.advance(0.05);
    expect(presentation.idle()).toBe(true);
  });

  it("throws nothing when the system is not in, or there is no canvas", async () => {
    const store = await buildStore(io);
    const noCanvas = new Presentation(() => null);
    noCanvas.push([CLEARED_RUBY], store);
    const target = ctx2d();
    noCanvas.drawBursts(target);
    expect(painted(target)).toBe(0);

    const noSystems = await buildStore({
      loadImage: io.loadImage,
      load: async () => {
        throw new Error("no systems");
      },
    });
    const presentation = new Presentation(napiScratch());
    presentation.push([CLEARED_RUBY], noSystems);
    presentation.advance(0.05);
    const second = ctx2d();
    presentation.drawBursts(second);
    expect(painted(second)).toBe(0);
  });

  it("pools its scratch canvases rather than one per shattered gem", async () => {
    const store = await buildStore(io);
    let made = 0;
    const scratch = napiScratch();
    const presentation = new Presentation((w, h) => {
      made += 1;
      return scratch(w, h);
    });
    const many: StepReport = {
      cleared: Array.from({ length: 8 }, (_, index) => ({
        col: index,
        row: 0,
        kind: "ruby",
        flawed: false,
      })),
      created: [],
    };
    presentation.push([many], store);
    const first = made;
    for (let step = 0; step < 400; step += 1) presentation.advance(0.05);
    presentation.push([many], store);
    expect(made).toBe(first);
  });
});

describe("clearing", () => {
  it("drops everything flying and frees the pooled canvases", async () => {
    const store = await buildStore(io);
    const presentation = new Presentation(napiScratch());
    presentation.push([CLEARED_RUBY], store);
    presentation.clear();
    expect(presentation.idle()).toBe(true);

    const target = ctx2d();
    presentation.drawBreaks(target, store);
    presentation.drawBursts(target);
    expect(painted(target)).toBe(0);
  });
});

describe("the scratch canvas", () => {
  it("answers null where there is no document to make one in", () => {
    expect(domScratch()(64, 64)).toBeNull();
  });

  it("makes one of the asked-for size where there is", () => {
    const host = globalThis as { document?: unknown };
    host.document = {
      createElement: () => createCanvas(1, 1),
    };
    try {
      const made = domScratch()(40.2, 30.7);
      expect(made?.canvas.width).toBe(41);
      expect(made?.canvas.height).toBe(31);
    } finally {
      delete host.document;
    }
  });
});
