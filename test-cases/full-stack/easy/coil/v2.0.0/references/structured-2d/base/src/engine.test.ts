// Coil under the engine, in process.
//
// Every check here drives a real engine through `src/harness.ts`: the frame loop,
// the fixed tick the game mode resolves inside it, the keyboard the player
// controller reads, the cue bus, and the pixels the pipeline's two draw
// components produced. Nothing is reimplemented — what runs is the same
// `GameDefinition` `src/main.ts` binds to the engine in a browser.
//
// Nothing in this process can fetch or decode an image, so every produced file
// fails to load here. That is deliberate: it is the check that a build whose
// assets are unavailable still initializes, still ticks, still takes input, and
// still draws a board.

import {
  ConstantClock,
  createEngine,
  type Engine,
} from "@test-cabinet/structured-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NO_SPRITES } from "./assets";
import {
  BITE_SECONDS,
  CUES,
  HEAD_FRAMES,
  LAYOUT,
  STAGE_H,
  STAGE_W,
  TICK_SECONDS,
  TITLE_ITEMS,
} from "./constants";
import { goTo, handleAction, startRound } from "./flow";
import { game, type CoilDebugApi } from "./game";
import {
  canvasOf,
  createHarness,
  FRAME_MS,
  surfaceOf,
  type Harness,
} from "./harness";
import { renderBoardLayer, renderUiLayer } from "./render";
import { biteFrame } from "./sim";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** A live round holding its chain still, so a scenario is about one thing. */
function held(chain = [{ col: 14, row: 8 }]): void {
  startRound(h.state);
  h.debug.setSnake(chain);
  h.debug.setSnakeTravel(false);
  h.debug.clearPellet();
}

describe("initialization", () => {
  it("opens on the title with the surface held by the engine", () => {
    expect(h.state.screen).toBe("title");
    expect(h.debug).toBeTruthy();
    expect(h.debug.snapshot().screen).toBe("title");
  });

  it("hands the loaded sprite set to the state that draws it", () => {
    // The instance loads the art and seeds the world with it as the world
    // opens, so the set on the state is the one the loader produced rather than
    // the empty one the field initializer holds. Nothing in this process can
    // decode an image, so every frame of that set is null and the identity is
    // what the check rests on.
    expect(h.state.sprites).not.toBe(NO_SPRITES);
    expect(h.state.sprites.head.length).toBe(HEAD_FRAMES);
  });

  it("initializes and draws even though no produced file could load", async () => {
    expect(h.state.sprites.body).toBeNull();
    await h.step(1);
    // The title's own copy is drawn in code, so the stage is not blank.
    const painted = h.ctx.getImageData(0, 0, STAGE_W, STAGE_H).data;
    let lit = 0;
    for (let i = 0; i < painted.length; i += 4) {
      if (painted[i]! + painted[i + 1]! + painted[i + 2]! > 90) lit += 1;
    }
    expect(lit).toBeGreaterThan(0);
  });

  it("refuses an engine without the layout it registers against", async () => {
    const { element } = canvasOf();
    const engine: Engine<CoilDebugApi> = createEngine({
      canvas: element,
      width: STAGE_W,
      height: STAGE_H,
      game,
      clock: new ConstantClock(FRAME_MS),
      surface: surfaceOf(new EventTarget()),
    });
    await expect(engine.initialize()).rejects.toThrow(LAYOUT);
    engine.destroy();
  });
});

describe("the keyboard", () => {
  it("moves the title highlight and wraps it", async () => {
    h.tap("ArrowDown");
    await h.step(1);
    expect(h.state.menuIndex).toBe(1);
    h.tap("ArrowDown");
    await h.step(1);
    expect(h.state.menuIndex).toBe(0);
  });

  it("consumes each press exactly once, however many frames follow it", async () => {
    h.tap("ArrowDown");
    await h.step(20);
    expect(h.state.menuIndex).toBe(1);
  });

  it("raises nothing for an auto-repeat", async () => {
    h.tap("ArrowDown", true);
    await h.step(1);
    expect(h.state.menuIndex).toBe(0);
  });

  it("starts a round from the mode entry with either confirm key", async () => {
    h.tap("Space");
    await h.step(1);
    expect(h.state.screen).toBe("playing");
    expect(h.state.snake.length).toBe(3);
    expect(h.state.pellet).not.toBeNull();
    expect(TITLE_ITEMS.length).toBeGreaterThan(1);
  });

  it("steers the snake with both key sets alike", async () => {
    for (const [code, dir] of [
      ["ArrowUp", "up"],
      ["KeyS", "down"],
    ] as const) {
      h.debug.setScreen("playing");
      h.debug.setDirection("right");
      h.debug.clearTurns();
      h.debug.setSnakeTravel(false);
      h.tap(code);
      await h.step(1);
      expect(h.state.turns).toEqual([dir]);
    }
  });

  it("pauses a live round with Escape and resumes it with KeyP", async () => {
    h.tap("Enter");
    await h.step(1);
    h.tap("Escape");
    await h.step(1);
    expect(h.state.screen).toBe("paused");
    h.tap("KeyP");
    await h.step(1);
    expect(h.state.screen).toBe("playing");
  });

  it("toggles the engine's mute bit with KeyM, from any screen", async () => {
    for (const screen of ["title", "playing", "paused", "gameover"] as const) {
      h.debug.setScreen(screen);
      const before = h.state.muted;
      h.tap("KeyM");
      await h.step(1);
      expect(h.engine.world.audio.muted()).toBe(!before);
      expect(h.state.muted).toBe(!before);
    }
  });
});

