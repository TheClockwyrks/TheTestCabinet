// The committed produced files against the contract of specs/assets.md and
// ASSET-LAYOUT.md: every path `src/constants.ts` names exists at its stated
// native size, every cue has its `.wav`, and both beds run at least the
// twelve seconds the loop needs.

import { Image } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BALL_SPRITE_SIZE,
  BED_PATHS,
  CUE_PATHS,
  MUSIC_MIN_SECONDS,
  PLANET_SPRITE_SIZE,
  POD_SPRITE_SIZE,
  SPRITE_PATHS,
  type CueName,
} from "./constants";

function fileOf(path: string): Buffer {
  return readFileSync(new URL(`../assets/${path}`, import.meta.url));
}

function imageOf(path: string): Image {
  const image = new Image();
  image.src = fileOf(path);
  return image;
}

/** Seconds of PCM audio a RIFF/WAVE file holds. */
function wavSeconds(path: string): number {
  const bytes = fileOf(path);
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.toString("ascii", 8, 12)).toBe("WAVE");
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === "fmt ") byteRate = bytes.readUInt32LE(offset + 16);
    if (id === "data") {
      expect(byteRate).toBeGreaterThan(0);
      return size / byteRate;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`${path}: no data chunk`);
}

describe("the produced sprites", () => {
  it("commits the planet at its stated canvas", () => {
    const planet = imageOf(SPRITE_PATHS.planet);
    expect(planet.width).toBe(PLANET_SPRITE_SIZE);
    expect(planet.height).toBe(PLANET_SPRITE_SIZE);
  });

  it("commits all five pod sprites at 24 x 24", () => {
    for (const path of Object.values(SPRITE_PATHS.pods)) {
      const sprite = imageOf(path);
      expect(sprite.width, path).toBe(POD_SPRITE_SIZE);
      expect(sprite.height, path).toBe(POD_SPRITE_SIZE);
    }
  });

  it("commits the six ball frames at 24 x 24", () => {
    expect(SPRITE_PATHS.ball).toHaveLength(6);
    for (const path of SPRITE_PATHS.ball) {
      const frame = imageOf(path);
      expect(frame.width, path).toBe(BALL_SPRITE_SIZE);
      expect(frame.height, path).toBe(BALL_SPRITE_SIZE);
    }
  });
});

describe("the produced sound", () => {
  it("commits a decodable .wav for every one of the thirteen cues", () => {
    for (const cue of Object.keys(CUE_PATHS) as CueName[]) {
      expect(wavSeconds(CUE_PATHS[cue]), cue).toBeGreaterThan(0);
    }
  });

  it("commits both beds at twelve seconds or more", () => {
    expect(wavSeconds(BED_PATHS.title)).toBeGreaterThanOrEqual(
      MUSIC_MIN_SECONDS,
    );
    expect(wavSeconds(BED_PATHS.play)).toBeGreaterThanOrEqual(
      MUSIC_MIN_SECONDS,
    );
  });
});
