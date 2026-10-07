// Arc Foundry under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document behind
// it, and steps it with `engine.advance` against a fixed clock. Keys and the pointer are
// driven by dispatching keyboard-shaped and pointer-shaped events at the surface's event
// target, which is the same listener a player's input reaches, and what is read back is
// the game's own state, the debug surface `initialize` returned beside it, the engine's
// cue events, and the pixels the render produced.
//
// The produced files do not resolve with no page behind the loader, so a headless run is
// exactly the case this build's fallbacks are for: every sprite is drawn from its own
// geometry and every cue plays its declared shape. That the game is fully playable this
// way is itself worth checking.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@clockwyrks/simple-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CUES, LAYOUT, STAGE_H, STAGE_W } from "./constants";
import type { FoundryDebugApi } from "./debug";
import { BACKGROUND, game, type FoundryState } from "./game";

const FRAME_MS = 1000 / 60;

class KeyEvent extends Event {
  readonly code: string;
  readonly repeat = false;

  constructor(type: "keydown" | "keyup", code: string) {
    super(type);
    this.code = code;
  }
}

class PointerEvt extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
  }
}

export interface Harness {
  readonly engine: Engine<FoundryState, FoundryDebugApi>;
  readonly state: FoundryState;
  readonly debug: FoundryDebugApi;
  readonly ctx: SKRSContext2D;
  readonly cues: { cue: string; gain: number }[];
  tap(code: string): void;
  hold(code: string): void;
  release(code: string): void;
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void;
  press(x: number, y: number): Promise<void>;
  step(frames?: number): Promise<void>;
  dispose(): void;
}