describe("the clock the engine owns", () => {
  it("resolves eight ticks in a second of game time", async () => {
    held();
    await h.advance(1);
    expect(h.debug.snapshot().ticks).toBe(8);
    expect(h.debug.snapshot().simTime).toBeCloseTo(1, 6);
  });

  it("reaches the same state however the second was divided", async () => {
    held();
    await h.advance(1, 60);
    const divided = h.debug.snapshot();
    h.debug.reset();
    held();
    await h.advance(1, 1);
    const whole = h.debug.snapshot();
    expect(divided.ticks).toBe(whole.ticks);
    expect(divided.simTime).toBeCloseTo(whole.simTime, 9);
  });

  it("resolves no tick for a frame shorter than one, and carries it", async () => {
    held();
    await h.advance(TICK_SECONDS / 2);
    expect(h.debug.snapshot().ticks).toBe(0);
    await h.advance(TICK_SECONDS / 2);
    expect(h.debug.snapshot().ticks).toBe(1);
  });

  it("advances at the same rate however long the snake is", async () => {
    held(Array.from({ length: 20 }, (_, i) => ({ col: 20 - i, row: 8 })));
    await h.advance(2);
    const long = h.debug.snapshot().ticks;
    h.debug.reset();
    held();
    await h.advance(2);
    expect(h.debug.snapshot().ticks).toBe(long);
  });

  it("resolves no tick on a screen that is not playing", async () => {
    await h.advance(2, 120);
    expect(h.debug.snapshot().ticks).toBe(0);
    expect(h.debug.snapshot().simTime).toBe(0);
  });

  it("accumulates simTime on the playing screen alone", async () => {
    held();
    await h.advance(1);
    const playing = h.debug.snapshot().simTime;
    goTo(h.state, "paused");
    await h.advance(1);
    expect(h.debug.snapshot().simTime).toBeCloseTo(playing, 9);
  });

  it("advances the head one cell per tick", async () => {
    h.debug.setScreen("playing");
    h.debug.setSnake([
      { col: 10, row: 8 },
      { col: 9, row: 8 },
    ]);
    h.debug.setDirection("right");
    h.debug.clearPellet();
    await h.advance(TICK_SECONDS);
    expect(h.debug.snapshot().snake[0]).toEqual({ col: 11, row: 8 });
  });

  it("freezes the round behind the pause screen", async () => {
    held();
    await h.advance(1);
    const before = h.debug.snapshot();
    h.tap("KeyP");
    await h.step(1);
    await h.advance(5, 300);
    const after = h.debug.snapshot();
    expect(after.screen).toBe("paused");
    expect(after.ticks).toBe(before.ticks);
    expect(after.snake).toEqual(before.snake);
  });

  it("ends on gameover when the head enters a fatal cell, and stops there", async () => {
    h.debug.setScreen("playing");
    h.debug.setSnake([{ col: 28, row: 8 }]);
    h.debug.setDirection("right");
    h.debug.clearPellet();
    await h.advance(TICK_SECONDS);
    const dead = h.debug.snapshot();
    expect(dead.screen).toBe("gameover");
    await h.advance(5, 300);
    const later = h.debug.snapshot();
    expect(later.ticks).toBe(dead.ticks);
    expect(later.snake).toEqual(dead.snake);
  });
});

