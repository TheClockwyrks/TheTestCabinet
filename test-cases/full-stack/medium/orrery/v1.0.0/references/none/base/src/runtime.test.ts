import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";

import { AudioBus } from "./audio";
import { OVERLAY_TOGGLE_CODE } from "./constants";
import { createStateOps } from "./debug";
import { Diagnostics, registerGameDiagnostics } from "./diagnostics";
import { Game } from "./game";
import { Keyboard } from "./keyboard";
import { Pointer } from "./pointer";
import { Runtime } from "./runtime";
import type { MenuItemRect } from "./regions";
import type { Surface } from "./viewport";

/** A runtime over a real 2D context, with a canvas of a fixed size. */
function bench(
  width = 1280,
  height = 720,
  clock: {
    now?: () => number;
    schedule?: (frame: (now: number) => void) => void;
  } = {},
) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const surface: Surface = {
    cssWidth: () => width,
    cssHeight: () => height,
    dpr: () => 1,
    origin: () => ({ left: 0, top: 0 }),
  };
  const keys = new EventTarget();
  const pointerTarget = new EventTarget();
  const game = new Game();
  const keyboard = new Keyboard(keys);
  const pointer = new Pointer(pointerTarget, (x, y) => ({ x, y }));
  const diagnostics = new Diagnostics();
  registerGameDiagnostics(diagnostics, game);
  const runtime = new Runtime({
    canvas: canvas as unknown as HTMLCanvasElement,
    ctx: ctx as unknown as CanvasRenderingContext2D,
    surface,
    game,
    keyboard,
    pointer,
    diagnostics,
    audio: new AudioBus(),
    now: clock.now,
    schedule: clock.schedule,
  });
  return { runtime, game, keys, pointerTarget, canvas, keyboard, pointer };
}

function key(type: string, code: string): Event {
  return Object.assign(new Event(type), { code, repeat: false });
}

describe("the frame loop (specs/overview.md, specs/instrumentation.md)", () => {
  it("hands the game the frame's elapsed time while autoStep holds", () => {
    const { runtime, game } = bench();
    runtime.frame(0.25);
    expect(game.state.simTime).toBeCloseTo(0.25, 9);
  });

  it("stops feeding the wall clock while autoStep is off", () => {
    const { runtime, game } = bench();
    runtime.setAutoStep(false);
    expect(runtime.autoStep).toBe(false);
    runtime.frame(1);
    runtime.frame(1);
    expect(game.state.simTime).toBe(0);
    runtime.setAutoStep(true);
    runtime.frame(1);
    expect(game.state.simTime).toBe(1);
  });

  it("keeps reading the keys and drawing while the simulation is held", () => {
    const { runtime, game, keys, canvas } = bench();
    runtime.setAutoStep(false);
    keys.dispatchEvent(key("keydown", "ArrowDown"));
    runtime.frame(1 / 60);
    expect(game.state.menuIndex).toBe(1);
    expect(game.state.simTime).toBe(0);
    expect(canvas.width).toBe(1280);
  });

  it("runs whole frames covering the interval, each followed by a render", () => {
    const one = bench();
    createStateOps(one.game).openChallenge("extras", 0);
    createStateOps(one.game).startRun();
    one.runtime.setAutoStep(false);
    one.runtime.advance(1);

    const many = bench();
    createStateOps(many.game).openChallenge("extras", 0);
    createStateOps(many.game).startRun();
    many.runtime.setAutoStep(false);
    many.runtime.advance(1, 60);

    expect(one.game.state.simTime).toBeCloseTo(1, 9);
    expect(many.game.state.simTime).toBeCloseTo(1, 9);
    expect(many.game.state.sim?.cycle).toBe(one.game.state.sim?.cycle);
  });

  it("resolves every pointer sample of the frame, in arrival order", () => {
    const { runtime, game, pointerTarget } = bench();
    createStateOps(game).openChallenge("extras", 0);
    const move = (x: number, y: number, type = "pointermove"): Event =>
      Object.assign(new Event(type), { clientX: x, clientY: y, pointerId: 1 });
    pointerTarget.dispatchEvent(move(10, 10, "pointerdown"));
    pointerTarget.dispatchEvent(move(20, 30));
    runtime.frame(1 / 60);
    expect(game.state.pointer).toEqual({ x: 20, y: 30, down: true });
  });

  it("draws no overlay until the backtick key first shows it", () => {
    const { runtime, keys } = bench();
    expect(runtime.overlay).toBe(false);
    runtime.frame(1 / 60);
    expect(runtime.overlay).toBe(false);
    keys.dispatchEvent(key("keydown", OVERLAY_TOGGLE_CODE));
    runtime.frame(1 / 60);
    expect(runtime.overlay).toBe(true);
    keys.dispatchEvent(key("keydown", OVERLAY_TOGGLE_CODE));
    runtime.frame(1 / 60);
    expect(runtime.overlay).toBe(false);
  });

  it("draws every screen, and the overlay over them, without throwing", () => {
    const { runtime, game } = bench();
    const api = createStateOps(game);
    runtime.overlay = true;
    for (const screen of ["title", "howto", "select"] as const) {
      api.setScreen(screen);
      expect(() => runtime.draw()).not.toThrow();
    }
    api.openChallenge("extras", 9);
    api.placePart("arm", 0, 0, 0);
    api.startRun();
    expect(() => runtime.draw()).not.toThrow();
  });

  it("sizes the backing store to the space the page gave the element", () => {
    const { runtime, canvas } = bench(640, 480);
    runtime.draw();
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
  });

  it("draws nothing but the letterbox while the fit is degenerate", () => {
    const { runtime } = bench(0, 0);
    expect(() => runtime.draw()).not.toThrow();
  });

  it("starts its loop once, and schedules the next frame from it", () => {
    let scheduled = 0;
    const { runtime, game } = bench(1280, 720, {
      now: () => 0,
      schedule: (frame) => {
        scheduled += 1;
        // Three schedules: the first start, and one from each frame run.
        if (scheduled < 3) frame(scheduled * 1000);
      },
    });
    runtime.start();
    runtime.start();
    expect(scheduled).toBe(3);
    expect(game.state.simTime).toBeGreaterThan(0);
  });
});