async function createHarness(): Promise<Harness> {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => STAGE_W,
    cssHeight: () => STAGE_H,
    dpr: () => 1,
    events: () => events,
  };

  // Exactly the options src/main.ts passes, plus the clock and the surface a headless
  // run needs.
  const engine = createEngine<FoundryState, FoundryDebugApi>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(FRAME_MS),
    surface,
  });

  const cues: { cue: string; gain: number }[] = [];
  engine.events.on("cue:played", ({ cue, gain }) => cues.push({ cue, gain }));

  await engine.initialize();

  const dispatch = (
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void => {
    events.dispatchEvent(new PointerEvt(type, x, y));
  };

  return {
    engine,
    get state() {
      return engine.state;
    },
    // Read off the engine rather than built here, so a build that failed to return the
    // surface beside its state fails here.
    debug: engine.debug,
    ctx,
    cues,
    tap: (code) => {
      events.dispatchEvent(new KeyEvent("keydown", code));
      events.dispatchEvent(new KeyEvent("keyup", code));
    },
    hold: (code) => events.dispatchEvent(new KeyEvent("keydown", code)),
    release: (code) => events.dispatchEvent(new KeyEvent("keyup", code)),
    pointer: dispatch,
    press: async (x, y) => {
      dispatch("pointermove", x, y);
      dispatch("pointerdown", x, y);
      await engine.advance(1);
      dispatch("pointerup", x, y);
    },
    step: async (frames = 1) => {
      await engine.advance(frames);
    },
    dispose: () => engine.destroy(),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The center of a reported control, where a press activates it. */
function center(c: {
  x: number;
  y: number;
  w: number;
  h: number;
}): [number, number] {
  return [c.x + c.w / 2, c.y + c.h / 2];
}

describe("initialization", () => {
  it("opens on the title screen with the surface in place", () => {
    const snap = h.debug.snapshot(h.state);
    expect(snap.screen).toBe("title");
    expect(snap.phase).toBeNull();
    expect(snap.version).toBe(5);
  });

  it("draws a frame without a produced file behind it", async () => {
    await h.step(2);
    expect(h.engine.frame().count).toBe(2);
  });
});

describe("the frame", () => {
  it("advances the simulation clock only on the playing screen", async () => {
    await h.step(10);
    expect(h.debug.snapshot(h.state).simTime).toBe(0);
    h.engine.apply((s) => h.debug.startRun(s));
    await h.step(60);
    expect(h.debug.snapshot(h.state).simTime).toBeCloseTo(1, 2);
  });

  it("stops the clock under the in-place pause", async () => {
    h.engine.apply((s) => h.debug.startRun(s));
    await h.step(30);
    const held = h.debug.snapshot(h.state).simTime;
    h.engine.apply((s) => h.debug.setPaused(s, true));
    await h.step(30);
    expect(h.debug.snapshot(h.state).simTime).toBeCloseTo(held, 5);
  });

  it("reaches the same clock however the span is divided into frames", async () => {
    h.engine.apply((s) => h.debug.startRun(s));
    await h.step(120);
    const twoSeconds = h.debug.snapshot(h.state).simTime;
    h.engine.apply((s) => h.debug.reset(s));
    h.engine.apply((s) => h.debug.startRun(s));
    h.engine.setClock(new ConstantClock(FRAME_MS * 4));
    await h.step(30);
    expect(h.debug.snapshot(h.state).simTime).toBeCloseTo(twoSeconds, 5);
  });
});

describe("the keyboard", () => {
  it("walks the title menu and takes the highlighted entry", async () => {
    h.tap("ArrowDown");
    await h.step();
    expect(h.debug.snapshot(h.state).menuIndex).toBe(1);
    h.tap("Enter");
    await h.step();
    expect(h.debug.snapshot(h.state).screen).toBe("howto");
  });

  it("backs out of a screen with the back action", async () => {
    h.engine.apply((s) => h.debug.setScreen(s, "mapselect"));
    h.tap("Escape");
    await h.step();
    expect(h.debug.snapshot(h.state).screen).toBe("title");
  });

  it("arms a rock from the press key during a build phase", async () => {
    h.engine.apply((s) => h.debug.startRun(s));
    h.tap("KeyB");
    await h.step();
    expect(h.debug.snapshot(h.state).held.active).toBe(true);
  });

  it("cycles the speed multiplier one step per press", async () => {
    h.engine.apply((s) => h.debug.startRun(s));
    h.tap("KeyF");
    await h.step();
    expect(h.debug.snapshot(h.state).speed).toBe(2);
    h.tap("KeyF");
    await h.step();
    expect(h.debug.snapshot(h.state).speed).toBe(4);
  });

  it("mutes from any screen, and the bar reads it", async () => {
    h.tap("KeyM");
    await h.step();
    expect(h.debug.snapshot(h.state).muted).toBe(true);
  });
});

describe("the pointer", () => {
  it("activates the control its press lands in", async () => {
    h.engine.apply((s) => h.debug.startRun(s));
    await h.step();
    const speed = h.debug
      .statusControls(h.state)
      .find((c) => c.action === "speed")!;
    await h.press(...center(speed));
    await h.step();
    expect(h.debug.snapshot(h.state).speed).toBe(2);
  });

  it("takes a menu entry at the rectangle the reading reports", async () => {
    const salvage = h.debug
      .menuButtons(h.state)
      .find((c) => c.action === "salvage")!;
    await h.press(...center(salvage));
    await h.step();
    expect(h.debug.snapshot(h.state).screen).toBe("mapselect");
  });

  it("drops a held rock where the press lands", async () => {
    h.engine.apply((s) => h.debug.startRun(s));
    h.tap("KeyB");
    await h.step();
    await h.press(300, 300);
    await h.step();
    const snap = h.debug.snapshot(h.state);
    expect(snap.structures).toHaveLength(1);
    expect(snap.structures[0]!.kind).toBe("candidate");
  });
});

describe("audio", () => {
  it("plays the stamp cue when a rock lands", async () => {
    h.engine.apply((s) => h.debug.startRun(s));
    h.cues.length = 0;
    h.engine.apply((s) => h.debug.placeRock(s, 10, 10));
    await h.step();
    expect(h.cues.map((c) => c.cue)).toContain(CUES.stamp);
  });

  it("plays a firing cue when a structure shoots", async () => {
    h.engine.apply((s) => h.debug.startRun(s));
    h.engine.apply((s) => h.debug.placeComponent(s, "capacitor", 5, 10, 10));
    h.engine.apply((s) => h.debug.spawnUnit(s, "mote"));
    const at = h.debug.snapshot(h.state).structures[0]!;
    const unit = h.debug.snapshot(h.state).units[0]!;
    h.engine.apply((s) =>
      h.debug.setUnitPosition(s, unit.id, at.cx + 20, at.cy),
    );
    h.engine.apply((s) => h.debug.setUnitFrozen(s, unit.id, true));
    h.cues.length = 0;
    await h.step(30);
    expect(h.cues.map((c) => c.cue)).toContain(CUES.fireBolt);
  });
});

describe("rendering", () => {
  it("clears the stage to the background it declares", async () => {
    await h.step();
    const { data } = h.ctx.getImageData(2, 2, 1, 1);
    expect([data[0], data[1], data[2]]).toEqual([5, 8, 12]);
  });

  it("draws the yard once a run has begun", async () => {
    h.engine.apply((s) => h.debug.startRun(s));
    await h.step();
    const { data } = h.ctx.getImageData(400, 400, 1, 1);
    // The substrate is lighter than the letterbox void behind the stage.
    expect(data[0] + data[1] + data[2]).toBeGreaterThan(5 + 8 + 12);
  });
});
