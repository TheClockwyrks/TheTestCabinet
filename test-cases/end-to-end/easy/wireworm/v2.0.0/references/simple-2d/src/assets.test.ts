// The seeded art: every frame is asked for under its own path, and a frame that
// could not be loaded is kept as `null` rather than failing the build.

import { describe, expect, it } from "vitest";
import {
  CORRUPTOR_FRAMES,
  CURSOR_FRAMES,
  DROPPER_FRAMES,
  GLITCH_FRAMES,
  NODE_FRAMES,
  WORM_FRAMES,
} from "./constants";
import { emptySprites, loadSprites } from "./assets";

describe("loading", () => {
  it("asks for every frame of every folder, by folder and index", async () => {
    const asked: string[] = [];
    const sprites = await loadSprites({
      loadImage: async (path: string) => {
        asked.push(path);
        throw new Error("no host to decode an image");
      },
    });

    expect(asked).toHaveLength(
      NODE_FRAMES +
        WORM_FRAMES +
        CURSOR_FRAMES +
        GLITCH_FRAMES +
        DROPPER_FRAMES +
        CORRUPTOR_FRAMES,
    );
    expect(asked).toContain("node/4.png");
    expect(asked).toContain("worm/0.png");
    expect(asked).toContain("dropper/0.png");
    expect(sprites.node).toHaveLength(NODE_FRAMES);
    expect(sprites.node.every((frame) => frame === null)).toBe(true);
  });

  it("stands a blank set up at the frame counts the folders hold", () => {
    const sprites = emptySprites();
    expect(sprites.worm).toHaveLength(WORM_FRAMES);
    expect(sprites.glitch).toHaveLength(GLITCH_FRAMES);
    expect(sprites.corruptor).toHaveLength(CORRUPTOR_FRAMES);
    expect(sprites.cursor).toHaveLength(CURSOR_FRAMES);
  });
});
