// The produced half of the build (specs/assets.md, specs/ui.md): that the five
// charges are told apart on the channel, that a core is a produced sprite rather
// than a code-drawn disc, that the sheets and the particle systems play, and that
// the HUD carries its six readouts.
//
// The checks that need to know WHAT was drawn arm the engine's draw-command
// recorder and read the operations back; the checks that need to know how the
// picture LOOKS sample the canvas the pipeline drew into.

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import type { DrawOp, DrawValue, Recording } from "@test-cabinet/structured-2d";
import { assets } from "./assets";
import { CHARGE_IDS, PATH_LENGTH, SPACING } from "./constants";
import type { PosedCore } from "./debug";
import {
  current,
  differing,
  isolate,
  onLowerLeg,
  openLevel,
  poseTrain,
  seatAhead,
  useHarness,
  type Harness,
} from "./harness";

useHarness();

/** Every operation of every frame of a recording, in order. */
function operations(recording: Recording): DrawOp[] {
  return recording.frames.flatMap((frame) =>
    frame.ops.map((index) => recording.ops[index]),
  );
}

/** The image an operation drew, or `-1` where it drew none. */
function drawnImage(op: DrawOp): number {
  if (op.op !== "call" || op.method !== "drawImage") return -1;
  const source: DrawValue | undefined = op.args[0];
  if (typeof source !== "object" || source === null) return -1;
  const index = (source as { $img?: unknown }).$img;
  return typeof index === "number" ? index : -1;
}

/** The index of every image an operation drew, in order. */
function drawnImages(recording: Recording): number[] {
  return operations(recording)
    .map(drawnImage)
    .filter((index) => index >= 0);
}

/** The destination size a nine-argument `drawImage` blitted at, or `null`. */
function blitSize(op: DrawOp): { width: number; height: number } | null {
  if (op.op !== "call" || op.method !== "drawImage" || op.args.length !== 9) {
    return null;
  }
  const width = op.args[7];
  const height = op.args[8];
  return typeof width === "number" && typeof height === "number"
    ? { width, height }
    : null;
}

/** The source size a nine-argument `drawImage` read, or `null`. */
function sourceSize(op: DrawOp): { width: number; height: number } | null {
  if (op.op !== "call" || op.method !== "drawImage" || op.args.length !== 9) {
    return null;
  }
  const width = op.args[3];
  const height = op.args[4];
  return typeof width === "number" && typeof height === "number"
    ? { width, height }
    : null;
}

/** The `drawImage` calls a recording holds, with their arguments. */
function imageCalls(recording: Recording): DrawOp[] {
  return operations(recording).filter(
    (op) => op.op === "call" && op.method === "drawImage",
  );
}

/** The mean RGB of a disc of `radius` around a field point. */
function meanRgb(
  h: Harness,
  x: number,
  y: number,
  radius: number,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const [pr, pg, pb] = h.pixel(x + dx, y + dy);
      r += pr;
      g += pg;
      b += pb;
      n += 1;
    }
  }
  return [r / n, g / n, b / n];
}

