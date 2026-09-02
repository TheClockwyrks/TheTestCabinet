import * as THREE from "three";
import type { DeepReadonly } from "ts-essentials";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ActionBinding,
  Engine,
  Game,
  InitApi,
  RenderApi,
  SurfaceMetrics,
  TouchLayout,
  UpdateApi,
} from "./index";
import { ConstantClock, TOUCH_LAYOUTS, createEngine } from "./index";
import type { Context2dStub, InstalledContexts } from "./testing/canvas";
import { installCanvasContexts } from "./testing/canvas";

/**
 * The documentation's worked example "Input and Actions", transcribed and run.
 *
 * The page promises its code works against the engine verbatim, so `src/game.ts`
 * below — `BINDINGS`, the constants, `HopperState`, and the `hopper` definition —
 * is copied from the page unchanged, and so are the page's own `TestSurface`,
 * `key`, and `boot` from `tests/steering.test.ts`. The page's `index.html` and
 * `src/main.ts` are the same boot with a wall clock and a real element behind it,
 * and are exercised through that test-side `boot` rather than a second time.
 *
 * Only what the environment forces is adapted, and only in the harness, never in
 * the game:
 *
 * - The page's tests "run in the page under vitest's browser mode"; this package's
 *   suite runs under jsdom, which supplies no GPU and no canvas implementation. So
 *   `installCanvasContexts` from `src/testing/` grafts the WebGL2 stub a real
 *   `THREE.WebGLRenderer` constructs over and renders through onto every canvas the
 *   document makes — which covers both the `document.createElement("canvas")` the
 *   page's own `boot` writes and the screen canvas the engine creates for itself
 *   because `boot` supplies none.
 * - The page reads only `engine.state` and `engine.view()`, which need nothing
 *   more. The two claims here that are about the *picture* — the HUD line and the
 *   body's colour — need the screen layer's operations, so `boot` also notes the
 *   canvases the document minted while the engine was being built and hands back
 *   the recording context the engine's screen canvas was given.
 *
 * The assertions are the outcomes the page narrates: the layout fixing the
 * vocabulary the game then registers, `value` as the held read scaled by `dt` and
 * differenced per axis, the move stick read relative to the camera, `pressed` as
 * the edge read consumed once per press, either bound key driving the same name,
 * `engine.state` as the frame's value against the opening one `initialize`
 * resolved to, and the camera the sixtieth frame's `render` posed being the one
 * `engine.view().camera()` answers with.
 */

/* -------------------------------------------------------------------------- */
/* src/game.ts — transcribed verbatim                                         */
/* -------------------------------------------------------------------------- */

/** Every action `TOUCH_LAYOUTS["dual-stick-two-buttons"]` names, with its keys. */
const BINDINGS: Record<string, ActionBinding> = {
  "move-up": { keys: ["KeyW", "ArrowUp"], kind: "analog" },
  "move-down": { keys: ["KeyS", "ArrowDown"], kind: "analog" },
  "move-left": { keys: ["KeyA", "ArrowLeft"], kind: "analog" },
  "move-right": { keys: ["KeyD", "ArrowRight"], kind: "analog" },
  "look-up": { keys: ["KeyI"], kind: "analog" },
  "look-down": { keys: ["KeyK"], kind: "analog" },
  "look-left": { keys: ["KeyJ"], kind: "analog" },
  "look-right": { keys: ["KeyL"], kind: "analog" },
  a: { keys: ["Space"] },
  b: { keys: ["KeyE"] },
  confirm: { keys: ["Enter"] },
  back: { keys: ["Escape"] },
  pause: { keys: ["KeyP"] },
  mute: { keys: ["KeyM"] },
};

const SIZE = 1;
const LIMIT = 12;
const RUN = 6;
const JUMP = 8;
const GRAVITY = 20;
export const TURN = 2;
export const ORBIT = 8;
const EYE_HEIGHT = 5;

export interface HopperState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vy: number;
  readonly yaw: number;
  readonly grounded: boolean;
  readonly paused: boolean;
  readonly jumps: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2 * LIMIT + SIZE, 2 * LIMIT + SIZE),
  new THREE.MeshStandardMaterial({ color: "#182231" }),
);
ground.rotation.x = -Math.PI / 2;

