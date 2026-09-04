// The presentation layer: the break sheets, the bursts, the auras, and the pour.

import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  auraCells,
  BREAK_FRAME_SECONDS,
  domScratch,
  isDealtBoard,
  POUR_SECONDS,
  Presentation,
  prismTurnFrame,
  type StepReport,
} from "./effects";
import { parseBoard } from "./core";
import { quietRows, quietRowsWith } from "./core/fixtures";
import { WAVE_SECONDS } from "./constants";
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
    { col: 0, row: 0, kind: "ruby", flawed: false, wave: 0 },
    { col: 1, row: 0, kind: "ruby", flawed: true, wave: 0 },
    { col: 2, row: 0, kind: null, flawed: false, wave: 0 },
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
          cleared: [{ col: 3, row: 3, kind: "jade", flawed: false, wave: 0 }],
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

  it("holds a cell's sheet back until its own wave comes round", async () => {
    const store = await buildStore(io);
    const presentation = new Presentation(napiScratch());
    presentation.push(
      [
        {
          cleared: [{ col: 3, row: 3, kind: "jade", flawed: false, wave: 2 }],
          created: [],
        },
      ],
      store,
    );
    const early = ctx2d();
    presentation.drawBreaks(early, store);
    expect(painted(early)).toBe(0);

    presentation.advance(2 * WAVE_SECONDS + 0.001);
    const onTime = ctx2d();
    presentation.drawBreaks(onTime, store);
    expect(painted(onTime)).toBeGreaterThan(0);

    presentation.advance(BREAK_FRAMES * BREAK_FRAME_SECONDS);
    const spent = ctx2d();
    presentation.drawBreaks(spent, store);
    expect(painted(spent)).toBe(0);
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
    // Longer than any of the one-shot systems' own durations.
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
        wave: 0,
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

describe("the aura every cut stone carries", () => {
  it("runs one at each cut stone and none anywhere else", () => {
    const board = parseBoard(
      quietRowsWith({ "1,1": "S0b", "4,4": "C0s", "6,2": "X0" }),
    );
    expect(auraCells(board)).toEqual([
      { col: 1, row: 1 },
      { col: 6, row: 2 },
      { col: 4, row: 4 },
    ]);
    expect(auraCells(parseBoard(quietRows()))).toEqual([]);
  });

  it("composites one play per cut stone, wherever the renderer puts it", async () => {
    const store = await buildStore(io);
    const presentation = new Presentation(napiScratch());
    presentation.syncAuras([{ col: 1, row: 1 }], store);
    presentation.advance(0.2);

    const target = ctx2d();
    presentation.drawAuras(target, () => [400, 300]);
    expect(painted(target)).toBeGreaterThan(0);

    const elsewhere = ctx2d(200, 200);
    presentation.drawAuras(elsewhere, () => [-500, -500]);
    expect(painted(elsewhere)).toBe(0);
  });

  it("keeps the play a cell already had, and drops one whose stone is gone", async () => {
    const store = await buildStore(io);
    let made = 0;
    const scratch = napiScratch();
    const presentation = new Presentation((w, h) => {
      made += 1;
      return scratch(w, h);
    });
    presentation.syncAuras([{ col: 1, row: 1 }], store);
    const first = made;
    presentation.advance(0.2);
    presentation.syncAuras([{ col: 1, row: 1 }], store);
    expect(made).toBe(first);

    presentation.syncAuras([], store);
    const gone = ctx2d();
    presentation.drawAuras(gone, () => [400, 300]);
    expect(painted(gone)).toBe(0);
  });

  it("runs none at all when the system is not in", async () => {
    const noSystems = await buildStore({
      loadImage: io.loadImage,
      load: async () => {
        throw new Error("no systems");
      },
    });
    const presentation = new Presentation(napiScratch());
    presentation.syncAuras([{ col: 1, row: 1 }], noSystems);
    presentation.advance(0.2);
    const target = ctx2d();
    presentation.drawAuras(target, () => [400, 300]);
    expect(painted(target)).toBe(0);
  });
});

describe("the pour a freshly dealt board comes in on", () => {
  it("tells a dealt board from a posed one and from a settled one", () => {
    const posed = parseBoard(quietRows());
    expect(isDealtBoard(posed)).toBe(false);
    const dealt = {
      ...posed,
      gems: posed.gems.map((gem, index) =>
        gem === null
          ? gem
          : { ...gem, fell: Math.floor(index / posed.cols) + 1 },
      ),
    };
    expect(isDealtBoard(dealt)).toBe(true);
    expect(isDealtBoard({ cols: 0, rows: 0, gems: [] })).toBe(false);
  });

  it("runs a clock for exactly as long as the deepest gem takes to arrive", () => {
    const presentation = new Presentation(napiScratch());
    expect(presentation.pourAge()).toBeNull();
    presentation.pour();
    expect(presentation.pourAge()).toBe(0);
    presentation.advance(0.05);
    expect(presentation.pourAge()).toBeCloseTo(0.05, 6);
    presentation.advance(POUR_SECONDS);
    expect(presentation.pourAge()).toBeNull();
  });

  it("is dropped along with everything else a clear drops", () => {
    const presentation = new Presentation(napiScratch());
    presentation.pour();
    presentation.clear();
    expect(presentation.pourAge()).toBeNull();
  });
});

describe("clearing", () => {
  it("drops everything flying and frees the pooled canvases", async () => {
    const store = await buildStore(io);
    const presentation = new Presentation(napiScratch());
    presentation.push([CLEARED_RUBY], store);
    presentation.syncAuras([{ col: 1, row: 1 }], store);
    presentation.advance(0.05);
    presentation.clear();
    expect(presentation.idle()).toBe(true);

    const target = ctx2d();
    presentation.drawBreaks(target, store);
    presentation.drawBursts(target);
    presentation.drawAuras(target, () => [400, 300]);
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