/** The RGB distance between two samples, on a 0-441 scale. */
function apart(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** One core of each charge, side by side along the straight top run. */
function fiveCharges(): PosedCore[] {
  return CHARGE_IDS.map((charge, i): PosedCore => [700 - i * 80, charge, null]);
}

describe("the charges", () => {
  it("tells the five apart where they stand on the channel", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, fiveCharges());
    await h.engine.advance(1);

    const samples = h
      .snapshot()
      .train.map((core) => meanRgb(h, core.x, core.y, 13));
    for (let i = 0; i < samples.length; i += 1) {
      for (let j = i + 1; j < samples.length; j += 1) {
        expect(apart(samples[i], samples[j])).toBeGreaterThan(50);
      }
    }
  });

  it("stands every charge off the field and off the plate", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, fiveCharges());
    await h.engine.advance(1);

    // 50 units clear of every leg, and bare plate on a leg no core stands on.
    const field = meanRgb(h, 320, 270, 4);
    const plate = meanRgb(h, 320, 220, 4);
    for (const core of h.snapshot().train) {
      const sample = meanRgb(h, core.x, core.y, 13);
      expect(apart(sample, field)).toBeGreaterThan(50);
      expect(apart(sample, plate)).toBeGreaterThan(50);
    }
  });

  it("carries a cleavage of its own, so no two are the same shape flat", () => {
    const masks = CHARGE_IDS.map((charge) => mask(charge));
    for (let i = 0; i < masks.length; i += 1) {
      for (let j = i + 1; j < masks.length; j += 1) {
        const apartBy = masks[i].reduce(
          (sum, bit, index) => sum + (bit === masks[j][index] ? 0 : 1),
          0,
        );
        expect(apartBy).toBeGreaterThan(0);
      }
    }
  });
});

/** A produced core sprite as a binary luminance mask at its own median. */
function mask(charge: (typeof CHARGE_IDS)[number]): number[] {
  const size = 28;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(assets().cores[charge] as never, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const luminance: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    luminance.push(
      alpha * (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]),
    );
  }
  const median = [...luminance].sort((a, b) => a - b)[
    Math.floor(luminance.length / 2)
  ];
  return luminance.map((value) => (value > median ? 1 : 0));
}

describe("produced pictures", () => {
  it("draws a core from its produced 28 x 28 sprite", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[400, "halide", null]]);

    h.engine.startRecording();
    await h.engine.advance(1);
    const recording = h.engine.stopRecording();

    const blits = imageCalls(recording).filter((op) => {
      const source = sourceSize(op);
      return source?.width === 28 && source.height === 28;
    });
    expect(blits.length).toBeGreaterThan(0);
    // Every image the pipeline drew came out of the recording's image table, so
    // each is a produced file rather than code-drawn geometry.
    expect(drawnImages(recording).length).toBeGreaterThan(0);
    expect(recording.images.length).toBeGreaterThan(0);
  });

  it("plays the produced flash sheet across a run being drawn out", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [
      [onLowerLeg(400), "halide", null],
      [onLowerLeg(400) - SPACING, "halide", null],
      [1000, "garnet", null],
    ]);

    h.engine.startRecording();
    await seatAhead("halide");
    await h.engine.advance(12);
    const recording = h.engine.stopRecording();

    // A sheet frame is 48 x 48, a size nothing else on the field is drawn at,
    // and successive frames draw different entries of the image table.
    const flashes = new Set<number>();
    for (const op of imageCalls(recording)) {
      const source = sourceSize(op);
      if (source?.width !== 48 || source.height !== 48) continue;
      const image = drawnImage(op);
      if (image >= 0) flashes.add(image);
    }
    expect(flashes.size).toBeGreaterThan(1);
  });

  it("plays a live particle burst over an extraction", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [
      [onLowerLeg(400), "halide", null],
      [onLowerLeg(400) - SPACING, "halide", null],
      [1000, "garnet", null],
    ]);
    await seatAhead("halide");

    // The burst composites soft radial discs, which the pipeline draws through
    // gradients created for the frame: two consecutive frames after an
    // extraction differ.
    const first = h.pixels();
    await h.engine.advance(1);
    const second = h.pixels();
    expect(differing(first, second)).toBeGreaterThan(0);
  });
});

