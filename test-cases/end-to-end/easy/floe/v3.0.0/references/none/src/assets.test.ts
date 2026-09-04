// The seeded sprite art: the seven folders, their frame counts, the frame layout
// each set is read by, and the sub-rect the two long rafts are drawn from.
//
// The URLs the frames are loaded through are the bundler's, resolved at build
// time; `src/images.ts` turns a folder name into them in frame order, and that
// ordering is checked here. Decoding is the browser's and is exercised by the
// build itself rather than in process.

import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import {
  BEAR_FRAMES,
  CAR_FRAMES,
  CAR_W,
  CROSSER_FRAMES,
  DOGSLED_FRAMES,
  DOGSLED_W,
  PAN_FRAMES,
  PAN_W,
  PLOW_FRAMES,
  PLOW_W,
  RAFT_FRAMES,
  RAFT_W,
  SPRITE_TILE,
  TILE,
} from "./constants";
import {
  BEAR_LUNGE_BASE,
  BEAR_SWIM_BASE,
  facingPair,
  floeArt,
  vehicleArt,
  type Art,
} from "./assets";
import { frameUrls } from "./images";

/** How many frames each folder is stated to carry. */
const FOLDERS = {
  crosser: CROSSER_FRAMES,
  bear: BEAR_FRAMES,
  plow: PLOW_FRAMES,
  dogsled: DOGSLED_FRAMES,
  car: CAR_FRAMES,
  pan: PAN_FRAMES,
  raft: RAFT_FRAMES,
} as const;

/** Art whose frames are the strings naming them, so a choice is readable. */
const NAMED: Art = Object.fromEntries(
  Object.entries(FOLDERS).map(([folder, count]) => [
    folder,
    Array.from({ length: count }, (_, index) => `${folder}/${index}`),
  ]),
) as unknown as Art;

describe("the seven folders", () => {
  it("ships exactly the frames the specification counts", () => {
    for (const [folder, count] of Object.entries(FOLDERS)) {
      const files = readdirSync(`assets/${folder}`).filter((name) =>
        name.endsWith(".png"),
      );
      expect(files.length, folder).toBe(count);
      for (let index = 0; index < count; index += 1) {
        expect(
          statSync(`assets/${folder}/${index}.png`).isFile(),
          `assets/${folder}/${index}.png`,
        ).toBe(true);
      }
    }
  });

  it("carries no folder the specification does not name", () => {
    expect(readdirSync("assets").sort()).toEqual(Object.keys(FOLDERS).sort());
  });

  it("resolves each folder's frames in frame-index order", () => {
    for (const [folder, count] of Object.entries(FOLDERS)) {
      const urls = frameUrls(folder);
      expect(urls.length, folder).toBe(count);
      expect(new Set(urls).size, folder).toBe(count);
    }
    expect(frameUrls("nothing-of-the-sort")).toEqual([]);
  });
});

describe("the frame layouts", () => {
  it("lays every per-facing set out as down, up, left, right", () => {
    expect(facingPair("down")).toBe(0);
    expect(facingPair("up")).toBe(2);
    expect(facingPair("left")).toBe(4);
    expect(facingPair("right")).toBe(6);
  });

  it("puts the bear's swim set after its run set, and its lunge last", () => {
    expect(BEAR_SWIM_BASE).toBe(8);
    expect(BEAR_LUNGE_BASE).toBe(16);
    expect(BEAR_LUNGE_BASE + 2).toBe(BEAR_FRAMES);
    for (const facing of ["down", "up", "left", "right"] as const) {
      expect(BEAR_SWIM_BASE + facingPair(facing) + 1).toBeLessThan(
        BEAR_LUNGE_BASE,
      );
    }
  });
});

describe("choosing a frame", () => {
  it("draws each vehicle kind from its own folder", () => {
    expect(vehicleArt(NAMED, "plow")).toEqual(["plow/0"]);
    expect(vehicleArt(NAMED, "dogsled")).toEqual(["dogsled/0"]);
    expect(vehicleArt(NAMED, "car")).toEqual(["car/0"]);
  });

  it("draws the one-tile floe from its own frame, whole", () => {
    expect(floeArt(NAMED, "pan")).toEqual({ image: "pan/0", sourceW: PAN_W });
    expect(PAN_W).toBe(TILE);
  });

  it("draws the three-tile raft from the left of frame 0 and the four-tile one from all of frame 1", () => {
    expect(floeArt(NAMED, "raft3")).toEqual({
      image: "raft/0",
      sourceW: 3 * SPRITE_TILE,
    });
    expect(floeArt(NAMED, "raft4")).toEqual({
      image: "raft/1",
      sourceW: RAFT_W,
    });
    expect(RAFT_W).toBe(4 * SPRITE_TILE);
  });

  it("gives every lane item a source width of one tile per tile it spans", () => {
    expect(PLOW_W).toBe(3 * SPRITE_TILE);
    expect(DOGSLED_W).toBe(2 * SPRITE_TILE);
    expect(CAR_W).toBe(2 * SPRITE_TILE);
    expect(SPRITE_TILE).toBe(TILE);
  });
});