const body = new THREE.Mesh(
  new THREE.BoxGeometry(SIZE, SIZE, SIZE),
  new THREE.MeshStandardMaterial({ color: "#7fd1ff" }),
);
body.name = "hopper";

export const hopper: Game<HopperState, null> = {
  initialize(api: InitApi<HopperState>): [HopperState, null] {
    for (const [action, binding] of Object.entries(BINDINGS)) {
      api.input.register(action, binding);
    }

    api.scene.add(new THREE.HemisphereLight("#ffffff", "#223344", 1));
    api.scene.add(ground);
    api.scene.add(body);

    return [
      {
        x: 0,
        y: 0,
        z: 0,
        vy: 0,
        yaw: 0,
        grounded: true,
        paused: false,
        jumps: 0,
      },
      null,
    ];
  },

  update(state: DeepReadonly<HopperState>, api: UpdateApi, dt: number): HopperState {
    const paused = api.input.pressed("pause") ? !state.paused : state.paused;
    if (paused) return { ...state, paused };

    const turn = api.input.value("look-right") - api.input.value("look-left");
    const yaw = state.yaw + turn * TURN * dt;

    const forward = api.input.value("move-up") - api.input.value("move-down");
    const strafe = api.input.value("move-right") - api.input.value("move-left");
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const x = clamp(state.x + (cos * strafe - sin * forward) * RUN * dt, -LIMIT, LIMIT);
    const z = clamp(state.z - (sin * strafe + cos * forward) * RUN * dt, -LIMIT, LIMIT);

    const jumping = api.input.pressed("a") && state.grounded;
    const launched = jumping
      ? { vy: JUMP, grounded: false, jumps: state.jumps + 1 }
      : { vy: state.vy, grounded: state.grounded, jumps: state.jumps };

    const vy = launched.vy - GRAVITY * dt;
    const y = state.y + vy * dt;

    if (y <= 0) {
      return { ...launched, x, y: 0, z, vy: 0, yaw, grounded: true, paused };
    }
    return { ...launched, x, y, z, vy, yaw, paused };
  },

  render(state: DeepReadonly<HopperState>, api: RenderApi): void {
    body.position.set(state.x, state.y + SIZE / 2, state.z);
    body.material.color.set(state.grounded ? "#7fd1ff" : "#ffd479");

    api.camera.position.set(
      state.x + ORBIT * Math.sin(state.yaw),
      EYE_HEIGHT,
      state.z + ORBIT * Math.cos(state.yaw),
    );
    api.camera.lookAt(state.x, SIZE / 2, state.z);

    const { screen } = api;
    screen.fillStyle = "#e6edf6";
    screen.font = "16px monospace";
    screen.fillText(state.paused ? "paused" : `jumps ${state.jumps}`, 16, 28);
  },
};

/* -------------------------------------------------------------------------- */
/* tests/steering.test.ts — transcribed, with the forced adaptations          */
/* -------------------------------------------------------------------------- */

const WIDTH = 640;
const HEIGHT = 360;

class TestSurface implements SurfaceMetrics {
  readonly target = new EventTarget();

  cssWidth(): number {
    return WIDTH;
  }

  cssHeight(): number {
    return HEIGHT;
  }

  dpr(): number {
    return 1;
  }

  events(): EventTarget {
    return this.target;
  }
}

function key(
  target: EventTarget,
  type: "keydown" | "keyup",
  code: string,
): void {
  target.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }));
}

/**
 * The page's `boot`, plus the two handles jsdom forces.
 *
 * `game` is a parameter so one test can wrap `hopper` and read what the engine
 * handed its `initialize`; every other test passes the page's own definition. `hud`
 * is the recording 2D context the engine's own screen canvas was given: the page's
 * `boot` supplies no `screen`, so the engine creates that canvas from the stage
 * canvas's document, and the only way to reach it is to note what the document
 * minted while `createEngine` ran.
 */
