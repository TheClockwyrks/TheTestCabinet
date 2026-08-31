import { loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { Assets, producedImages } from "./assets";
import { ENEMY_IDS } from "./constants";

/** The committed file for a produced image. */
function fileOf(path: string): URL {
  return new URL(`../assets/${path}`, import.meta.url);
}

describe("the produced images", () => {
  it("number the lamplighter, thirteen walks, the puff, gems, pickups, ground, effects, and icons", () => {
    const images = producedImages();
    expect(images).toHaveLength(
      7 + ENEMY_IDS.length * 4 + 4 + 3 + 3 + 1 + 27 + 27,
    );
    expect(new Set(images.map((image) => image.path)).size).toBe(images.length);
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
    const assets = new Assets();
    const image = {} as HTMLImageElement;
    assets.put("sprites/ground.png", image);
    expect(assets.image("sprites/ground.png")).toBe(image);
    expect(assets.image("sprites/missing.png")).toBeNull();
    expect(assets.imageCount).toBe(1);
  });
});
