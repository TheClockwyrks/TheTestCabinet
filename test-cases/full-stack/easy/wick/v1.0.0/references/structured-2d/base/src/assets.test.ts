// The committed produced files against the contract of specs/assets.md and
// ASSET-LAYOUT.md: every image `src/constants.ts` names exists at its stated
// canvas, every cue has its PCM `.wav`, the bed runs at least thirty seconds
// with its score beside it, and both loops run end into start.

import { loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import {
  WickAssets,
  effectPath,
  enemyFrame,
  producedImagePaths,
  sheetFrame,
} from "./assets";
import {
  CUES,
  CUE_PATHS,
  EFFECT_SPRITES,
  ENEMIES,
  ENEMY_FRAMES,
  ENEMY_IDS,
  GEM_PATHS,
  GEM_SPRITE_SIZES,
  GEM_TIERS,
  GROUND_TILE_PATH,
  GROUND_TILE_SIZE,
  ICON_PATHS,
  ICON_SIZE,
  LAMPLIGHTER_IDLE_PATH,
  LAMPLIGHTER_SPRITE_HEIGHT,
  LAMPLIGHTER_SPRITE_WIDTH,
  LAMPLIGHTER_WALK_SHEET,
  LOOPING_CUES,
  LOOP_SEAM_TOLERANCE,
  MUSIC_MIN_SECONDS,
  MUSIC_SCORE_PATH,
  PICKUP_KINDS,
  PICKUP_PATHS,
  PICKUP_SPRITE_SIZE,
  PUFF_SHEET,
  PUFF_SPRITE_SIZE,
  type CueName,
  type OfferId,
  type WeaponId,
} from "./constants";

/** The committed file for a produced asset. */
function fileOf(path: string): URL {
  return new URL(`../assets/${path}`, import.meta.url);
}

/**
 * The bytes of a committed file. The supplied `tsconfig.json` carries no Node
 * type declarations, so Node's reader is reached through a dynamic import the
 * type-checker leaves untyped; the tests run in Node, where it resolves.
 */
async function bytesOf(path: string): Promise<Uint8Array> {
  const specifier = "node:" + "fs";
  const fs = (await import(/* @vite-ignore */ specifier)) as {
    readFileSync(file: URL): Uint8Array;
  };
  return fs.readFileSync(fileOf(path));
}

interface Wav {
  channels: number;
  sampleRate: number;
  frames: number;
  /** The sample at `frame` in `channel`, on `[-1, 1]`. */
  sample(frame: number, channel: number): number;
}

/** Read a PCM `.wav` back: its format and its samples. */
async function readWav(path: string): Promise<Wav> {
  const bytes = await bytesOf(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number): string =>
    String.fromCharCode(...bytes.subarray(at, at + 4));
  expect(tag(0), path).toBe("RIFF");
  expect(tag(8), path).toBe("WAVE");
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataAt = 0;
  let dataSize = 0;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt ") {
      expect(view.getUint16(at + 8, true), `${path} is PCM`).toBe(1);
      channels = view.getUint16(at + 10, true);
      sampleRate = view.getUint32(at + 12, true);
      bits = view.getUint16(at + 22, true);
    } else if (id === "data") {
      dataAt = at + 8;
      dataSize = Math.min(size, bytes.length - dataAt);
    }
    at += 8 + size + (size % 2);
  }
  expect(bits, `${path} is 16-bit`).toBe(16);
  const frames = Math.floor(dataSize / (2 * channels));
  return {
    channels,
    sampleRate,
    frames,
    sample: (frame, channel) =>
      view.getInt16(dataAt + (frame * channels + channel) * 2, true) / 32768,
  };
}

