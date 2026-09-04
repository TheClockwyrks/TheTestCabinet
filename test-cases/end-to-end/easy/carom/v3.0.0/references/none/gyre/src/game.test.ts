// Carom over its own runtime, in process.
//
// Every check here stands the real runtime up over an `@napi-rs/canvas` canvas
// and a `Surface` of its own, so the game runs with no browser and no document
// behind it, and steps it with `advance` — which makes a duration an exact number
// of frames of an exact length, and the arithmetic asserted below the arithmetic
// specs/ names. What is read back is the game's own state, the cues its update
// played, and the pixels its render produced.
//
// THE SURFACE IS ATOMIC, SO THE SEQUENCES LIVE HERE. Every operation on
// `window.__carom` sets one field, places or removes one entity, or moves the
// clock; opening a match, staging a rally and freezing the obstacles are
// therefore SEQUENCES of those, written once as the helpers below.
//
// The runtime itself is checked in `src/runtime.test.ts`; this file is the game.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BALL_R,
  CUES,
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  FIELD_W,
  HOLD_TIME,
  OBSTACLE_CENTERS,
  OBSTACLE_SPIN_RATE,
  OBSTACLE_SWAY_PERIOD,
  P1_X0,
  PADDLE_SPEED,
  PADDLE_W,
  SERVE_ANGLE,
  SERVE_SPEED,
  SPIN_FROM_PADDLE,
  TITLE_ITEMS,
  WIN_SCORE,
} from "./constants";
import {
  CAROM_HANDLE,
  createDebugApi,
  installDebugApi,
  type BallSnapshot,
  type CaromDebugApi,
} from "./debug";
import { game, type BallState, type CaromState, type Side } from "./game";
import { menuItemRect } from "./menu";
import { obstaclePose } from "./obstacles";
import { createRuntime, type Game, type Runtime } from "./runtime";
import type { Surface, Viewport } from "./viewport";

// ---- The harness --------------------------------------------------------

/** The frame length every check below counts in, unless it says otherwise. */
const TICK = 1 / 60;

type DrawCall =
  | { kind: "call"; method: string; args: unknown[] }
  | { kind: "set"; property: string; value: unknown };

/** How a check poses the ball: whatever of it the scenario cares about. */
type BallPose = Partial<Pick<BallState, "x" | "y" | "vx" | "vy" | "spin">>;

interface Harness {
  readonly runtime: Runtime<CaromState>;
  readonly state: CaromState;
  readonly debug: CaromDebugApi;
  readonly ctx: SKRSContext2D;
  readonly calls: DrawCall[];
  readonly cues: string[];
  /** Run `frames` frames of `TICK` seconds each. */
  run(frames: number): void;
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  /** Move the mouse to a logical point, and run the frame that reads it. */
  movePointer(x: number, y: number): void;
  /** Press the mouse at a logical point, and run the frame that reads it. */
  pressPointer(x: number, y: number): void;
  /** Release the mouse where it stands, and run the frame that reads it. */
  releasePointer(): void;
  /** Land a touch contact at a logical point, and run the frame that reads it. */
  touchDown(x: number, y: number): void;
  /** Travel the held contact, and run the frame that reads it. */
  touchMove(x: number, y: number): void;
  /** Lift the contact, and run the frame that reads it. */
  touchUp(): void;
  pixel(x: number, y: number): [number, number, number, number];
  dispose(): void;
}

class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

/**
 * A pointer event as the browser raises one, reduced to the three fields the
 * build reads off it. Node has no `PointerEvent`, and the build narrows an event
 * structurally for exactly this reason.
 */
class PointerEventStub extends Event {
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;

  constructor(type: string, x: number, y: number, pointerType: string) {
    super(type);
    this.pointerType = pointerType;
    this.clientX = x;
    this.clientY = y;
  }
}

/** The number of `TICK` frames that covers `seconds`. */
function frames(seconds: number): number {
  return Math.ceil(seconds * 60);
}

