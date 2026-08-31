import { createCanvas } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Assets } from "./assets";
import { WebAudioBus } from "./audio";
import { STAGE_H, STAGE_W, TICK_DT } from "./constants";
import { Diagnostics, registerGameDiagnostics } from "./diagnostics";
import { Game } from "./game";
import { Keyboard } from "./input";
import { Runtime } from "./runtime";

interface Built {
  runtime: Runtime;
  game: Game;
  keyboard: Keyboard;
  audio: WebAudioBus;
}

function build(): Built {
  const audio = new WebAudioBus();
  const game = new Game({
    toggleMute: () => {
      audio.muted = !audio.muted;
    },
    isMuted: () => audio.muted,
  });
  const keyboard = new Keyboard();
  const diagnostics = new Diagnostics();
  registerGameDiagnostics(diagnostics, game);
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const runtime = new Runtime({
    canvas: canvas as unknown as HTMLCanvasElement,
    ctx: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
    game,
    assets: new Assets(),
    keyboard,
    diagnostics,
    audio,
  });
  return { runtime, game, keyboard, audio };
}

const globals = globalThis as { window?: unknown };

beforeEach(() => {
  globals.window = { devicePixelRatio: 1 };
});

afterEach(() => {
  delete globals.window;
});

describe("a frame", () => {
  it("delivers a held edge on a menu screen and moves the lamplighter on playing", () => {
    const { runtime, game, keyboard } = build();
    keyboard.keyDown("ArrowDown", false);
    runtime.step(1);
    expect(game.state.menuIndex).toBe(1);
    expect(game.state.simTime).toBeCloseTo(TICK_DT, 12);
    expect(game.state.run.tick).toBe(0);
    keyboard.keyUp("ArrowDown");
    keyboard.keyDown("ArrowUp", false);
    keyboard.keyDown("Enter", false);
    runtime.step(1);
    // The edge starts the run, and the frame's update runs on the screen
    // the edges left, so the first tick lands in the same frame.
    expect(game.state.screen).toBe("playing");
    expect(game.state.run.tick).toBe(1);
    expect(game.state.run.player.y).toBeCloseTo(-3, 6);
    keyboard.keyUp("Enter");
    keyboard.keyUp("ArrowUp");
    keyboard.keyDown("ArrowRight", false);
    runtime.step(60);
    expect(game.state.run.tick).toBe(61);
    expect(game.state.run.player.x).toBeCloseTo(180, 6);
    expect(game.state.run.player.y).toBeCloseTo(-3, 6);
  });

  it("reads every edge against the screen the frame began on", () => {
    const { runtime, game, keyboard } = build();
    keyboard.keyDown("Enter", false);
    keyboard.keyDown("KeyP", false);
    runtime.step(1);
    expect(game.state.screen).toBe("playing");
    expect(game.state.run.tick).toBe(1);
  });

  it("holds the accumulator off the wall clock under setAutoStep(false)", () => {
    const { runtime, game } = build();
    game.startRun();
    runtime.setAutoStep(false);
    expect(runtime.autoStep).toBe(false);
    runtime.advance(0.5);
    expect(game.state.run.tick).toBe(30);
    runtime.advance(0.025);
    expect(game.state.run.tick).toBe(31);
    expect(game.state.accumulator).toBeCloseTo(0.025 - TICK_DT, 12);
    runtime.step(1);
    expect(game.state.run.tick).toBe(32);
    expect(game.state.accumulator).toBeCloseTo(0.025 - TICK_DT, 12);
    expect(game.state.simTime).toBeCloseTo(0.525 + TICK_DT, 12);
  });

  it("discards a posed remainder when pause leaves playing", () => {
    const { runtime, game, keyboard } = build();
    game.startRun();
    runtime.advance(0.025);
    keyboard.keyDown("KeyP", false);
    runtime.step(1);
    expect(game.state.screen).toBe("paused");
    expect(game.state.accumulator).toBe(0);
  });

  it("ticks nothing on a frame off playing and keeps the frames coming", () => {
    const { runtime, game } = build();
    game.startRun();
    game.state.run.pendingLevelUps = 1;
    runtime.step(3);
    expect(game.state.screen).toBe("levelup");
    expect(game.state.run.tick).toBe(1);
    expect(game.state.simTime).toBeCloseTo(3 * TICK_DT, 12);
    runtime.advance(1);
    expect(game.state.run.tick).toBe(1);
    expect(game.state.accumulator).toBe(0);
  });

  it("mirrors the mute bit and toggles the overlay on the backtick", () => {
    const { runtime, game, keyboard, audio } = build();
    keyboard.keyDown("KeyM", false);
    keyboard.keyDown("Backquote", false);
    runtime.step(1);
    expect(audio.muted).toBe(true);
    expect(game.state.muted).toBe(true);
    expect(runtime.overlay).toBe(true);
    keyboard.keyUp("Backquote");
    keyboard.keyDown("Backquote", false);
    runtime.step(1);
    expect(runtime.overlay).toBe(false);
  });

  it("runs the wall clock through requestAnimationFrame", () => {
    const { runtime, game } = build();
    const frames: FrameRequestCallback[] = [];
    const g = globalThis as {
      requestAnimationFrame?: (callback: FrameRequestCallback) => number;
      performance: Performance;
    };
    g.requestAnimationFrame = (callback) => {
      frames.push(callback);
      return frames.length;
    };
    try {
      game.startRun();
      runtime.start();
      runtime.start();
      const now = performance.now();
      frames.shift()!(now + 500);
      expect(game.state.run.tick).toBe(15);
      frames.shift()!(now + 500 + 1000 / 60);
      expect(game.state.run.tick).toBe(16);
      runtime.setAutoStep(false);
      frames.shift()!(now + 5000);
      expect(game.state.run.tick).toBe(16);
      expect(frames).toHaveLength(1);
    } finally {
      delete g.requestAnimationFrame;
    }
  });
});