describe("the cue bus", () => {
  it("loops the music once a round is live and stops it when it ends", async () => {
    h.tap("Enter");
    await h.step(2);
    expect(h.loops).toContain(CUES.music);
    goTo(h.state, "gameover");
    await h.step(1);
    expect(h.stops).toContain(CUES.music);
  });

  it("keeps the music looping behind the pause screen", async () => {
    h.tap("Enter");
    await h.step(2);
    goTo(h.state, "paused");
    await h.step(1);
    expect(h.stops).not.toContain(CUES.music);
  });

  it("starts the bed again on every menu item that lays a fresh round", () => {
    // Title -> RESTART from the pause menu -> PLAY AGAIN from the game over.
    handleAction(h.state, "confirm");
    handleAction(h.state, "pause");
    handleAction(h.state, "down");
    const restart = handleAction(h.state, "confirm");
    goTo(h.state, "gameover");
    const again = handleAction(h.state, "confirm");
    expect([restart.roundBegan, again.roundBegan]).toEqual([true, true]);
  });

  it("sounds nothing for a screen posed onto playing", async () => {
    h.debug.setScreen("playing");
    h.loops.length = 0;
    await h.step(3);
    expect(h.loops).toEqual([]);
  });

  it("plays the eat cue once on the tick a pellet is eaten", async () => {
    h.debug.setScreen("playing");
    h.debug.setSnake([{ col: 10, row: 8 }]);
    h.debug.setDirection("right");
    h.debug.setPellet(11, 8);
    h.cues.length = 0;
    await h.advance(TICK_SECONDS);
    expect(h.cues.filter((cue) => cue === CUES.eat).length).toBe(1);
  });

  it("plays eat and combo-up once each on a tick that does both", async () => {
    h.debug.setScreen("playing");
    h.debug.setSnake([{ col: 10, row: 8 }]);
    h.debug.setDirection("right");
    h.debug.setPellet(11, 8);
    h.debug.setPelletRespawn(false);
    h.debug.setComboWindow(1);
    h.cues.length = 0;
    await h.advance(TICK_SECONDS);
    expect(h.cues).toEqual([CUES.eat, CUES.comboUp]);
  });

  it("plays the death cue on the fatal tick", async () => {
    h.debug.setScreen("playing");
    h.debug.setSnake([{ col: 28, row: 8 }]);
    h.debug.setDirection("right");
    h.debug.clearPellet();
    h.cues.length = 0;
    await h.advance(TICK_SECONDS);
    expect(h.cues).toEqual([CUES.death]);
    expect(h.state.screen).toBe("gameover");
  });

  it("plays nothing on a frame that resolved no tick", async () => {
    held();
    h.cues.length = 0;
    await h.advance(TICK_SECONDS / 4);
    expect(h.cues).toEqual([]);
  });
});

describe("the best score", () => {
  it("rises the instant the live score passes it", async () => {
    held();
    h.debug.setScore(250);
    await h.advance(TICK_SECONDS);
    expect(h.debug.snapshot().best).toBe(250);
  });

  it("is raised back to the live score when it is posed below it", async () => {
    held();
    h.debug.setScore(400);
    h.debug.setBest(10);
    await h.advance(TICK_SECONDS);
    expect(h.debug.snapshot().best).toBe(400);
  });
});

describe("the head's bite", () => {
  it("leaves the head at rest until a pellet is eaten", async () => {
    held();
    await h.advance(TICK_SECONDS);
    expect(biteFrame(h.state)).toBe(0);
  });

  it("starts a bite on the tick a pellet is eaten and returns to rest", async () => {
    h.debug.setScreen("playing");
    h.debug.setSnake([{ col: 10, row: 8 }]);
    h.debug.setDirection("right");
    h.debug.setPellet(11, 8);
    h.debug.setPelletRespawn(false);
    await h.advance(TICK_SECONDS);
    expect(biteFrame(h.state)).toBeGreaterThan(0);
    await h.advance(BITE_SECONDS, 60);
    expect(biteFrame(h.state)).toBe(0);
  });
});

describe("drawing through the engine's pipeline", () => {
  it("paints the board where a posed round put it", async () => {
    h.debug.setScreen("playing");
    h.debug.setSnakeTravel(false);
    h.debug.setSnake([
      { col: 14, row: 8 },
      { col: 13, row: 8 },
    ]);
    h.debug.setPellet(20, 4);
    await h.step(1);
    const field = h.pixel({ col: 24, row: 12 });
    const pellet = h.pixel({ col: 20, row: 4 });
    expect(
      Math.hypot(
        pellet[0] - field[0],
        pellet[1] - field[1],
        pellet[2] - field[2],
      ),
    ).toBeGreaterThan(50);
  });

  it("leaves the state exactly as the tick left it", async () => {
    h.debug.setScreen("playing");
    h.debug.setSnakeTravel(false);
    await h.step(1);
    const before = JSON.stringify(h.debug.snapshot());
    const ctx = h.ctx as unknown as CanvasRenderingContext2D;
    renderBoardLayer(h.state, ctx);
    renderUiLayer(h.state, ctx);
    expect(JSON.stringify(h.debug.snapshot())).toBe(before);
  });
});