function boot(game: Game<HopperState, null> = hopper): {
  engine: Engine<HopperState>;
  surface: TestSurface;
  hud: Context2dStub;
} {
  const minted: HTMLCanvasElement[] = [];
  const createElement = document.createElement.bind(document);
  document.createElement = ((tag: string): HTMLElement => {
    const element = createElement(tag);
    if (element instanceof HTMLCanvasElement) minted.push(element);
    return element;
  }) as typeof document.createElement;

  try {
    const surface = new TestSurface();
    const stage = document.createElement("canvas");
    const engine = createEngine({
      canvas: stage,
      width: WIDTH,
      height: HEIGHT,
      layout: "dual-stick-two-buttons",
      game,
      clock: new ConstantClock(1000 / 60),
      surface,
    });
    engines.push(engine as Engine<HopperState>);

    // The screen canvas is the first canvas after the stage one to have been given
    // a 2D context; the renderer never asks its own canvas for one.
    const screen = minted.find(
      (canvas) =>
        canvas !== stage && contexts.context2dFor(canvas) !== undefined,
    );
    const hud = screen === undefined ? undefined : contexts.context2dFor(screen);
    if (hud === undefined) throw new Error("the engine minted no screen canvas");

    return { engine, surface, hud };
  } finally {
    document.createElement = createElement as typeof document.createElement;
  }
}

/** Everything a test built, destroyed however the test ended. */
const engines: Engine<HopperState>[] = [];
let contexts: InstalledContexts;

beforeEach(() => {
  contexts = installCanvasContexts();
});

afterEach(() => {
  for (const engine of engines.splice(0)) engine.destroy();
  contexts.uninstall();
});

/** What one frame of this clock is worth, in seconds — the page's own `dt`. */
const DT = 1 / 60;