/** Every produced image with the canvas the contract states for it. */
function producedImages(): { path: string; width: number; height: number }[] {
  const images: { path: string; width: number; height: number }[] = [];
  const square = (path: string, size: number): void => {
    images.push({ path, width: size, height: size });
  };
  images.push({
    path: LAMPLIGHTER_IDLE_PATH,
    width: LAMPLIGHTER_SPRITE_WIDTH,
    height: LAMPLIGHTER_SPRITE_HEIGHT,
  });
  for (let i = 0; i < LAMPLIGHTER_WALK_SHEET.frames; i += 1) {
    images.push({
      path: sheetFrame(LAMPLIGHTER_WALK_SHEET, i),
      width: LAMPLIGHTER_SPRITE_WIDTH,
      height: LAMPLIGHTER_SPRITE_HEIGHT,
    });
  }
  for (const id of ENEMY_IDS) {
    for (let i = 0; i < ENEMY_FRAMES; i += 1) {
      square(enemyFrame(id, i), ENEMIES[id].radius * 2);
    }
  }
  for (let i = 0; i < PUFF_SHEET.frames; i += 1) {
    square(sheetFrame(PUFF_SHEET, i), PUFF_SPRITE_SIZE);
  }
  for (const tier of GEM_TIERS) square(GEM_PATHS[tier], GEM_SPRITE_SIZES[tier]);
  for (const kind of PICKUP_KINDS)
    square(PICKUP_PATHS[kind], PICKUP_SPRITE_SIZE);
  square(GROUND_TILE_PATH, GROUND_TILE_SIZE);
  for (const weapon of Object.keys(EFFECT_SPRITES) as WeaponId[]) {
    const sprite = EFFECT_SPRITES[weapon];
    for (let i = 0; i < sprite.frames; i += 1) {
      images.push({
        path: effectPath(weapon, i),
        width: sprite.width,
        height: sprite.height,
      });
    }
  }
  for (const id of Object.keys(ICON_PATHS) as OfferId[]) {
    square(ICON_PATHS[id], ICON_SIZE);
  }
  return images;
}

describe("the produced images", () => {
  it("number the lamplighter, thirteen walks, the puff, gems, pickups, ground, effects, and icons", () => {
    const paths = producedImagePaths();
    expect(paths).toHaveLength(
      7 + ENEMY_IDS.length * 4 + 4 + 3 + 3 + 1 + 27 + 27,
    );
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.sort()).toEqual(
      producedImages()
        .map((image) => image.path)
        .sort(),
    );
  });

  it("are each committed under assets/ on the canvas the contract states", async () => {
    for (const image of producedImages()) {
      const decoded = await loadImage(fileOf(image.path));
      expect([decoded.width, decoded.height], image.path).toEqual([
        image.width,
        image.height,
      ]);
    }
  });

  it("are keyed by their path under assets/", () => {
    const assets = new WickAssets();
    const image = {} as ImageBitmap;
    assets.set("sprites/ground.png", image);
    expect(assets.image("sprites/ground.png")).toBe(image);
    expect(assets.image("sprites/missing.png")).toBeNull();
    expect(assets.count).toBe(1);
  });
});

describe("the produced sounds", () => {
  it("are each committed under assets/audio as a PCM wav with samples in it", async () => {
    for (const cue of Object.values(CUES)) {
      const wav = await readWav(CUE_PATHS[cue]);
      expect(wav.sampleRate, cue).toBe(44100);
      expect(wav.channels, cue).toBeGreaterThanOrEqual(1);
      expect(wav.frames, cue).toBeGreaterThan(0);
      let peak = 0;
      for (let frame = 0; frame < wav.frames; frame += 1) {
        peak = Math.max(peak, Math.abs(wav.sample(frame, 0)));
      }
      expect(peak, `${cue} is audible`).toBeGreaterThan(0.05);
      expect(peak, `${cue} does not clip`).toBeLessThanOrEqual(1);
    }
  });

  it("keep the one-shot cues short and the endings long", async () => {
    const seconds = async (cue: CueName): Promise<number> => {
      const wav = await readWav(CUE_PATHS[cue]);
      return wav.frames / wav.sampleRate;
    };
    expect(await seconds(CUES.hit)).toBeLessThan(0.15);
    expect(await seconds(CUES.gem)).toBeLessThan(0.15);
    expect(await seconds(CUES.menuMove)).toBeLessThan(0.15);
    expect(await seconds(CUES.kill)).toBeGreaterThan(await seconds(CUES.hit));
    expect(await seconds(CUES.fallen)).toBeGreaterThan(2);
    expect(await seconds(CUES.dawn)).toBeGreaterThan(2);
  });

  it("run the bed at least thirty seconds with its score beside it", async () => {
    const wav = await readWav(CUE_PATHS[CUES.music]);
    expect(wav.frames / wav.sampleRate).toBeGreaterThanOrEqual(
      MUSIC_MIN_SECONDS,
    );
    const score = await bytesOf(MUSIC_SCORE_PATH);
    expect(String.fromCharCode(...score.subarray(0, 4))).toBe("MThd");
  });

  it("author both loops to run end into start within 1% of full scale", async () => {
    for (const cue of LOOPING_CUES) {
      const wav = await readWav(CUE_PATHS[cue]);
      for (let channel = 0; channel < wav.channels; channel += 1) {
        const seam = Math.abs(
          wav.sample(wav.frames - 1, channel) - wav.sample(0, channel),
        );
        expect(seam, `${cue} channel ${channel}`).toBeLessThanOrEqual(
          LOOP_SEAM_TOLERANCE,
        );
      }
    }
  });
});
