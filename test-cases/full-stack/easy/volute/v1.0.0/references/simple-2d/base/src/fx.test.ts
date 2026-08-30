// The effects layer: the produced sheets it animates, the tint it lays under the
// shared flash, the recoil frame it derives from the state, and what it does on a
// host that could decode none of it.

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { emptyAssets, SHEETS, type Assets, type Sprite } from "./assets";
import { FIRE_COOLDOWN, TICK_DT } from "./constants";
import { Effects, FRAME_SECONDS, recoilFrame } from "./fx";

/** A drawable of a given size, standing in for a decoded produced PNG. */
function sprite(width: number, height: number): Sprite {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  return canvas as unknown as ImageBitmap;
}

/** An asset set whose three sheets are decoded and whose systems are not. */
function withSheets(): Assets {
  return {
    ...emptyAssets(),
    sheets: {
      "fire-recoil": Array.from({ length: SHEETS["fire-recoil"] }, () =>
        sprite(44, 20),
      ),
      "maw-swallow": Array.from({ length: SHEETS["maw-swallow"] }, () =>
        sprite(64, 64),
      ),
      "extraction-flash": Array.from(
        { length: SHEETS["extraction-flash"] },
        () => sprite(48, 48),
      ),
    },
  };
}

/** A 2D context over a canvas of the field's own size. */
function context(): CanvasRenderingContext2D {
  const canvas = createCanvas(960, 540);
  return canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
}

const napiCanvas = (width: number, height: number) =>
  createCanvas(width, height) as unknown as HTMLCanvasElement;

describe("the recoil frame", () => {
  it("walks the produced sheet through the fire cooldown", () => {
    const assets = withSheets();
    const frames = assets.sheets["fire-recoil"];
    // The cooldown is what the state carries, so the sheet is walked by counting
    // it down a tick at a time, exactly as a played shot does.
    const order: number[] = [];
    for (let cooldown = FIRE_COOLDOWN; cooldown > 0; cooldown -= TICK_DT) {
      const frame = recoilFrame(assets, cooldown);
      const index = frames.indexOf(frame);
      expect(index).toBeGreaterThanOrEqual(0);
      if (order[order.length - 1] !== index) order.push(index);
    }
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it("gives the plain barrel back once the cooldown has run out", () => {
    const assets = withSheets();
    expect(recoilFrame(assets, 0)).toBeNull();
    expect(recoilFrame(assets, -1)).toBeNull();
  });
});

describe("the sheets", () => {
  it("plays a flash through its frames and then retires it", () => {
    const effects = new Effects(withSheets(), napiCanvas);
    effects.spawn({ kind: "extract", x: 480, y: 270, charge: "garnet" });
    expect(effects.count()).toBe(1);

    const ctx = context();
    const life = SHEETS["extraction-flash"] * FRAME_SECONDS["extraction-flash"];
    for (let t = 0; t < life; t += FRAME_SECONDS["extraction-flash"] / 2) {
      effects.update(FRAME_SECONDS["extraction-flash"] / 2);
      effects.draw(ctx, 0);
    }
    expect(effects.count()).toBe(0);
  });

  it("tints the shared flash to the extracted charge", () => {
    const effects = new Effects(withSheets(), napiCanvas);
    effects.spawn({ kind: "extract", x: 100, y: 100, charge: "olivine" });
    const canvas = createCanvas(960, 540);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    effects.draw(ctx, 0);
    // The shared frames are pure white; what lands is the charge's own color,
    // lightened by the untinted frame drawn over its tint.
    const { data } = canvas.getContext("2d").getImageData(100, 100, 1, 1);
    expect(data[1]).toBeGreaterThan(data[2]);
    expect(effects.count()).toBe(1);
  });

  it("falls back to a colored glow where no scratch canvas can be had", () => {
    const effects = new Effects(withSheets(), () => null);
    effects.spawn({ kind: "extract", x: 100, y: 100, charge: "garnet" });
    const canvas = createCanvas(960, 540);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    effects.draw(ctx, 0);
    const { data } = canvas.getContext("2d").getImageData(100, 100, 1, 1);
    expect(data[0]).toBeGreaterThan(0);
    expect(effects.count()).toBe(1);
  });

  it("plays the maw's swallow over the intake", () => {
    const effects = new Effects(withSheets(), napiCanvas);
    effects.spawn({ kind: "intake", x: 480, y: 320 });
    expect(effects.count()).toBe(1);
    effects.draw(context(), 0);
    effects.update(SHEETS["maw-swallow"] * FRAME_SECONDS["maw-swallow"]);
    expect(effects.count()).toBe(0);
  });

  it("ages nothing on a frame worth no time", () => {
    const effects = new Effects(withSheets(), napiCanvas);
    effects.spawn({ kind: "extract", x: 1, y: 1, charge: "halide" });
    effects.update(0);
    effects.update(-1);
    expect(effects.count()).toBe(1);
  });

  it("drops every live effect when it is cleared", () => {
    const effects = new Effects(withSheets(), napiCanvas);
    effects.spawn({ kind: "extract", x: 1, y: 1, charge: "halide" });
    effects.spawn({ kind: "intake", x: 2, y: 2 });
    effects.clear();
    expect(effects.count()).toBe(0);
  });
});

describe("a host that decoded nothing", () => {
  it("spawns and draws nothing, and never throws", () => {
    const effects = new Effects(emptyAssets(), napiCanvas);
    effects.spawn({ kind: "extract", x: 1, y: 1, charge: "halide" });
    effects.spawn({ kind: "grant", x: 1, y: 1 });
    effects.spawn({ kind: "bore", x: 1, y: 1 });
    effects.spawn({ kind: "intake", x: 1, y: 1 });
    // The two sheet plays stand; the four systems could not be parsed, so none
    // was queued.
    expect(effects.count()).toBe(2);
    const ctx = context();
    effects.draw(ctx, 1 / 60);
    effects.update(10);
    expect(effects.count()).toBe(0);
  });
});