describe("the HUD", () => {
  it("carries the score in digits", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [
      [onLowerLeg(400), "halide", null],
      [onLowerLeg(400) - SPACING, "halide", null],
      [onLowerLeg(400) - 2 * SPACING, "halide", null],
      [onLowerLeg(400) - 3 * SPACING, "halide", null],
      [1000, "garnet", null],
    ]);
    await seatAhead("halide");
    expect(h.snapshot().score).toBe(50);

    h.engine.startRecording();
    await h.engine.advance(1);
    expect(texts(h.engine.stopRecording())).toContain("50");
  });

  it("carries the level in play", async () => {
    const h = current();
    await openLevel(h, 4);
    h.engine.startRecording();
    await h.engine.advance(1);
    expect(texts(h.engine.stopRecording())).toContain("4");
  });

  it("draws one produced cell icon per cell remaining", async () => {
    const h = current();
    await openLevel(h, 1);
    h.debug.setQuotaRemaining(0);
    h.debug.clearTrain();
    poseTrain(h, [[PATH_LENGTH - 20, "halide", null]]);
    for (let i = 0; i < 120; i += 1) {
      await h.engine.advance(1);
      if (h.snapshot().cells === 2) break;
    }
    expect(h.snapshot().cells).toBe(2);

    h.engine.startRecording();
    await h.engine.advance(1);
    const recording = h.engine.stopRecording();

    const icons = new Map<number, number>();
    for (const op of imageCalls(recording)) {
      const drawn = blitSize(op);
      if (drawn?.width !== 24 || drawn.height !== 24) continue;
      const image = drawnImage(op);
      if (image < 0) continue;
      icons.set(image, (icons.get(image) ?? 0) + 1);
    }
    // The cell icon and the pressure icon are both 24 x 24 produced sprites, so
    // they are told apart by which image was drawn: one appears twice, the other
    // once.
    expect([...icons.values()].sort()).toEqual([1, 2]);
  });

  it("fills the pressure gauge in proportion to the pressure", async () => {
    const h = current();
    const shots: Uint8ClampedArray[] = [];
    await isolate(h);
    poseTrain(h, [[1000, "halide", null]]);
    for (const pressure of [0, 50, 100]) {
      h.debug.setPressure(pressure);
      await h.engine.advance(6);
      shots.push(h.pixels());
    }
    const [empty, half, full] = shots;
    expect(differing(empty, full)).toBeGreaterThan(differing(empty, half));
    expect(differing(empty, half)).toBeGreaterThan(0);
  });

  it("draws the loaded and the queued charge as their own cores", async () => {
    const h = current();
    await isolate(h, 5);
    poseTrain(h, [
      [1000, "garnet", null],
      [972, "garnet", null],
      [944, "garnet", null],
    ]);
    h.debug.setLoaded("halide");
    h.debug.setQueued("cobalt");

    h.engine.startRecording();
    await h.engine.advance(1);
    const recording = h.engine.stopRecording();

    const drawn = new Set(drawnImages(recording));
    const halide = imageIndex(recording, assets().cores.halide);
    const cobalt = imageIndex(recording, assets().cores.cobalt);
    expect(halide).toBeGreaterThanOrEqual(0);
    expect(cobalt).toBeGreaterThanOrEqual(0);
    expect(drawn.has(halide)).toBe(true);
    expect(drawn.has(cobalt)).toBe(true);
  });
});

/** Every string a recording's text operations drew. */
function texts(recording: Recording): string[] {
  return operations(recording)
    .filter((op) => op.op === "call" && op.method === "fillText")
    .map((op) => (op.op === "call" ? String(op.args[0]) : ""));
}

/** How many bytes two captured frames differ in. */

/**
 * The index a produced sprite occupies in a recording's image table.
 *
 * The recorder captures a bitmap by drawing it onto a scratch canvas of the same
 * class and encoding that canvas as a PNG, so encoding the sprite the same way
 * here is what identifies it — by the pixels drawn rather than by a path under
 * `assets/`, which a bundler is free to inline.
 */
function imageIndex(recording: Recording, image: ImageBitmap): number {
  return recording.images.findIndex((entry) => {
    if (entry.kind !== "bitmap") return false;
    const canvas = createCanvas(entry.width, entry.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image as never, 0, 0, entry.width, entry.height);
    return canvas.toDataURL("image/png") === entry.src;
  });
}
