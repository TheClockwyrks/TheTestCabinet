import { describe, expect, it } from "vitest";

import { cueUrls, resolveAsset } from "./assets";
import { CUE_NAMES } from "./constants";

describe("reaching the produced files (specs/assets.md)", () => {
  it("resolves a file by its path relative to the assets root", () => {
    const urls = {
      "../assets/audio/place.wav": "/build/place-1234.wav",
      "../assets/audio/complete.wav": "/build/complete-5678.wav",
    };
    expect(resolveAsset(urls, "audio/place.wav")).toBe("/build/place-1234.wav");
    expect(resolveAsset(urls, "audio/halt.wav")).toBeNull();
  });

  it("does not match a path that merely ends the same way", () => {
    const urls = { "../assets/audio/xplace.wav": "/build/x.wav" };
    expect(resolveAsset(urls, "audio/place.wav")).toBeNull();
  });

  it("names every cue, and reports null for one this build has not made", () => {
    const urls = cueUrls();
    expect(Object.keys(urls).sort()).toEqual([...CUE_NAMES].sort());
    for (const cue of CUE_NAMES) {
      const url = urls[cue];
      expect(url === null || typeof url === "string").toBe(true);
    }
  });
});