describe("examples/input-and-actions", () => {
  /* ------------------------------------------------------------------------ */
  /* The vocabulary the layout fixes                                          */
  /* ------------------------------------------------------------------------ */

  it("registers exactly the vocabulary the selected layout names", async () => {
    // "`layout` selects the touch layout before anything is registered, so every
    // action in that layout's vocabulary is tagged with it as the game registers
    // it" — and the page's own comment on `BINDINGS`: "Every action
    // `TOUCH_LAYOUTS["dual-stick-two-buttons"]` names, with its keys."
    const vocabulary = TOUCH_LAYOUTS["dual-stick-two-buttons"];
    expect(vocabulary?.actions).toEqual(Object.keys(BINDINGS));

    // The layout is live before a line of the game's `initialize` runs, which is
    // what lets each registration be attributed against it.
    let seen: TouchLayout | null = null;
    const { engine } = boot({
      ...hopper,
      async initialize(api: InitApi<HopperState>): Promise<[HopperState, null]> {
        seen = api.input.layout();
        return await hopper.initialize(api);
      },
    });
    await engine.initialize();

    expect(seen).toEqual(vocabulary);
    engine.destroy();
  });

  it("places the light, the ground, and the named body in the scene", async () => {
    const { engine } = boot();
    await engine.initialize();

    // The three objects `initialize` adds are still there when the first render
    // runs, so a check finds the hopper by name with no pixels involved.
    expect(engine.scene.children).toHaveLength(3);
    expect(engine.scene.children[0]).toBeInstanceOf(THREE.HemisphereLight);
    expect(engine.scene.getObjectByName("hopper")).toBe(body);
    engine.destroy();
  });

  /* ------------------------------------------------------------------------ */
  /* The page's own three tests                                               */
  /* ------------------------------------------------------------------------ */

  it("a held steer moves the hopper right", async () => {
    const { engine, surface } = boot();
    const opening = await engine.initialize();

    key(surface.target, "keydown", "KeyD");
    await engine.advance(60);
    key(surface.target, "keyup", "KeyD");

    expect(engine.state.x).toBeGreaterThan(opening.x);

    // "the distance the first test measures is the distance one simulated second
    // of holding the key is worth" — `RUN` metres, at `value` reading exactly 1.
    expect(engine.state.x).toBeCloseTo(RUN, 6);
    // "`ConstantClock` makes each of the 60 frames worth exactly `1000 / 60`
    // milliseconds."
    expect(engine.frame().count).toBe(60);
    expect(engine.frame().timeMs).toBeCloseTo(1000, 6);
    expect(engine.frame().lastDeltaMs).toBeCloseTo(1000 / 60, 12);
    // "The value `initialize` resolved to is the opening state and stays that
    // value however many frames run."
    expect(opening.x).toBe(0);
    expect(opening.jumps).toBe(0);
    engine.destroy();
  });

  it("a held jump button costs one jump", async () => {
    const { engine, surface } = boot();
    await engine.initialize();

    key(surface.target, "keydown", "Space");
    await engine.advance(120);

    expect(engine.state.jumps).toBe(1);

    // Two seconds is long enough for a `JUMP` launch under `GRAVITY` to land, so
    // the one jump is over and the key is still down with no second edge behind it.
    expect(engine.state.grounded).toBe(true);
    expect(engine.state.y).toBe(0);
    engine.destroy();
  });

  it("a held look turns the camera around the hopper", async () => {
    const { engine, surface } = boot();
    await engine.initialize();

    key(surface.target, "keydown", "KeyL");
    await engine.advance(60);
    key(surface.target, "keyup", "KeyL");

    const { x, yaw } = engine.state;
    const camera = engine.view().camera();
    expect(yaw).toBeCloseTo(TURN, 3);
    expect(camera.position.x).toBeCloseTo(x + ORBIT * Math.sin(yaw), 3);

    // "the one the sixtieth frame's `render` posed from the state that frame left"
    // — the whole pose, not the one component the page checks.
    expect(camera.position.z).toBeCloseTo(engine.state.z + ORBIT * Math.cos(yaw), 6);
    expect(camera.position.y).toBeCloseTo(EYE_HEIGHT, 6);
    // Looking left and right at once is no turn at all, so the look axis is a
    // difference like the move axes are.
    expect(engine.state.z).toBeCloseTo(0, 12);
    engine.destroy();
  });

  /* ------------------------------------------------------------------------ */
  /* Held and edge reads                                                      */
  /* ------------------------------------------------------------------------ */

  it("scales the held read by dt, so the distance is proportional to the time", async () => {
    // "multiplying by `dt` keeps the distance traveled proportional to the time
    // the frame was worth": half the frames, half the distance.
    const { engine, surface } = boot();
    await engine.initialize();

    key(surface.target, "keydown", "KeyD");
    await engine.advance(30);
    expect(engine.state.x).toBeCloseTo(RUN / 2, 6);
    await engine.advance(30);
    expect(engine.state.x).toBeCloseTo(RUN, 6);
    key(surface.target, "keyup", "KeyD");

    // Released, the held read falls back to 0 and the hopper stops where it was.
    const stopped = engine.state.x;
    await engine.advance(30);
    expect(engine.state.x).toBe(stopped);
    engine.destroy();
  });

  it("holding both directions of an axis reports 0", async () => {
    // "Taking each axis as the difference of its two directions makes holding both
    // report `0`."
    const { engine, surface } = boot();
    await engine.initialize();

    key(surface.target, "keydown", "KeyD");
    key(surface.target, "keydown", "KeyA");
    await engine.advance(60);

    expect(engine.state.x).toBe(0);

    // Lifting one of the two leaves the other still held, and the hopper moves the
    // way the survivor names.
    key(surface.target, "keyup", "KeyD");
    await engine.advance(30);
    expect(engine.state.x).toBeCloseTo(-RUN / 2, 6);
    key(surface.target, "keyup", "KeyA");
    engine.destroy();
  });

  it("either bound key drives the same name, and the action holds until the last is up", async () => {
    // "`KeyD` and `ArrowRight` take `move-right` to `1` for as long as either is
    // down."
    const { engine, surface } = boot();
    await engine.initialize();

    key(surface.target, "keydown", "ArrowRight");
    await engine.advance(30);
    expect(engine.state.x).toBeCloseTo(RUN / 2, 6);

    // Both down is still one press worth of deflection, not two.
    key(surface.target, "keydown", "KeyD");
    await engine.advance(30);
    expect(engine.state.x).toBeCloseTo(RUN, 6);

    // Releasing one of them is not a release.
    key(surface.target, "keyup", "ArrowRight");
    await engine.advance(30);
    expect(engine.state.x).toBeCloseTo(RUN * 1.5, 6);

    key(surface.target, "keyup", "KeyD");
    const stopped = engine.state.x;
    await engine.advance(30);
    expect(engine.state.x).toBe(stopped);
    engine.destroy();
  });

  it("reads the move stick relative to the camera", async () => {
    // "rotating the stick's two axes by [yaw] makes pushing forward carry the
    // hopper away from the camera whatever way the camera faces. `render` places
    // the camera on the same circle from the same `yaw`, so the picture and the
    // steering agree."
    const { engine, surface } = boot();
    await engine.initialize();

    // A radian of turn, so neither axis is the trivial one.
    key(surface.target, "keydown", "KeyL");
    await engine.advance(30);
    key(surface.target, "keyup", "KeyL");
    const before = engine.state;
    expect(before.yaw).toBeCloseTo(1, 6);

    key(surface.target, "keydown", "KeyW");
    await engine.advance(1);
    key(surface.target, "keyup", "KeyW");
    const after = engine.state;

    // The look key is up, so this frame's `yaw` is the one the camera was already
    // placed from.
    expect(after.yaw).toBe(before.yaw);

    const step = { x: after.x - before.x, z: after.z - before.z };
    const camera = engine.view().camera();
    const away = {
      x: camera.position.x - after.x,
      z: camera.position.z - after.z,
    };

    // Forward is one frame of `RUN`, straight down the line from the camera
    // through the hopper: colinear with the camera's offset and pointing away.
    expect(Math.hypot(step.x, step.z)).toBeCloseTo(RUN * DT, 9);
    expect(step.x * away.z - step.z * away.x).toBeCloseTo(0, 9);
    expect(step.x * away.x + step.z * away.z).toBeLessThan(0);
    // The camera stayed on its circle, ORBIT out from the hopper it follows.
    expect(Math.hypot(away.x, away.z)).toBeCloseTo(ORBIT, 6);
    engine.destroy();
  });

  it("reports the edge exactly once per press, however long the key is held", async () => {
    // "`pressed` is the edge read, true exactly once per press however long the
    // key is held, and the call consumes the edge."
    const { engine, surface } = boot();
    await engine.initialize();

    key(surface.target, "keydown", "Space");
    // "`Space` arms the edge `a` reports on the next frame" — not on this one,
    // because no frame has run yet.
    expect(engine.state.jumps).toBe(0);

    await engine.advance(1);
    expect(engine.state.jumps).toBe(1);
    expect(engine.state.grounded).toBe(false);
    expect(engine.state.vy).toBeCloseTo(JUMP - GRAVITY * DT, 9);
    expect(engine.state.y).toBeCloseTo((JUMP - GRAVITY * DT) * DT, 9);

    // Held down across the whole flight, the key arms nothing further.
    await engine.advance(120);
    expect(engine.state.jumps).toBe(1);
    expect(engine.state.grounded).toBe(true);

    // A release and a second press is a second edge, and a second jump.
    key(surface.target, "keyup", "Space");
    key(surface.target, "keydown", "Space");
    await engine.advance(1);
    expect(engine.state.jumps).toBe(2);
    key(surface.target, "keyup", "Space");
    engine.destroy();
  });

  it("spends the edge even when the jump is refused, so one press is one jump", async () => {
    // "Reading `a` once per frame is therefore what makes one press cost one
    // jump": `pressed` is called before `state.grounded` is consulted, so a press
    // in mid-air is consumed and buys nothing.
    const { engine, surface } = boot();
    await engine.initialize();

    key(surface.target, "keydown", "Space");
    await engine.advance(1);
    key(surface.target, "keyup", "Space");
    expect(engine.state.jumps).toBe(1);
    expect(engine.state.grounded).toBe(false);

    key(surface.target, "keydown", "Space");
    await engine.advance(1);
    key(surface.target, "keyup", "Space");
    expect(engine.state.jumps).toBe(1);
    expect(engine.state.grounded).toBe(false);

    // And the airborne press did not survive to be spent on landing either.
    await engine.advance(120);
    expect(engine.state.jumps).toBe(1);
    expect(engine.state.grounded).toBe(true);
    engine.destroy();
  });

  it("pauses on its own button and freezes the simulation until it is pressed again", async () => {
    // The build "jumps on a button edge, and pauses on another"; `update` returns
    // the moment `paused` is true, so nothing else that frame is read.
    const { engine, surface } = boot();
    await engine.initialize();

    key(surface.target, "keydown", "KeyD");
    await engine.advance(30);
    const moved = engine.state.x;

    key(surface.target, "keydown", "KeyP");
    key(surface.target, "keyup", "KeyP");
    await engine.advance(60);
    expect(engine.state.paused).toBe(true);
    // The steer is still held and buys nothing.
    expect(engine.state.x).toBe(moved);
    // Nor does the jump button, whose edge the paused frame never reaches.
    key(surface.target, "keydown", "Space");
    await engine.advance(1);
    expect(engine.state.jumps).toBe(0);
    key(surface.target, "keyup", "Space");

    key(surface.target, "keydown", "KeyP");
    key(surface.target, "keyup", "KeyP");
    await engine.advance(30);
    expect(engine.state.paused).toBe(false);
    expect(engine.state.x).toBeCloseTo(moved + RUN / 2, 6);
    key(surface.target, "keyup", "KeyD");
    engine.destroy();
  });

  /* ------------------------------------------------------------------------ */
  /* The picture the state buys                                              */
  /* ------------------------------------------------------------------------ */

  it("draws the jump count on the screen layer, and `paused` while paused", async () => {
    const { engine, surface, hud } = boot();
    await engine.initialize();

    hud.forget();
    await engine.advance(1);
    expect(hud.opsOf("fillText").map((op) => op.text)).toEqual(["jumps 0"]);
    expect(hud.opsOf("fillText")[0]?.fill).toBe("#e6edf6");

    key(surface.target, "keydown", "Space");
    await engine.advance(1);
    key(surface.target, "keyup", "Space");
    hud.forget();
    await engine.advance(1);
    expect(hud.opsOf("fillText").map((op) => op.text)).toEqual(["jumps 1"]);

    key(surface.target, "keydown", "KeyP");
    key(surface.target, "keyup", "KeyP");
    hud.forget();
    await engine.advance(1);
    expect(hud.opsOf("fillText").map((op) => op.text)).toEqual(["paused"]);
    engine.destroy();
  });

  it("poses the body from the state and colours it by whether it is grounded", async () => {
    const { engine, surface } = boot();
    await engine.initialize();

    await engine.advance(1);
    expect(body.position.y).toBeCloseTo(SIZE / 2, 9);
    expect(body.material.color.getHexString()).toBe("7fd1ff");

    key(surface.target, "keydown", "Space");
    await engine.advance(1);
    key(surface.target, "keyup", "Space");
    expect(engine.state.grounded).toBe(false);
    expect(body.position.y).toBeCloseTo(engine.state.y + SIZE / 2, 9);
    expect(body.material.color.getHexString()).toBe("ffd479");

    // Landed again, and back to the grounded colour.
    await engine.advance(120);
    expect(body.material.color.getHexString()).toBe("7fd1ff");
    expect(body.position.x).toBeCloseTo(engine.state.x, 9);
    expect(body.position.z).toBeCloseTo(engine.state.z, 9);
    engine.destroy();
  });

  /* ------------------------------------------------------------------------ */
  /* The seam the test drives through                                         */
  /* ------------------------------------------------------------------------ */

  it("takes its keys through the surface the test supplied, and stops at destroy", async () => {
    // "A test supplies a `surface`, which is where the engine reads its element
    // size and attaches its key listeners."
    const { engine, surface } = boot();
    await engine.initialize();

    expect(engine.viewport()).toEqual({
      width: WIDTH,
      height: HEIGHT,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });

    // A key on any other target reaches nothing.
    const elsewhere = new EventTarget();
    key(elsewhere, "keydown", "KeyD");
    await engine.advance(30);
    expect(engine.state.x).toBe(0);

    engine.destroy();
    key(surface.target, "keydown", "KeyD");
    await engine.advance(30);
    expect(engine.state.x).toBe(0);
  });
});
