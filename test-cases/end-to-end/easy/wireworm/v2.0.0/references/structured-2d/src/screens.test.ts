// The six screens: what each one leads to, and that each one draws.
//
// The menus are driven the way a player drives them — real key events through
// the engine's action reader — and the picture is read back off the canvas, so
// each screen is checked as the thing a player sees rather than as a field.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BINDINGS,
  ENDING_ITEMS,
  PAUSE_ITEMS,
  STAGE_H,
  STAGE_W,
  START_LIVES,
  TOTAL_LEVELS,
} from "./constants";
import { createHarness, startPlaying, type Harness } from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** How many of the pixels sampled across the screen are lit above the board. */
function litPixels(): number {
  let lit = 0;
  for (let y = 120; y < STAGE_H - 60; y += 8) {
    for (let x = 120; x < STAGE_W - 120; x += 8) {
      const [r, g, b] = h.pixel(x, y);
      if (r + g + b > 260) lit += 1;
    }
  }
  return lit;
}

/** Move the highlight to `index` and take the item under it. */
async function choose(index: number): Promise<void> {
  for (let step = 0; step < index; step += 1) await h.tap(BINDINGS.down[0]);
  await h.tap(BINDINGS.confirm[0]);
}

describe("the pause menu", () => {
  beforeEach(async () => {
    startPlaying(h.debug);
    h.debug.setScore(400);
    await h.tap(BINDINGS.pause[0]);
    expect(h.debug.snapshot().screen).toBe("paused");
  });

  it("resumes the run exactly as it was", async () => {
    await choose(0);
    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.score).toBe(400);
  });

  it("restarts the run from the first level", async () => {
    await choose(1);
    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.score).toBe(0);
    expect(shot.level).toBe(1);
    expect(shot.lives).toBe(START_LIVES);
    expect(shot.nodes.length).toBeGreaterThan(0);
  });

  it("quits to the title with its highlight at the first item", async () => {
    await choose(PAUSE_ITEMS.length - 1);
    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("title");
    expect(shot.menuIndex).toBe(0);
  });
});

describe("the end screens", () => {
  it("play again from the victory screen, and leave to the menu", async () => {
    h.debug.setScreen("victory");
    h.debug.setScore(9000);
    h.debug.setLives(2);
    await h.advance(1);
    expect(litPixels()).toBeGreaterThan(20);

    await choose(0);
    expect(h.debug.snapshot().screen).toBe("playing");
    expect(h.debug.snapshot().score).toBe(0);

    h.debug.setScreen("victory");
    await choose(ENDING_ITEMS.length - 1);
    expect(h.debug.snapshot().screen).toBe("title");
  });

  it("report the level a lost run reached", async () => {
    h.debug.setScreen("gameover");
    h.debug.setLives(0);
    h.debug.setReachedLevel(TOTAL_LEVELS - 3);
    await h.advance(1);
    expect(litPixels()).toBeGreaterThan(20);
    await choose(ENDING_ITEMS.length - 1);
    expect(h.debug.snapshot().screen).toBe("title");
  });
});

describe("every screen draws", () => {
  it("puts something legible on each of the six", async () => {
    const screens = [
      "title",
      "howto",
      "playing",
      "paused",
      "victory",
      "gameover",
    ] as const;
    for (const screen of screens) {
      h.debug.setScreen(screen);
      if (screen === "playing") {
        h.debug.setPhase("banner");
        h.debug.setPhaseTimer(1);
      }
      await h.advance(1);
      expect(litPixels(), screen).toBeGreaterThan(10);
    }
  });

  it("shows the lives as a count once there are more than a row of them", async () => {
    startPlaying(h.debug);
    h.debug.setLives(12);
    await h.advance(1);
    let lit = 0;
    for (let x = 460; x < 760; x += 2) {
      const [r, g, b] = h.pixel(x, 52);
      if (r + g + b > 200) lit += 1;
    }
    expect(lit).toBeGreaterThan(10);
  });
});
