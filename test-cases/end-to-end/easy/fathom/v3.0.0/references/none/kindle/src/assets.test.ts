import { describe, expect, it } from "vitest";

import {
  BLOOM_BEATS,
  facingBase,
  LANTERNJAW_DISGUISE,
  TRENCH_FLOOR,
  TRENCH_FOG,
  TRENCH_GATE,
} from "./assets";
import { sheetUrls } from "./images";
import { DIRS } from "./types";

describe("the sheets the project ships", () => {
  it("carries every frame each sheet's layout indexes", () => {
    for (const [folder, frames] of [
      ["glimmerfin", 8],
      ["lanternjaw", 16],
      ["gloamfin", 8],
      ["flarefish", 8],
      ["drifter", 8],
      ["trench-walls", 19],
      ["flare-bloom", 8],
    ] as const) {
      expect(sheetUrls(folder)).toHaveLength(frames);
    }
  });

  it("orders a sheet's frames by index rather than by name", () => {
    const urls = sheetUrls("trench-walls");
    expect(urls[10]).toMatch(/(^|[/\\])10\b|10-/);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("reads no frames for a folder that is not a sheet", () => {
    expect(sheetUrls("nonesuch")).toHaveLength(0);
  });
});

describe("the frame layouts", () => {
  it("gives each facing its own pair, in the sheets' shared order", () => {
    expect(DIRS.map(facingBase).sort((a, b) => a - b)).toEqual([0, 2, 4, 6]);
    expect(facingBase("down")).toBe(0);
    expect(facingBase("up")).toBe(2);
    expect(facingBase("left")).toBe(4);
    expect(facingBase("right")).toBe(6);
  });

  it("puts the Lanternjaw's disguise past its eight true-body frames", () => {
    expect(LANTERNJAW_DISGUISE).toBe(8);
  });

  it("names the three tiles that are not part of the wall autotile", () => {
    expect([TRENCH_FLOOR, TRENCH_FOG, TRENCH_GATE]).toEqual([16, 17, 18]);
  });

  it("splits the bloom sheet into its three beats, covering every frame", () => {
    const covered = Object.values(BLOOM_BEATS).flatMap((beat) =>
      Array.from({ length: beat.count }, (_, i) => beat.from + i),
    );
    expect(covered).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