describe("one frame's keyboard edges beside its pointer samples (specs/ui.md)", () => {
  /** A pointer event at a stage position, which is a client position here. */
  function point(type: string, x: number, y: number): Event {
    return Object.assign(new Event(type), {
      clientX: x,
      clientY: y,
      pointerId: 1,
    });
  }

  /** The middle of the region the current menu reports for `index`. */
  function middleOf(game: Game, index: number): { x: number; y: number } {
    const rect = game.menuItemRect(index);
    expect(rect, `item ${index} has a region`).not.toBeNull();
    const region = rect as MenuItemRect;
    return { x: region.x + region.w / 2, y: region.y + region.h / 2 };
  }

  it("leaves the highlight on the item the pointer named, not the keyboard", () => {
    const { runtime, game, keys, pointerTarget } = bench();
    const onExtras = middleOf(game, 1);
    keys.dispatchEvent(key("keydown", "ArrowDown"));
    pointerTarget.dispatchEvent(point("pointermove", onExtras.x, onExtras.y));
    runtime.frame(1 / 60);
    expect(game.state.menuIndex).toBe(1);
    expect(game.state.screen).toBe("title");
  });

  it("takes the keyboard's item alone when a click lands on the same frame", () => {
    const { runtime, game, keys, pointerTarget } = bench();
    createStateOps(game).setMenuIndex(1);
    // The title item the pointer clicks is an ordinary one, and its region
    // overlaps a row of the select screen that EXTRAS opens: the rows run from
    // y 120 down the stage, and this click lies inside one of them.
    const onExtras = middleOf(game, 1);
    keys.dispatchEvent(key("keydown", "Enter"));
    pointerTarget.dispatchEvent(point("pointerdown", onExtras.x, onExtras.y));
    pointerTarget.dispatchEvent(point("pointerup", onExtras.x, onExtras.y));
    runtime.frame(1 / 60);

    expect(game.state.screen).toBe("select");
    expect(game.state.mode).toBe("extras");
    // The click moved the highlight down the list it landed on, as any sample
    // does, and took nothing: no challenge was opened.
    expect(game.state.challenge).toBeNull();
    expect(game.state.challengeRef).toBeNull();
  });

  it("takes that same click on the frame after it, so the click is a live one", () => {
    const { runtime, game, keys, pointerTarget } = bench();
    createStateOps(game).setMenuIndex(1);
    const onExtras = middleOf(game, 1);
    keys.dispatchEvent(key("keydown", "Enter"));
    runtime.frame(1 / 60);
    expect(game.state.screen).toBe("select");

    pointerTarget.dispatchEvent(point("pointerdown", onExtras.x, onExtras.y));
    pointerTarget.dispatchEvent(point("pointerup", onExtras.x, onExtras.y));
    runtime.frame(1 / 60);
    expect(game.state.screen).toBe("editor");
    expect(game.state.challengeRef).toEqual({
      mode: "extras",
      index: game.state.selectIndex,
    });
  });
});
