// Wireworm — the seeded sprite folders (specs/assets.md).

import { describe, expect, test } from "vitest";
import { FOLDERS, WORM_PAIR, nodeFrame } from "./assets";
import {
  CHARGE_MAX,
  CORRUPTOR_FRAMES,
  CURSOR_FRAMES,
  DROPPER_FRAMES,
  GLITCH_FRAMES,
  NODE_FRAMES,
  WORM_FRAMES,
} from "./constants";
import { frameUrl } from "./images";
import { loadTestSprites } from "./harness.test-support";

describe("the seeded art", () => {
  test("each folder carries the frames the specification fixes", () => {
    expect(FOLDERS).toEqual({
      node: NODE_FRAMES,
      worm: WORM_FRAMES,
      cursor: CURSOR_FRAMES,
      glitch: GLITCH_FRAMES,
      dropper: DROPPER_FRAMES,
      corruptor: CORRUPTOR_FRAMES,
    });
  });

  test("every frame decodes, at the size a tile expects", async () => {
    const sprites = await loadTestSprites();
    for (const [folder, count] of Object.entries(FOLDERS)) {
      const frames = sprites[folder as keyof typeof FOLDERS];
      expect(frames).toHaveLength(count);
      for (const frame of frames) {
        const image = frame as unknown as { width: number; height: number };
        expect(image.width).toBe(32);
        expect(image.height).toBe(32);
      }
    }
  });

  test("the worm's three parts start at their own pair", () => {
    expect(WORM_PAIR).toEqual({ head: 0, body: 2, tail: 4 });
  });

  test("a node below critical holds the frame for its charge", () => {
    for (let charge = 0; charge < CHARGE_MAX; charge += 1) {
      expect(nodeFrame(charge)).toBe(charge);
    }
    expect(nodeFrame(CHARGE_MAX)).toBe(CHARGE_MAX);
    expect(nodeFrame(-2)).toBe(0);
    expect(nodeFrame(9)).toBe(CHARGE_MAX);
  });

  test("a frame's URL resolves against the page, not the origin root", () => {
    const url = frameUrl("node", 2);
    expect(url.endsWith("assets/node/2.png")).toBe(true);
    expect(url.startsWith("http")).toBe(true);
  });
});