/** A 2D context that writes down every call and property set made through it. */
function recorder(target: SKRSContext2D, calls: DrawCall[]): SKRSContext2D {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push({ kind: "call", method: String(property), args });
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      calls.push({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
}

function callsTo(calls: readonly DrawCall[], method: string): unknown[][] {
  return calls.flatMap((call) =>
    call.kind === "call" && call.method === method ? [call.args] : [],
  );
}

function toDevice(view: Viewport, x: number, y: number): [number, number] {
  return [
    Math.round(view.offsetX + x * view.scale),
    Math.round(view.offsetY + y * view.scale),
  ];
}

function createHarness(): Harness {
  const canvas = createCanvas(FIELD_W, FIELD_H);
  const ctx = canvas.getContext("2d");
  const calls: DrawCall[] = [];
  const recorded = recorder(ctx, calls);
  const element = Object.assign(canvas, {
    getContext: () => recorded,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const surface: Surface = {
    cssWidth: () => FIELD_W,
    cssHeight: () => FIELD_H,
    dpr: () => 1,
    // The canvas fills the page, so a client point IS a logical point at this
    // size — which is what makes the figures below readable.
    origin: () => ({ x: 0, y: 0 }),
    events: () => events,
  };

  // The game, with the one call a check wants to overhear — which cue an event
  // played — written down on its way through. Everything else is untouched, so
  // what runs is the real update against the real runtime.
  const cues: string[] = [];
  const observed: Game<CaromState> = {
    initialize: (api) => game.initialize(api),
    update: (state, api, dt) =>
      game.update(
        state,
        {
          input: api.input,
          audio: {
            play: (cue) => {
              cues.push(cue);
              api.audio.play(cue);
            },
            setMuted: (muted) => api.audio.setMuted(muted),
            muted: () => api.audio.muted(),
          },
        },
        dt,
      ),
    render: (state, api) => game.render(state, api),
  };

  const runtime = createRuntime<CaromState>({
    canvas: element,
    width: FIELD_W,
    height: FIELD_H,
    game: observed,
    background: "#0b0e14",
    surface,
    // Node has no Web Audio. The bus stays silent; the cues above still record.
    audioContext: () => null,
  });

  const state = runtime.initialize();
  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };
  const run = (count: number): void => {
    runtime.advance(count * TICK, count);
  };
  // Where each device last was. A real mouse release carries the position the
  // mouse stands at, and a real touch end carries no position at all — both of
  // which this reproduces.
  const at = { mouse: { x: 0, y: 0 }, touch: { x: 0, y: 0 } };
  const point = (
    type: string,
    x: number,
    y: number,
    kind: "mouse" | "touch",
  ): void => {
    at[kind] = { x, y };
    events.dispatchEvent(new PointerEventStub(type, x, y, kind));
    run(1);
  };

  return {
    runtime,
    state,
    debug: createDebugApi(state, runtime),
    ctx,
    calls,
    cues,
    run,
    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    tap: (code) => {
      dispatch("keydown", code);
      dispatch("keyup", code);
    },
    movePointer: (x, y) => point("pointermove", x, y, "mouse"),
    pressPointer: (x, y) => point("pointerdown", x, y, "mouse"),
    releasePointer: () => point("pointerup", at.mouse.x, at.mouse.y, "mouse"),
    touchDown: (x, y) => point("pointerdown", x, y, "touch"),
    touchMove: (x, y) => point("pointermove", x, y, "touch"),
    // A real touch end carries no position, so this hands over a nonsense one:
    // the build resolves the lift where the contact last was.
    touchUp: () => point("pointerup", -1, -1, "touch"),
    pixel: (x, y) => {
      const [dx, dy] = toDevice(runtime.viewport(), x, y);
      const { data } = ctx.getImageData(dx, dy, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
    dispose: () => runtime.destroy(),
  };
}

let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

afterEach(() => {
  harness.dispose();
});

/** The ball a snapshot reports, which every scenario below has put on the field. */
function ballOf(h: Harness): BallSnapshot {
  const { ball } = h.debug.snapshot();
  if (ball === null) throw new Error("no ball on the field");
  return ball;
}

/** The live ball record, for a check that reads the state rather than a snapshot. */
function liveBall(h: Harness): BallState {
  const ball = h.state.ball;
  if (ball === null) throw new Error("no ball on the field");
  return ball;
}

/**
 * Open a match on its pre-serve countdown through the surface alone.
 *
 * `reset` puts every declared field at its title value — which is, field for
 * field, what specs/ui.md says starting a match sets — so a match opens in two
 * more operations: the mode, and the screen.
 */
function openCountdown(h: Harness, mode: "solo" | "versus"): void {
  h.debug.reset();
  h.debug.setMode(mode);
  h.debug.setScreen("countdown");
}

/** Pose the ball, one operation per field the scenario cares about. */
function poseBall(h: Harness, pose: BallPose): void {
  if (pose.x !== undefined || pose.y !== undefined) {
    const ball = ballOf(h);
    h.debug.setBallPosition(pose.x ?? ball.x, pose.y ?? ball.y);
  }
  if (pose.vx !== undefined || pose.vy !== undefined) {
    const ball = ballOf(h);
    h.debug.setBallVelocity(pose.vx ?? ball.vx, pose.vy ?? ball.vy);
  }
  if (pose.spin !== undefined) h.debug.setBallSpin(pose.spin);
}

/**
 * Take the match to a live rally with the ball posed exactly as asked.
 *
 * Both paddles are driven at rest and the obstacle clock is stopped at zero, so
 * the shot meets a still field: a body that would otherwise sweep through the
 * scenario is held rather than left to chance. `driven` names the sides the
 * caller wants taken, so a check about the AI can leave the right paddle with it.
 */
function rally(
  h: Harness,
  mode: "solo" | "versus",
  pose: BallPose,
  driven: readonly Side[] = ["left", "right"],
): void {
  openCountdown(h, mode);
  h.debug.setObstacleClockRunning(false);
  h.debug.setObstacleClock(0);
  for (const side of driven) h.debug.setPaddleDriven(side, true);
  h.debug.setBallHoldTimer(0);
  h.run(1); // the launch, through the build's own serve
  poseBall(h, pose);
}

/** The center of item `index` of the menu the given screen shows. */
function itemCenter(h: Harness, index: number): { x: number; y: number } {
  const rect = h.debug.menuItemRect(index);
  if (rect === null) throw new Error(`no region for item ${index}`);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

// ---- Boot ---------------------------------------------------------------

describe("initialization", () => {
  it("opens on the title screen with every declared field at its title value", () => {
    const { state } = harness;
    expect(state.screen).toBe("title");
    expect(state.mode).toBe("solo");
    expect(state.menuIndex).toBe(0);
    expect(state.titleIndex).toBe(0);
    expect(state.resumeScreen).toBe("playing");
    expect(state.score).toEqual({ p1: 0, p2: 0 });
    expect(state.winner).toBeNull();
    expect(state.receiver).toBe("left");
    expect(state.ai).toEqual({ tracking: true, movement: true });
    expect(state.paddles.left).toEqual({
      cy: FIELD_CY,
      vy: 0,
      drivenVy: 0,
      driven: false,
    });
    expect(state.paddles.right).toEqual(state.paddles.left);
    expect(state.ball).toEqual({
      x: FIELD_CX,
      y: FIELD_CY,
      vx: 0,
      vy: 0,
      spin: 0,
      held: true,
      holdTimer: HOLD_TIME,
      trail: [],
    });
    expect(state.obstacles.map((o) => o.index)).toEqual([0, 1]);
    expect(state.obstacleClock).toBe(0);
    expect(state.obstacleClockRunning).toBe(true);
    expect(state.simTime).toBe(0);
    expect(state.seed).toBe(1);
    expect(state.rngState).toBe(1);
  });

  it("accumulates simulation time from the deltas it is handed", () => {
    harness.run(30);
    expect(harness.runtime.frame().count).toBe(30);
    expect(harness.state.simTime).toBeCloseTo(0.5, 9);
  });

  it("accumulates it on every screen, the menus and a pause included", () => {
    harness.run(10); // the title
    harness.debug.setScreen("paused");
    harness.run(10);
    expect(harness.state.simTime).toBeCloseTo(20 * TICK, 9);
  });
});

// ---- Menus: the keyboard ------------------------------------------------

describe("the menus", () => {
  it("starts a Solo match from the first item", () => {
    harness.tap("Enter");
    harness.run(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("solo");
    expect(liveBall(harness).holdTimer).toBeCloseTo(HOLD_TIME - TICK, 9);
  });

  it("moves the selection with either side's slider", () => {
    harness.tap("ArrowDown");
    harness.run(1);
    expect(harness.state.menuIndex).toBe(1);

    harness.tap("KeyW");
    harness.run(1);
    expect(harness.state.menuIndex).toBe(0);
  });

  it("wraps both ways over the title items", () => {
    harness.tap("KeyW");
    harness.run(1);
    expect(harness.state.menuIndex).toBe(TITLE_ITEMS.length - 1);

    harness.tap("KeyS");
    harness.run(1);
    expect(harness.state.menuIndex).toBe(0);
  });

  it("starts a Versus match from the second item", () => {
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("Space");
    harness.run(1);
    expect(harness.state.mode).toBe("versus");
    expect(harness.state.screen).toBe("countdown");
  });

  it("opens and leaves the how-to-play screen", () => {
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("ArrowDown");
    harness.run(1);
    expect(harness.state.menuIndex).toBe(2);
    harness.tap("Enter");
    harness.run(1);
    expect(harness.state.screen).toBe("howto");
    expect(harness.state.menuIndex).toBe(0);

    harness.tap("Escape");
    harness.run(1);
    expect(harness.state.screen).toBe("title");
  });

  it("leaves the how-to screen by confirming its single item too", () => {
    harness.debug.setScreen("howto");
    harness.tap("Enter");
    harness.run(1);
    expect(harness.state.screen).toBe("title");
  });

  it("consumes a press exactly once", () => {
    harness.tap("ArrowDown");
    harness.run(10);
    expect(harness.state.menuIndex).toBe(1);
  });

  it("moves only, on a frame carrying both a movement edge and a confirm", () => {
    harness.hold("ArrowDown");
    harness.hold("Enter");
    harness.run(1);
    harness.release("ArrowDown");
    harness.release("Enter");
    expect(harness.state.menuIndex).toBe(1);
    expect(harness.state.screen).toBe("title");
  });

  it("moves up only, on a frame carrying both an up edge and a down edge", () => {
    harness.debug.setMenuIndex(1);
    harness.hold("ArrowUp");
    harness.hold("ArrowDown");
    harness.run(1);
    expect(harness.state.menuIndex).toBe(0);
  });

  it("does nothing on the title when `back` is pressed", () => {
    harness.tap("Escape");
    harness.run(1);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(0);
  });
});

// ---- The remembered title selection --------------------------------------

describe("the remembered title selection", () => {
  it("remembers the item that led away from the title and selects it on return", () => {
    harness.tap("ArrowDown"); // VERSUS
    harness.run(1);
    harness.tap("Enter");
    harness.run(1);
    expect(harness.state.titleIndex).toBe(1);
    expect(harness.state.menuIndex).toBe(0); // a match opens on its own item 0

    harness.debug.setScreen("matchover");
    harness.debug.setMenuIndex(1); // MENU
    harness.tap("Enter");
    harness.run(1);

    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(1);
  });

  it("keeps it across a match start and restores it from the pause menu", () => {
    harness.debug.setTitleIndex(2);
    harness.debug.setMenuIndex(2);
    harness.tap("Enter"); // HOW TO PLAY
    harness.run(1);
    expect(harness.state.screen).toBe("howto");

    harness.tap("Escape");
    harness.run(1);
    expect(harness.state.menuIndex).toBe(2);
  });

  it("returns from a quit to the entry that started the match", () => {
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("Enter"); // VERSUS
    harness.run(1);
    harness.tap("KeyP");
    harness.run(1);
    harness.debug.setMenuIndex(2); // QUIT TO MENU
    harness.tap("Enter");
    harness.run(1);

    expect(harness.state.screen).toBe("title");
    expect(harness.state.titleIndex).toBe(1);
    expect(harness.state.menuIndex).toBe(1);
  });

  it("starts a match without disturbing the remembered selection", () => {
    harness.debug.setTitleIndex(2);
    harness.debug.setScreen("matchover");
    harness.debug.setMenuIndex(0); // PLAY AGAIN
    harness.tap("Enter");
    harness.run(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.titleIndex).toBe(2);
    expect(harness.state.menuIndex).toBe(0);
  });
});

// ---- Menus: the pointer and the finger -----------------------------------

describe("the menus under a pointer", () => {
  it("reports a region for each item of the current menu and none beyond it", () => {
    expect(harness.debug.menuItemRect(0)).not.toBeNull();
    expect(harness.debug.menuItemRect(TITLE_ITEMS.length - 1)).not.toBeNull();
    expect(harness.debug.menuItemRect(TITLE_ITEMS.length)).toBeNull();
    expect(harness.debug.menuItemRect(-1)).toBeNull();
  });

  it("reports no region at all on the screens that show no menu", () => {
    for (const screen of ["countdown", "playing"] as const) {
      harness.debug.setScreen(screen);
      expect(harness.debug.menuItemRect(0)).toBeNull();
    }
  });

  it("keeps neighbouring regions apart", () => {
    const a = harness.debug.menuItemRect(0)!;
    const b = harness.debug.menuItemRect(1)!;
    expect(a.y + a.h).toBeLessThan(b.y);
  });

  it("selects the item the pointer moves onto", () => {
    const second = itemCenter(harness, 1);
    harness.movePointer(second.x, second.y);
    expect(harness.state.menuIndex).toBe(1);
    expect(harness.state.screen).toBe("title");
  });

  it("selects nothing when the pointer is nowhere near an item", () => {
    harness.debug.setMenuIndex(2);
    harness.movePointer(20, 20);
    expect(harness.state.menuIndex).toBe(2);
  });

  it("confirms an item pressed and released inside its own region", () => {
    const second = itemCenter(harness, 1);
    harness.pressPointer(second.x, second.y);
    expect(harness.state.menuIndex).toBe(1);
    expect(harness.state.screen).toBe("title");

    harness.releasePointer();
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("versus");
    expect(harness.state.titleIndex).toBe(1);
  });

  it("confirms on a frame that carries both the press and the release", () => {
    // Both edges land before the frame that reads them, which is the "a press and
    // the release that follows it may arrive on one frame" case specs/ui.md
    // fixes. The harness runs a frame per edge, so this is that case driven by
    // hand instead.
    const first = itemCenter(harness, 0);
    harness.pressPointer(first.x, first.y);
    harness.releasePointer();
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("solo");
  });

  it("confirms nothing when the press and the release fall in different items", () => {
    const from = itemCenter(harness, 0);
    const to = itemCenter(harness, 2);
    harness.pressPointer(from.x, from.y);
    harness.movePointer(to.x, to.y);
    harness.releasePointer();

    expect(harness.state.menuIndex).toBe(2);
    expect(harness.state.screen).toBe("title");
  });

  it("confirms nothing when the press begins outside every region", () => {
    harness.pressPointer(20, 20);
    const first = itemCenter(harness, 0);
    harness.movePointer(first.x, first.y);
    harness.releasePointer();
    expect(harness.state.screen).toBe("title");
  });

  it("selects and confirms a touch contact that lands and lifts on one item", () => {
    const third = itemCenter(harness, 2);
    harness.touchDown(third.x, third.y);
    expect(harness.state.menuIndex).toBe(2); // a finger does not hover
    expect(harness.state.screen).toBe("title");

    harness.touchUp();
    expect(harness.state.screen).toBe("howto");
    expect(harness.state.titleIndex).toBe(2);
  });

  it("confirms nothing when a contact travels between two items", () => {
    const from = itemCenter(harness, 0);
    const to = itemCenter(harness, 1);
    harness.touchDown(from.x, from.y);
    harness.touchMove(to.x, to.y);
    harness.touchUp();

    expect(harness.state.menuIndex).toBe(1);
    expect(harness.state.screen).toBe("title");
  });

  it("drives the pause menu and the match-over menu the same way", () => {
    openCountdown(harness, "versus");
    harness.debug.setScreen("paused");
    const quit = itemCenter(harness, 2);
    harness.pressPointer(quit.x, quit.y);
    harness.releasePointer();
    expect(harness.state.screen).toBe("title");

    harness.debug.setScreen("matchover");
    const again = itemCenter(harness, 0);
    harness.touchDown(again.x, again.y);
    harness.touchUp();
    expect(harness.state.screen).toBe("countdown");
  });

  it("leaves menuIndex where the pointer put it when a keyboard edge shares the frame", () => {
    const third = itemCenter(harness, 2);
    harness.hold("ArrowDown"); // would move 0 -> 1
    harness.movePointer(third.x, third.y);
    harness.release("ArrowDown");
    expect(harness.state.menuIndex).toBe(2);
  });

  it("confirms the keyboard's item alone when both confirm on one frame", () => {
    // The keyboard's confirm acts on item 0; the finger is on item 2 and is not
    // read at all on a frame the keyboard already confirmed.
    const third = itemCenter(harness, 2);
    harness.hold("Enter");
    harness.touchDown(third.x, third.y);
    harness.release("Enter");
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("solo");
    expect(harness.state.titleIndex).toBe(0);
  });

  it("ignores the pointer entirely on the live field", () => {
    rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 0, vy: 0 });
    const before = harness.debug.snapshot();
    harness.pressPointer(FIELD_CX, 440);
    harness.releasePointer();
    expect(harness.state.screen).toBe("playing");
    expect(harness.state.menuIndex).toBe(before.menuIndex);
  });
});

// ---- Controls -----------------------------------------------------------

describe("the paddles", () => {
  it("moves player one at PADDLE_SPEED while a movement action is held", () => {
    harness.tap("Enter");
    harness.run(1);

    harness.hold("KeyW");
    harness.run(frames(0.1));
    expect(harness.state.paddles.left.cy).toBeCloseTo(
      FIELD_CY - PADDLE_SPEED * 0.1,
      6,
    );

    harness.release("KeyW");
    harness.run(frames(0.1));
    expect(harness.state.paddles.left.cy).toBeCloseTo(
      FIELD_CY - PADDLE_SPEED * 0.1,
      6,
    );
  });

  it("drives player one from either slider in Solo", () => {
    harness.tap("Enter");
    harness.run(1);

    harness.hold("ArrowDown");
    harness.run(frames(0.1));
    expect(harness.state.paddles.left.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.1,
      6,
    );
  });

  it("stands still when opposite sliders are held in Solo", () => {
    harness.tap("Enter");
    harness.run(1);

    harness.hold("KeyW");
    harness.hold("ArrowDown");
    harness.run(30);
    expect(harness.state.paddles.left.cy).toBe(FIELD_CY);

    // A second up action adds nothing: up is held or it is not.
    harness.hold("ArrowUp");
    harness.run(30);
    expect(harness.state.paddles.left.cy).toBe(FIELD_CY);
  });

  it("gives the second slider its own paddle in Versus", () => {
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("Enter");
    harness.run(1);

    harness.hold("ArrowDown");
    harness.run(frames(0.1));
    expect(harness.state.paddles.right.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.1,
      6,
    );
    expect(harness.state.paddles.left.cy).toBe(FIELD_CY);
  });

  it("moves both paddles on a countdown frame exactly as on a playing one", () => {
    openCountdown(harness, "versus");
    harness.hold("KeyW");
    harness.hold("ArrowDown");
    harness.run(frames(0.1));
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.paddles.left.cy).toBeCloseTo(
      FIELD_CY - PADDLE_SPEED * 0.1,
      6,
    );
    expect(harness.state.paddles.right.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.1,
      6,
    );
  });
});

// ---- Serving ------------------------------------------------------------

describe("serving", () => {
  it("holds the ball for HOLD_TIME and then launches it", () => {
    openCountdown(harness, "versus");
    harness.run(frames(HOLD_TIME) - 1);
    expect(harness.state.screen).toBe("countdown");
    expect(ballOf(harness).held).toBe(true);

    harness.run(2);
    expect(harness.state.screen).toBe("playing");
    expect(ballOf(harness).held).toBe(false);
    expect(ballOf(harness).holdTimer).toBe(0);
  });

  it("sends the first serve of a match toward player one", () => {
    openCountdown(harness, "versus");
    harness.run(frames(HOLD_TIME) + 1);
    const ball = ballOf(harness);
    expect(ball.vx).toBeLessThan(0);
    expect(ball.speed).toBeCloseTo(SERVE_SPEED, 6);
  });

  it("serves at exactly SERVE_ANGLE from horizontal, up or down", () => {
    openCountdown(harness, "versus");
    harness.debug.setBallHoldTimer(0);
    harness.run(1);
    const ball = ballOf(harness);
    expect(Math.abs(Math.atan2(ball.vy, Math.abs(ball.vx)))).toBeCloseTo(
      SERVE_ANGLE,
      9,
    );
  });

  it("aims the serve at whichever side is the receiver", () => {
    openCountdown(harness, "versus");
    harness.debug.setReceiver("right");
    harness.debug.setBallHoldTimer(0);
    harness.run(1);
    expect(ballOf(harness).vx).toBeGreaterThan(0);
  });

  it("does not advance the ball on the frame it is served", () => {
    openCountdown(harness, "versus");
    harness.debug.setBallHoldTimer(0);
    harness.run(1);
    const ball = ballOf(harness);
    expect(ball.x).toBe(FIELD_CX);
    expect(ball.y).toBe(FIELD_CY);
  });

  it("replays the same serve from the same seed", () => {
    const other = createHarness();
    try {
      for (const h of [harness, other]) {
        h.debug.reset();
        h.debug.setSeed(4242);
        openCountdownKeepingSeed(h);
        h.debug.setBallHoldTimer(0);
        h.run(1);
      }
      expect(ballOf(other).vy).toBe(ballOf(harness).vy);
    } finally {
      other.dispose();
    }
  });

  it("takes the generator's state forward on every serve it draws for", () => {
    openCountdown(harness, "versus");
    const before = harness.debug.snapshot().rngState;
    harness.debug.setBallHoldTimer(0);
    harness.run(1);
    expect(harness.debug.snapshot().rngState).not.toBe(before);
    // The seed itself is what was last asked for, and a draw does not move it.
    expect(harness.debug.snapshot().seed).toBe(1);
  });
});

/** Open a countdown without the `reset` that would undo a chosen seed. */
function openCountdownKeepingSeed(h: Harness): void {
  h.debug.setMode("versus");
  h.debug.setScreen("countdown");
}

// ---- Physics, through the runtime ---------------------------------------

describe("the rally", () => {
  it("returns the ball off a paddle and plays the paddle cue", () => {
    rally(harness, "versus", { x: 120, y: FIELD_CY, vx: -600, vy: 0 });
    harness.debug.setPaddleCy("left", FIELD_CY);
    harness.debug.setPaddleVy("left", 200);
    harness.cues.length = 0;

    harness.run(6);

    expect(harness.cues).toEqual([CUES.paddleHit]);
    const ball = ballOf(harness);
    expect(ball.vx).toBeGreaterThan(0);
    // The paddle was travelling down at 200 units per second when it struck.
    expect(ball.spin).toBeGreaterThan(0.9 * 200 * SPIN_FROM_PADDLE);
    expect(ball.spin).toBeLessThanOrEqual(200 * SPIN_FROM_PADDLE);
  });

  it("bounces off the top wall and plays the wall cue", () => {
    rally(harness, "versus", { x: FIELD_CX, y: 20, vx: 0, vy: -600 });
    harness.cues.length = 0;

    harness.run(3);

    expect(harness.cues).toEqual([CUES.wallBounce]);
    expect(ballOf(harness).vy).toBeGreaterThan(0);
  });

  it("bounces off an obstacle and plays the obstacle cue", () => {
    // The obstacle clock is stopped at zero, so the ball meets obstacle A upright
    // and square rather than mid-sweep.
    rally(harness, "versus", { x: 450, y: 220, vx: 600, vy: 0 });
    harness.cues.length = 0;

    harness.run(3);

    expect(harness.cues).toEqual([CUES.obstacleBounce]);
    expect(ballOf(harness).vx).toBeLessThan(0);
  });

  it("records a trail that spans a slice of time, not of frames", () => {
    // TRAIL_TIME is a window of TIME, so a finer step fills the same window with
    // more samples. Both harnesses cover the same third of a second.
    const pose = { x: 300, y: FIELD_CY, vx: 400, vy: 0 };
    rally(harness, "versus", pose);
    harness.run(20);
    const coarse = liveBall(harness).trail.length;

    const fine = createHarness();
    try {
      rally(fine, "versus", pose);
      fine.runtime.advance(20 / 60, 80); // four times as finely
      expect(liveBall(fine).trail.length).toBeGreaterThan(coarse);
    } finally {
      fine.dispose();
    }
  });
});

// ---- What is on the field -----------------------------------------------

describe("the world", () => {
  it("empties the field and leaves the paddles on it", () => {
    rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.debug.clearWorld();

    const shot = harness.debug.snapshot();
    expect(shot.ball).toBeNull();
    expect(shot.obstacles).toEqual([]);
    expect(shot.paddles.left.cy).toBe(FIELD_CY);

    harness.run(30);
    expect(harness.debug.snapshot().ball).toBeNull();
  });

  it("scores no point and plays no cue with no ball on the field", () => {
    rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.debug.clearWorld();
    harness.cues.length = 0;

    harness.run(30);

    expect(harness.state.score).toEqual({ p1: 0, p2: 0 });
    expect(harness.cues).toEqual([]);
    expect(harness.state.screen).toBe("playing");
  });

  it("spawns the ball back at its home point, held, with a full timer", () => {
    rally(harness, "versus", { x: 300, y: 100, vx: 400, vy: 0 });
    harness.debug.clearWorld();
    harness.debug.spawnBall();

    const ball = ballOf(harness);
    expect(ball.x).toBe(FIELD_CX);
    expect(ball.y).toBe(FIELD_CY);
    expect(ball.held).toBe(true);
    expect(ball.holdTimer).toBe(HOLD_TIME);
    expect(ball.trail).toEqual([]);
    expect(ball.speed).toBe(0);
  });

  it("spawns an obstacle in the pose the current clock gives it", () => {
    harness.debug.clearWorld();
    harness.debug.setObstacleClockRunning(false);
    harness.debug.setObstacleClock(0.9);
    harness.debug.spawnObstacle(1);

    const { obstacles } = harness.debug.snapshot();
    expect(obstacles).toHaveLength(1);
    expect(obstacles[0]).toEqual(obstaclePose(1, 0.9));
  });

  it("keeps the field in index order however the obstacles were spawned", () => {
    harness.debug.clearWorld();
    harness.debug.spawnObstacle(1);
    harness.debug.spawnObstacle(0);
    expect(harness.debug.snapshot().obstacles.map((o) => o.index)).toEqual([
      0, 1,
    ]);
  });

  it("lets a ball fly through where a removed obstacle used to be", () => {
    rally(harness, "versus", { x: 450, y: 220, vx: 600, vy: 0 });
    harness.debug.clearWorld();
    harness.debug.spawnBall();
    harness.debug.setBallHeld(false);
    harness.debug.setBallHoldTimer(0);
    harness.debug.setBallPosition(450, 220);
    harness.debug.setBallVelocity(600, 0);
    harness.cues.length = 0;

    harness.run(6);

    expect(harness.cues).toEqual([]);
    expect(ballOf(harness).vx).toBe(600);
  });

  it("refuses an obstacle index this field does not have", () => {
    expect(() => harness.debug.spawnObstacle(2)).toThrow(RangeError);
  });

  it("ignores every ball operation while no ball is present", () => {
    harness.debug.clearWorld();
    harness.debug.setBallPosition(1, 2);
    harness.debug.setBallVelocity(3, 4);
    harness.debug.setBallSpin(5);
    harness.debug.setBallHeld(false);
    harness.debug.setBallHoldTimer(0);
    expect(harness.debug.snapshot().ball).toBeNull();
  });
});

// ---- Scoring and the match ----------------------------------------------

describe("scoring", () => {
  it("gives the point to the far side and re-serves toward the receiver", () => {
    rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.cues.length = 0;

    harness.run(4);

    expect(harness.state.score).toEqual({ p1: 1, p2: 0 });
    expect(harness.cues).toEqual([CUES.score]);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.receiver).toBe("right");
    expect(ballOf(harness).held).toBe(true);

    harness.run(frames(HOLD_TIME) + 1);
    expect(ballOf(harness).vx).toBeGreaterThan(0);
  });

  it("gives the point to player two when the ball leaves the left edge", () => {
    rally(harness, "versus", { x: 0, y: FIELD_CY, vx: -600, vy: 0 });
    harness.run(4);
    expect(harness.state.score).toEqual({ p1: 0, p2: 1 });
    expect(harness.state.receiver).toBe("left");
  });

  it("ends the match at WIN_SCORE with a two-point lead", () => {
    rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.debug.setScore(WIN_SCORE - 1, WIN_SCORE - 2);

    harness.run(4);

    expect(harness.state.score.p1).toBe(WIN_SCORE);
    expect(harness.state.winner).toBe("left");
    expect(harness.state.screen).toBe("matchover");
    expect(harness.state.menuIndex).toBe(0);
  });

  it("plays on at deuce until someone leads by two", () => {
    rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.debug.setScore(WIN_SCORE - 1, WIN_SCORE - 1);

    harness.run(4);

    expect(harness.state.score).toEqual({ p1: WIN_SCORE, p2: WIN_SCORE - 1 });
    expect(harness.state.winner).toBeNull();
    expect(harness.state.screen).toBe("countdown");
  });

  it("offers a rematch from the match-over screen", () => {
    rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.debug.setScore(WIN_SCORE - 1, WIN_SCORE - 2);
    harness.run(4);

    harness.tap("Enter");
    harness.run(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.score).toEqual({ p1: 0, p2: 0 });
    expect(harness.state.winner).toBeNull();
  });

  it("returns to the title from the match-over screen on Escape", () => {
    rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.debug.setScore(WIN_SCORE - 1, WIN_SCORE - 2);
    harness.run(4);
    expect(harness.state.screen).toBe("matchover");

    harness.tap("Escape");
    harness.run(1);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(0);
    expect(harness.state.score).toEqual({ p1: 0, p2: 0 });
    expect(harness.state.winner).toBeNull();
    // Every paddle is handed back and the world is put back on the field.
    expect(harness.state.paddles.left.driven).toBe(false);
    expect(harness.state.paddles.right.driven).toBe(false);
    expect(harness.state.obstacles).toHaveLength(OBSTACLE_CENTERS.length);
  });
});

// ---- Pause and mute -----------------------------------------------------

describe("pause", () => {
  it("freezes the field and resumes where it left off", () => {
    rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.run(6);

    harness.tap("KeyP");
    harness.run(1);
    expect(harness.state.screen).toBe("paused");

    const frozen = harness.debug.snapshot();
    harness.run(60);
    expect(ballOf(harness).x).toBe(frozen.ball!.x);

    harness.tap("Escape");
    harness.run(1);
    expect(harness.state.screen).toBe("playing");
  });

  it("opens on one Escape and stays open", () => {
    // Escape raises `pause` and `back` together, and `back` is not read on the
    // live field — so the pause menu opens and is not immediately closed again.
    rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.tap("Escape");
    harness.run(1);
    expect(harness.state.screen).toBe("paused");
    harness.run(10);
    expect(harness.state.screen).toBe("paused");
  });

  it("resumes exactly once on one Escape", () => {
    rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.tap("Escape");
    harness.run(1);
    harness.tap("Escape");
    harness.run(1);
    expect(harness.state.screen).toBe("playing");
  });

  it("resumes on P as well, and does nothing else on that frame", () => {
    rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.tap("KeyP");
    harness.run(1);
    harness.debug.setMenuIndex(2); // QUIT TO MENU, deliberately not taken

    harness.hold("KeyP");
    harness.hold("Enter");
    harness.run(1);
    harness.release("KeyP");
    harness.release("Enter");

    expect(harness.state.screen).toBe("playing");
    expect(harness.state.menuIndex).toBe(2);
  });

  it("remembers whether it paused a countdown or live play", () => {
    openCountdown(harness, "versus");
    harness.tap("KeyP");
    harness.run(1);
    expect(harness.state.screen).toBe("paused");
    expect(harness.state.resumeScreen).toBe("countdown");

    harness.tap("KeyP");
    harness.run(1);
    expect(harness.state.screen).toBe("countdown");
  });

  it("leaves the ball's own held flag exactly as it was", () => {
    openCountdown(harness, "versus");
    harness.run(10);
    const before = ballOf(harness);
    harness.tap("KeyP");
    harness.run(30);
    const after = ballOf(harness);
    expect(after.held).toBe(before.held);
    expect(after.holdTimer).toBeCloseTo(before.holdTimer, 9);
  });

  it("quits to the title from the pause menu, restoring the title's field", () => {
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("Enter");
    harness.run(frames(2));
    expect(harness.state.obstacleClock).toBeGreaterThan(0);
    const simTime = harness.state.simTime;

    harness.tap("KeyP");
    harness.run(1);
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("Enter");
    harness.run(1);

    expect(harness.state.screen).toBe("title");
    expect(harness.state.obstacleClock).toBe(0);
    expect(harness.state.obstacles[0]).toEqual(obstaclePose(0, 0));
    expect(harness.state.simTime).toBeGreaterThan(simTime);
  });

  it("restarts the match from the pause menu in the same mode", () => {
    openCountdown(harness, "versus");
    harness.debug.setScore(3, 4);
    harness.tap("KeyP");
    harness.run(1);
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("Enter");
    harness.run(1);

    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("versus");
    expect(harness.state.score).toEqual({ p1: 0, p2: 0 });
  });
});

describe("mute", () => {
  it("toggles the runtime's mute bit from any screen and mirrors it", () => {
    harness.tap("KeyM");
    harness.run(1);
    expect(harness.state.muted).toBe(true);

    harness.tap("KeyM");
    harness.run(1);
    expect(harness.state.muted).toBe(false);
  });

  it("keeps playing cues, silently, while muted", () => {
    harness.tap("KeyM");
    harness.run(1);
    rally(harness, "versus", { x: FIELD_CX, y: 20, vx: 0, vy: -600 });
    harness.cues.length = 0;

    harness.run(3);

    expect(harness.cues).toEqual([CUES.wallBounce]);
    expect(harness.state.muted).toBe(true);
  });

  it("is left alone by a reset", () => {
    harness.tap("KeyM");
    harness.run(1);
    harness.debug.reset();
    harness.run(1);
    expect(harness.state.muted).toBe(true);
  });
});

// ---- The debug surface --------------------------------------------------

describe("window.__carom", () => {
  it("drives one paddle at its own drivenVy and leaves the other playing", () => {
    openCountdown(harness, "versus");
    harness.debug.setPaddleVy("left", 300);
    harness.debug.setPaddleDriven("left", true);

    harness.hold("KeyW"); // ignored on the left: it is driven
    harness.hold("ArrowDown"); // player two still has the right paddle
    harness.run(frames(0.1));

    expect(harness.state.paddles.left.cy).toBeCloseTo(FIELD_CY + 30, 6);
    expect(harness.state.paddles.right.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.1,
      6,
    );
    expect(harness.state.paddles.right.driven).toBe(false);
  });

  it("keeps drivenVy and vy apart", () => {
    openCountdown(harness, "versus");
    harness.debug.setPaddleVy("left", 240);
    // Nothing has advanced, and the paddle is not driven: `vy` is untouched.
    let shot = harness.debug.snapshot();
    expect(shot.paddles.left.drivenVy).toBe(240);
    expect(shot.paddles.left.vy).toBe(0);

    // The velocity reaches `vy` on the first frame advanced with the side driven.
    harness.debug.setPaddleDriven("left", true);
    harness.run(1);
    shot = harness.debug.snapshot();
    expect(shot.paddles.left.vy).toBe(240);
    expect(shot.paddles.left.drivenVy).toBe(240);
  });

  it("holds drivenVy across frames whether or not the paddle is driven", () => {
    harness.debug.setPaddleVy("right", -180);
    harness.run(30);
    expect(harness.debug.snapshot().paddles.right.drivenVy).toBe(-180);
  });

  it("hands both paddles back on reset", () => {
    openCountdown(harness, "versus");
    harness.debug.setPaddleVy("left", 300);
    harness.debug.setPaddleDriven("left", true);
    harness.debug.setPaddleDriven("right", true);
    harness.debug.reset();

    const shot = harness.debug.snapshot();
    expect(shot.paddles.left.driven).toBe(false);
    expect(shot.paddles.right.driven).toBe(false);
    expect(shot.paddles.left.drivenVy).toBe(0);
    expect(shot.screen).toBe("title");

    harness.tap("Enter");
    harness.run(1);
    harness.hold("KeyW");
    harness.run(frames(0.1));
    expect(harness.state.paddles.left.cy).toBeCloseTo(
      FIELD_CY - PADDLE_SPEED * 0.1,
      6,
    );
  });

  it("runs the real AI against a posed shot on the side it was left", () => {
    rally(harness, "solo", { x: 900, y: 180, vx: 400, vy: 0 }, ["left"]);
    harness.debug.setPaddleCy("right", 600);

    harness.run(30);

    const { paddles } = harness.debug.snapshot();
    expect(paddles.right.cy).toBeLessThan(600);
    expect(paddles.left.cy).toBe(FIELD_CY); // still driven, at rest
  });

  it("gates the AI's two faculties on their own", () => {
    rally(harness, "solo", { x: 900, y: 180, vx: 400, vy: 0 }, ["left"]);
    harness.debug.setPaddleCy("right", 600);
    harness.debug.setAiMovement(false);
    harness.run(30);
    expect(harness.debug.snapshot().paddles.right.cy).toBe(600);
    expect(harness.debug.snapshot().paddles.right.vy).toBe(0);

    // Sensing alone still leaves the paddle where it is; travel alone with no
    // sensing brings it home rather than onto the ball.
    harness.debug.setAiMovement(true);
    harness.debug.setAiTracking(false);
    harness.run(60);
    const cy = harness.debug.snapshot().paddles.right.cy;
    expect(Math.abs(cy - FIELD_CY)).toBeLessThan(30);
  });

  it("reports every field an operation sets", () => {
    harness.debug.setScreen("paused");
    harness.debug.setMode("versus");
    harness.debug.setMenuIndex(2);
    harness.debug.setTitleIndex(1);
    harness.debug.setResumeScreen("countdown");
    harness.debug.setScore(3, 5);
    harness.debug.setWinner("right");
    harness.debug.setReceiver("right");
    harness.debug.setSeed(99);
    harness.debug.setPaddleCy("right", 200);
    harness.debug.setPaddleVy("right", -60);
    harness.debug.setPaddleDriven("right", true);
    harness.debug.setBallPosition(11, 22);
    harness.debug.setBallVelocity(30, 40);
    harness.debug.setBallSpin(-7);
    harness.debug.setBallHeld(false);
    harness.debug.setBallHoldTimer(0.25);
    harness.debug.setAiTracking(false);
    harness.debug.setAiMovement(false);
    harness.debug.setObstacleClockRunning(false);
    harness.debug.setObstacleClock(1.5);

    const shot = harness.debug.snapshot();
    expect(shot.version).toBe(1);
    expect(shot.screen).toBe("paused");
    expect(shot.mode).toBe("versus");
    expect(shot.menuIndex).toBe(2);
    expect(shot.titleIndex).toBe(1);
    expect(shot.resumeScreen).toBe("countdown");
    expect(shot.score).toEqual({ p1: 3, p2: 5 });
    expect(shot.winner).toBe("right");
    expect(shot.receiver).toBe("right");
    expect(shot.seed).toBe(99);
    expect(shot.rngState).toBe(99);
    expect(shot.paddles.right).toEqual({
      cy: 200,
      vy: 0,
      drivenVy: -60,
      driven: true,
    });
    expect(shot.ai).toEqual({ tracking: false, movement: false });
    expect(shot.ball).toMatchObject({
      x: 11,
      y: 22,
      vx: 30,
      vy: 40,
      speed: 50,
      spin: -7,
      held: false,
      holdTimer: 0.25,
    });
    expect(shot.obstacleClock).toBe(1.5);
    expect(shot.obstacleClockRunning).toBe(false);
    expect(shot.autoStep).toBe(true);
    expect(shot.simTime).toBe(0);
  });

  it("clears the winner with null", () => {
    harness.debug.setWinner("left");
    harness.debug.setWinner(null);
    expect(harness.debug.snapshot().winner).toBeNull();
  });

  it("sets the screen without touching the scores, the world, or the menu", () => {
    harness.debug.setScore(4, 2);
    harness.debug.setMenuIndex(2);
    harness.debug.setScreen("playing");
    const shot = harness.debug.snapshot();
    expect(shot.score).toEqual({ p1: 4, p2: 2 });
    expect(shot.menuIndex).toBe(2);
    expect(shot.ball).not.toBeNull();
  });

  it("installs itself on the page and takes itself off again", () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const original = globals["window"];
    globals["window"] = {};
    try {
      const remove = installDebugApi(harness.state, harness.runtime);
      const page = globals["window"] as Record<string, unknown>;
      const api = page[CAROM_HANDLE] as CaromDebugApi;
      expect(api.version).toBe(1);
      expect(api.snapshot().screen).toBe("title");
      remove();
      expect(page[CAROM_HANDLE]).toBeUndefined();
    } finally {
      globals["window"] = original;
    }
  });

  it("reports the very regions the renderer lays its menu items out at", () => {
    for (const screen of ["title", "howto", "paused", "matchover"] as const) {
      harness.debug.setScreen(screen);
      expect(harness.debug.menuItemRect(0)).toEqual(menuItemRect(screen, 0));
    }
  });
});

// ---- The obstacles (this variant) ---------------------------------------

describe("the obstacles", () => {
  it("reports both live poses, upright at their base centers on a new match", () => {
    openCountdown(harness, "versus");
    harness.debug.setObstacleClockRunning(false);
    harness.run(1);
    const { obstacles } = harness.debug.snapshot();
    expect(obstacles).toHaveLength(OBSTACLE_CENTERS.length);
    obstacles.forEach((obstacle, index) => {
      expect(obstacle.index).toBe(index);
      expect(obstacle.cx).toBeCloseTo(OBSTACLE_CENTERS[index].x, 9);
      expect(obstacle.cy).toBeCloseTo(OBSTACLE_CENTERS[index].y, 9);
      expect(obstacle.theta).toBeCloseTo(0, 9);
    });
  });

  it("sways and rotates them as a match plays, in anti-phase", () => {
    harness.tap("Enter");
    harness.run(1);
    harness.run(frames(OBSTACLE_SWAY_PERIOD / 4));

    const [a, b] = harness.debug.snapshot().obstacles;
    expect(a.theta).toBeGreaterThan(0);
    expect(a.theta).toBeCloseTo(b.theta, 9);
    // A above its base center by as much as B is below its own, or the layout
    // would stop being point-symmetric about the field center.
    const upA = a.cy - OBSTACLE_CENTERS[0].y;
    const downB = b.cy - OBSTACLE_CENTERS[1].y;
    expect(Math.abs(upA)).toBeGreaterThan(1);
    expect(upA).toBeCloseTo(-downB, 6);
  });

  it("runs the clock through the pre-serve countdown too", () => {
    openCountdown(harness, "versus");
    harness.run(frames(0.25));
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.obstacleClock).toBeCloseTo(frames(0.25) * TICK, 9);
  });

  it("freezes the clock while the game is paused", () => {
    openCountdown(harness, "versus");
    harness.run(30);
    harness.tap("Escape");
    harness.run(1);
    const held = harness.state.obstacleClock;
    harness.run(180);
    expect(harness.state.obstacleClock).toBe(held);
  });

  it("takes the pose the clock names on the frame the clock is set", () => {
    harness.debug.setObstacleClock(0.9);
    const posed = harness.debug.snapshot().obstacles;
    expect(posed[0]).toEqual(obstaclePose(0, 0.9));
  });

  it("holds the poses while the clock is not running", () => {
    openCountdown(harness, "versus");
    harness.debug.setObstacleClockRunning(false);
    harness.debug.setObstacleClock(0.9);
    harness.run(60);
    const later = harness.debug.snapshot();
    expect(later.obstacleClock).toBe(0.9);
    expect(later.obstacles[0]).toEqual(obstaclePose(0, 0.9));
  });

  it("gives them back to the clock on reset", () => {
    openCountdown(harness, "versus");
    harness.debug.setObstacleClockRunning(false);
    harness.debug.setObstacleClock(0.9);
    harness.debug.reset();
    expect(harness.state.obstacleClockRunning).toBe(true);
    expect(harness.state.obstacleClock).toBe(0);

    harness.tap("Enter");
    harness.run(31);
    expect(harness.debug.snapshot().obstacles[0].theta).toBeGreaterThan(0);
  });

  it("bounces the ball off the pose the clock chose, not off an upright box", () => {
    // A quarter turn in, obstacle A lies across the field: 140 wide and 20 tall,
    // swayed down to y 260. A ball dropped onto it from above meets its long
    // side, where an upright obstacle would not be in the way at all.
    const quarter = Math.PI / 2 / OBSTACLE_SPIN_RATE;
    const pose = obstaclePose(0, quarter);
    expect(pose.theta).toBeCloseTo(Math.PI / 2, 9);

    rally(harness, "versus", { x: pose.cx, y: 120, vx: 0, vy: 400 });
    harness.debug.setObstacleClock(quarter);
    harness.cues.length = 0;

    harness.run(20);

    expect(harness.cues).toEqual([CUES.obstacleBounce]);
    expect(ballOf(harness).vy).toBeLessThan(0);
  });
});

// ---- The clock the surface owns -----------------------------------------

describe("the manual clock", () => {
  it("stops the game advancing itself, and advance moves it on instead", () => {
    harness.debug.setAutoStep(false);
    expect(harness.runtime.autoStep()).toBe(false);
    expect(harness.debug.snapshot().autoStep).toBe(false);

    openCountdown(harness, "versus");
    harness.debug.setBallHoldTimer(0);
    const before = harness.debug.snapshot().simTime;

    harness.debug.advance(1, 60);
    expect(harness.debug.snapshot().simTime).toBeCloseTo(before + 1, 9);

    harness.debug.setAutoStep(true);
    expect(harness.debug.snapshot().autoStep).toBe(true);
  });

  it("is left alone by a reset", () => {
    harness.debug.setAutoStep(false);
    harness.debug.reset();
    expect(harness.debug.snapshot().autoStep).toBe(false);
  });

  it("runs one frame by default", () => {
    harness.debug.setAutoStep(false);
    const before = harness.debug.snapshot().simTime;
    harness.debug.advance(0.25);
    expect(harness.debug.snapshot().simTime).toBeCloseTo(before + 0.25, 9);
    expect(harness.runtime.frame().count).toBe(1);
  });

  it("leaves the paddles with whoever had them: a clock is not a pose", () => {
    harness.tap("Enter"); // a real Solo match, played from the keyboard
    harness.debug.setAutoStep(false);
    harness.debug.advance(TICK);
    expect(harness.state.paddles.left.driven).toBe(false);

    harness.hold("KeyW");
    harness.debug.advance(0.1, 6);
    expect(harness.state.paddles.left.cy).toBeCloseTo(
      FIELD_CY - PADDLE_SPEED * 0.1,
      6,
    );
  });

  it("reaches the same outcome however the second was divided into frames", () => {
    // specs/instrumentation.md: every rate is integrated against the frame's
    // delta, so advance(1, 1) and advance(1, 60) cover the same second of game
    // time and must agree beyond the drift a change in step size explains.
    const pose = { x: 300, y: FIELD_CY, vx: 400, vy: 120, spin: 300 };
    const coarse = createHarness();
    const fine = createHarness();
    try {
      for (const h of [coarse, fine]) {
        h.debug.setAutoStep(false);
        h.debug.setSeed(7);
        rally(h, "versus", pose);
      }
      coarse.debug.advance(0.5, 1);
      fine.debug.advance(0.5, 60);

      const a = ballOf(coarse);
      const b = ballOf(fine);
      // A curving path is integrated, so "the same place" is the same place to
      // within the sub-step resolution rather than bit for bit.
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(4);
      expect(a.spin).toBeCloseTo(b.spin, 6);
      expect(a.speed).toBeCloseTo(b.speed, 6);
    } finally {
      coarse.dispose();
      fine.dispose();
    }
  });
});

// ---- Drawing ------------------------------------------------------------

describe("rendering", () => {
  it("fills each paddle in its own color", () => {
    openCountdown(harness, "versus");
    harness.run(1);

    expect(harness.pixel(P1_X0 + PADDLE_W / 2, FIELD_CY)).toEqual([
      58, 231, 196, 255,
    ]);
    expect(harness.pixel(FIELD_W - P1_X0 - PADDLE_W / 2, FIELD_CY)).toEqual([
      255, 92, 138, 255,
    ]);
  });

  it("draws the ball as one arc at its own position", () => {
    rally(harness, "versus", { x: 400, y: 300, vx: 0, vy: 0 });
    harness.calls.length = 0;
    harness.run(1);

    const arcs = callsTo(harness.calls, "arc");
    expect(arcs).toHaveLength(1);
    expect(arcs[0].slice(0, 3)).toEqual([400, 300, BALL_R]);
    expect(harness.pixel(400, 300)).toEqual([242, 245, 247, 255]);
  });

  it("draws no ball at all once the field is cleared", () => {
    rally(harness, "versus", { x: 400, y: 300, vx: 0, vy: 0 });
    harness.debug.clearWorld();
    harness.calls.length = 0;
    harness.run(1);
    expect(callsTo(harness.calls, "arc")).toHaveLength(0);
  });

  it("draws in logical coordinates whatever size the surface is", () => {
    openCountdown(harness, "versus");
    harness.run(1);
    const view = harness.runtime.viewport();
    expect(view.width).toBe(FIELD_W);
    expect(view.height).toBe(FIELD_H);
    expect(view.scale).toBe(1);
  });

  it("keeps the field inside the letterbox at every screen", () => {
    // The corners of the logical field are drawn; nothing is cut off.
    openCountdown(harness, "versus");
    harness.run(1);
    for (const [x, y] of [
      [1, 1],
      [FIELD_W - 1, FIELD_H - 1],
    ] as const) {
      expect(harness.pixel(x, y)[3]).toBe(255);
    }
  });

  it("changes nothing about the state", () => {
    rally(harness, "versus", { x: 400, y: 300, vx: 0, vy: 0 });
    harness.run(1);
    const before = JSON.stringify(harness.debug.snapshot());
    game.render(harness.state, {
      ctx: harness.ctx as unknown as CanvasRenderingContext2D,
    });
    expect(JSON.stringify(harness.debug.snapshot())).toBe(before);
  });
});
