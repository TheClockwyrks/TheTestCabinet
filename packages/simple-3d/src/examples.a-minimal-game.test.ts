import * as THREE from "three";
import type { DeepReadonly } from "ts-essentials";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConstantClock, JitterClock, SequenceClock, createEngine } from "./index";
import type {
  Clock,
  Engine,
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "./index";
import type { Context2dStub, InstalledContexts } from "./testing/canvas";
import { installCanvasContexts } from "./testing/canvas";
import type { GlStub } from "./testing/gl";

/**
 * The documentation's worked example "A Minimal Game", transcribed and run.
 *
 * The page promises the three files it prints are a whole build, so `src/game.ts`
 * below is copied from it character for character — the same constants, the same
 * module-level cube, the same three functions, the same `ts-essentials` import the
 * page's prose calls "the one import beside the engine and `three`" — and the boot
 * module is followed line for line. The engine is imported from `./index` rather
 * than from `"@clockwyrks/simple-3d"`, which is the same module reached from
 * inside the package.
 *
 * Only what a headless environment forces is adapted, and each adaptation is
 * confined to the boot below rather than to the game:
 *
 * - The page's `index.html` becomes jsdom markup, and jsdom supplies no canvas
 *   implementation, so `installCanvasContexts` from the package's own test harness
 *   makes every canvas in the document answer `getContext` — the one the page's
 *   `querySelector` finds, and the screen canvas the engine creates for itself
 *   because the boot passes no `screen`.
 * - jsdom performs no layout, so the element reports a client size of zero and the
 *   fit would collapse to a scale of zero. The boot pins the size the page's
 *   `100vw`/`100vh` canvas would have been laid out at, and a device pixel ratio of
 *   two, and hands the engine no `surface` at all — so the engine measures through
 *   its own default DOM surface, exactly as the page's `createEngine` call does.
 * - The page's `await engine.run()` drives frames off the host's frame callback on
 *   a `WallClock`; a suite steps synchronously instead, with `engine.advance` over
 *   a clock that supplies its own deltas, as the validator docs prescribe. One test
 *   omits the clock as the page does and drives the wall clock by its timestamps
 *   instead, to check the page's claim about what omitting it installs.
 *
 * The assertions are the outcomes the page narrates: what construction runs and
 * what it does not, the camera defaults a build gets for free and the field they
 * frame, what `initialize` puts in the retained scene and what it declines to
 * reach for, the reflection off both ends of the run, the step-size independence
 * the overshoot arithmetic buys, and the readout drawn in logical units on a
 * cleared screen layer that is composited over a picture drawn after `render`
 * returned.
 */

/* -------------------------------------------------------------------------- */
/* src/game.ts — transcribed verbatim                                         */
/* -------------------------------------------------------------------------- */

const LIMIT = 8;
const SPEED = 4;

interface State {
  readonly x: number;
  readonly vx: number;
}

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: "#7fd1ff" }),
);
cube.name = "drifter";

export const drifter: Game<State, null> = {
  initialize(api: InitApi<State>): [State, null] {
    api.scene.add(new THREE.HemisphereLight("#ffffff", "#223344", 1));
    api.scene.add(cube);
    return [{ x: -LIMIT, vx: SPEED }, null];
  },

  update(state: DeepReadonly<State>, _api: UpdateApi, dt: number): State {
    const x = state.x + state.vx * dt;

    if (x < -LIMIT) return { x: -2 * LIMIT - x, vx: SPEED };
    if (x > LIMIT) return { x: 2 * LIMIT - x, vx: -SPEED };
    return { ...state, x };
  },

  render(state: DeepReadonly<State>, api: RenderApi): void {
    cube.position.x = state.x;

    const { screen } = api;
    screen.fillStyle = "#e6edf6";
    screen.font = "16px monospace";
    screen.fillText(`x ${state.x.toFixed(2)}`, 16, 28);
  },
};

/* -------------------------------------------------------------------------- */
/* index.html + src/main.ts — transcribed, with the forced adaptations         */
/* -------------------------------------------------------------------------- */

/** The page's markup, as jsdom will hold it. */
const PAGE =
  '<canvas id="game" style="display: block; width: 100vw; height: 100vh"></canvas>';

/**
 * The size the page's `100vw` × `100vh` canvas is laid out at, and the ratio of the
 * display it is laid out on.
 *
 * Deliberately not a whole multiple of the design field on both axes: 640×360 fits
 * 1280×800 on the width, which is what makes the letterbox bars — and therefore the
 * viewport transform the readout is drawn under — something other than the identity.
 * A ratio of two rather than one for the same reason: an engine that confused CSS
 * pixels with device pixels would still pass every assertion at one.
 */
const CSS_WIDTH = 1280;
const CSS_HEIGHT = 800;
const DPR = 2;

/**
 * The fit those numbers produce, written out rather than computed.
 *
 * 1280×800 CSS at a ratio of 2 is a 2560×1600 backing store; a 640×360 field fits it
 * on the width at 4 device pixels per logical unit, with the spare 160 device pixels
 * of height split into two 80-pixel bars.
 */
const SCALE = 4;
const OFFSET_X = 0;
const OFFSET_Y = 80;
const VIEWPORT_TRANSFORM = [SCALE, 0, 0, SCALE, OFFSET_X, OFFSET_Y];
const IDENTITY = [1, 0, 0, 1, 0, 0];

/** Everything the boot leaves behind, and the seams a test reads it back through. */
interface Booted {
  /** The engine the page's `main.ts` built. */
  engine: Engine<State, null>;
  /** The canvas the page's markup declared and its `querySelector` found. */
  canvas: HTMLCanvasElement;
  /** The GL calls the renderer issued through that canvas. */
  gl: GlStub;
  /** The operations the screen layer recorded, with the transform in force for each. */
  screen: Context2dStub;
  /** Reports a different laid-out size, as a resized window would. */
  resize(cssWidth: number, cssHeight: number): void;
}

let contexts: InstalledContexts;
let createdCanvases: HTMLCanvasElement[];
let restoreCreateElement: () => void;
const booted: Engine<State, null>[] = [];

/**
 * Watches the canvases the document is asked to create, so the screen canvas the
 * engine makes for itself can be read back.
 *
 * The page passes no `screen`, and the engine's own screen canvas is therefore
 * created from the stage canvas's owning document and never handed out. Recording
 * the creations is the only seam onto it that does not change what the page's boot
 * says, and `createRenderStage` makes exactly one canvas — the recorder's own comes
 * later and only if a recording is started, which this game never does.
 */
function watchCreatedCanvases(): void {
  createdCanvases = [];
  const original = Document.prototype.createElement;
  Document.prototype.createElement = function created(
    this: Document,
    ...args: [string]
  ): HTMLElement {
    const element = original.apply(this, args);
    if (element instanceof HTMLCanvasElement) createdCanvases.push(element);
    return element;
  } as typeof Document.prototype.createElement;
  restoreCreateElement = (): void => {
    Document.prototype.createElement = original;
  };
}

/**
 * Reports a laid-out size and a device pixel ratio jsdom would otherwise give as
 * zero and one.
 *
 * This is the whole of what stands in for layout. The engine still measures through
 * its own `domSurface` — the boot passes no `surface` — so what is being checked is
 * the default path a page's build actually takes.
 */
function layOut(canvas: HTMLCanvasElement): (w: number, h: number) => void {
  let cssWidth = CSS_WIDTH;
  let cssHeight = CSS_HEIGHT;
  Object.defineProperty(canvas, "clientWidth", {
    get: () => cssWidth,
    configurable: true,
  });
  Object.defineProperty(canvas, "clientHeight", {
    get: () => cssHeight,
    configurable: true,
  });
  Object.defineProperty(window, "devicePixelRatio", {
    value: DPR,
    configurable: true,
  });
  return (w: number, h: number): void => {
    cssWidth = w;
    cssHeight = h;
  };
}

/**
 * The page's `index.html` and `src/main.ts`, adapted only as the header describes.
 *
 * The clock is the one departure from the printed boot, and it is the departure the
 * validator docs ask for; a caller that wants the page's own call as printed passes
 * `null`, and the option is left off entirely.
 */
function boot(clock: Clock | null = new ConstantClock(1000 / 60)): Booted {
  document.body.innerHTML = PAGE;

  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (canvas === null) throw new Error("missing canvas #game");
  const resize = layOut(canvas);

  const before = createdCanvases.length;
  const engine = createEngine({
    canvas,
    width: 640,
    height: 360,
    background: "#05060a",
    game: drifter,
    ...(clock === null ? {} : { clock }),
  });
  booted.push(engine);

  const screenCanvas = createdCanvases[before];
  if (screenCanvas === undefined) {
    throw new Error("the engine created no screen canvas");
  }
  const gl = contexts.glFor(canvas);
  const screen = contexts.context2dFor(screenCanvas);
  if (gl === undefined || screen === undefined) {
    throw new Error("a canvas was never asked for the context it draws through");
  }
  return { engine, canvas, gl, screen, resize };
}

beforeEach(() => {
  contexts = installCanvasContexts();
  watchCreatedCanvases();
});

afterEach(() => {
  for (const engine of booted.splice(0)) engine.destroy();
  restoreCreateElement();
  contexts.uninstall();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* The narrated outcomes                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Where the cube is `t` seconds in, from the page's own arithmetic: uniform motion
 * at `SPEED` from `x = -LIMIT`, folded back into `[-LIMIT, LIMIT]` at each end.
 *
 * Reflecting the overshoot rather than clamping it is what makes the per-frame
 * stepping agree with this continuous fold whatever the step size, which is the
 * property the page claims for it.
 */
function expectedX(t: number): number {
  const span = 2 * LIMIT;
  const travelled = (SPEED * t) % (2 * span);
  return -LIMIT + (travelled < span ? travelled : 2 * span - travelled);
}

/** Steps in whole frames until at least `ms` of simulated time has passed. */
async function advanceMs(engine: Engine<State, null>, ms: number): Promise<void> {
  const until = engine.frame().timeMs + ms;
  while (engine.frame().timeMs < until) await engine.advance(1);
}

describe("examples/a-minimal-game", () => {
  describe("src/main.ts", () => {
    it("runs no game code, so the scene is empty and there is no state yet", () => {
      // "`createEngine` runs no game code, `initialize` runs the game's
      // `initialize` and builds the state."
      const { engine } = boot();

      expect(engine.scene.children).toEqual([]);
      expect(() => engine.state).toThrow();
      expect(() => engine.debug).toThrow();
      expect(engine.frame()).toEqual({ count: 0, timeMs: 0, lastDeltaMs: 0 });
    });

    it("resolves initialize to the state the game built, and to no debug surface", async () => {
      const { engine } = boot();

      const state = await engine.initialize();

      expect(state).toEqual({ x: -LIMIT, vx: SPEED });
      expect(engine.state).toEqual({ x: -LIMIT, vx: SPEED });
      // "The state carries the cube's position and velocity alone." The cube is a
      // three object mutated in place, and the state never names it.
      expect(Object.keys(engine.state as object).sort()).toEqual(["vx", "x"]);
      // `Game<State, null>` returning `[state, null]` is a game with no debug
      // surface, and the engine hands back what the game returned.
      expect(engine.debug).toBeNull();
    });

    it("leaves the element free to follow the window and refits without a handler", async () => {
      // "The canvas carries its size inline, so the engine leaves the element free
      // to follow the window and fits the logical field into whatever size it
      // reports."
      const { engine, canvas, resize } = boot();
      await engine.initialize();
      await engine.advance(1);

      expect(canvas.style.width).toBe("100vw");
      expect(canvas.style.height).toBe("100vh");
      expect(canvas.width).toBe(CSS_WIDTH * DPR);
      expect(canvas.height).toBe(CSS_HEIGHT * DPR);
      expect(engine.viewport()).toEqual({
        width: 640,
        height: 360,
        scale: SCALE,
        offsetX: OFFSET_X,
        offsetY: OFFSET_Y,
      });

      // A narrower window, and no resize handler anywhere in the build.
      resize(640, 800);
      await engine.advance(1);

      expect(canvas.style.width).toBe("100vw");
      expect(engine.viewport()).toEqual({
        width: 640,
        height: 360,
        scale: 2,
        offsetX: 0,
        offsetY: 440,
      });
    });

    it("omitting the clock installs a WallClock, so each frame is worth the time that elapsed", async () => {
      // "Omitting the clock installs a `WallClock`, so each frame is worth the time
      // that actually elapsed." The loop stamps each tick from `performance.now`,
      // so scripting that is scripting the elapsed time.
      let nowMs = 1000;
      vi.spyOn(performance, "now").mockImplementation(() => nowMs);

      const { engine } = boot(null);
      await engine.initialize();

      // The first tick has nothing to subtract from, so it is worth nothing.
      await engine.advance(1);
      expect(engine.frame().lastDeltaMs).toBe(0);
      expect(engine.state.x).toBe(-LIMIT);

      nowMs = 1016;
      await engine.advance(1);
      expect(engine.frame().lastDeltaMs).toBe(16);
      expect(engine.state.x).toBeCloseTo(-LIMIT + SPEED * 0.016, 12);

      nowMs = 1050;
      await engine.advance(1);
      expect(engine.frame().lastDeltaMs).toBe(34);
      expect(engine.frame().timeMs).toBe(50);
      expect(engine.state.x).toBeCloseTo(expectedX(0.05), 12);

      // A wall clock and not a pass-through: a stall longer than its ceiling is
      // clamped rather than delivered whole.
      nowMs = 1500;
      await engine.advance(1);
      expect(engine.frame().lastDeltaMs).toBe(100);
    });

    it("omitting projection gives a perspective camera at the camera defaults", async () => {
      // "Omitting `projection` gives the build a perspective camera at the camera
      // defaults ... at `(0, 0, 10)` looking along `-Z` with a vertical field of
      // view of 60 degrees."
      const { engine } = boot();
      await engine.initialize();

      expect(engine.camera).toBeInstanceOf(THREE.PerspectiveCamera);
      expect(engine.camera.position.toArray()).toEqual([0, 0, 10]);
      expect(engine.camera.quaternion.toArray()).toEqual([0, 0, 0, 1]);
      expect(engine.camera.zoom).toBe(1);
      expect(engine.camera.near).toBeCloseTo(0.1, 12);
      expect(engine.camera.far).toBe(1000);

      const snapshot = engine.view().camera();
      expect(snapshot.projection).toBe("perspective");
      expect(snapshot.fov).toBe(60);
      expect(snapshot.position).toEqual({ x: 0, y: 0, z: 10 });
    });
  });

  describe("the field those defaults frame", () => {
    it("shows about 11.5 world units top to bottom and 20.5 across at z = 0", async () => {
      // "the `z = 0` plane the cube moves on shows about 11.5 world units top to
      // bottom and 20.5 across at the design aspect". A camera ten units away with
      // a 60-degree vertical field sees 2 * 10 * tan(30) units of height there,
      // and that height times the design aspect of width.
      const { engine } = boot();
      await engine.initialize();
      const view = engine.view();

      const halfHeight = 10 * Math.tan((Math.PI / 180) * 30);
      const halfWidth = halfHeight * (640 / 360);
      expect(2 * halfHeight).toBeCloseTo(11.5, 1);
      expect(2 * halfWidth).toBeCloseTo(20.5, 1);

      // The extent is where visibility turns over, to a hundredth of a unit.
      expect(view.project({ x: 0, y: halfHeight - 0.01, z: 0 }).visible).toBe(true);
      expect(view.project({ x: 0, y: halfHeight + 0.01, z: 0 }).visible).toBe(false);
      expect(view.project({ x: halfWidth - 0.01, y: 0, z: 0 }).visible).toBe(true);
      expect(view.project({ x: halfWidth + 0.01, y: 0, z: 0 }).visible).toBe(false);
    });

    it("keeps a run of -8..8 in view, cube and all", async () => {
      // "and a run of `-8..8` keeps the cube in view". The cube is a unit box, so
      // what has to stay inside the field is half a unit beyond each end of the run.
      const { engine } = boot();
      await engine.initialize();
      const view = engine.view();

      for (const x of [-LIMIT - 0.5, -LIMIT, 0, LIMIT, LIMIT + 0.5]) {
        const projected = view.project({ x, y: 0, z: 0 });
        expect(projected.visible).toBe(true);
        // The projection lands inside the logical field the screen layer draws in.
        expect(projected.x).toBeGreaterThanOrEqual(0);
        expect(projected.x).toBeLessThanOrEqual(640);
      }

      // The centre of the field is the middle of the design size, and the run is
      // symmetric about it.
      expect(view.project({ x: 0, y: 0, z: 0 }).x).toBeCloseTo(320, 6);
      expect(view.project({ x: 0, y: 0, z: 0 }).y).toBeCloseTo(180, 6);
    });
  });

  describe("what the game owns", () => {
    it("initialize reaches for nothing but the scene", async () => {
      // "It registers no action, loads no asset, and defines no cue, so what
      // remains is the whole of what a build must supply." Read at the source: the
      // game's `initialize` is handed an API that answers for `scene` and refuses
      // every other member.
      const reached: string[] = [];
      const scene = new THREE.Scene();
      const api = new Proxy({} as InitApi<State>, {
        get(_target, property): unknown {
          const name = String(property);
          reached.push(name);
          if (name === "scene") return scene;
          throw new Error(`the minimal game reached for api.${name}`);
        },
      });

      const [state, debug] = await drifter.initialize(api);

      expect(reached).toEqual(["scene", "scene"]);
      expect(state).toEqual({ x: -LIMIT, vx: SPEED });
      expect(debug).toBeNull();
    });

    it("registers no diagnostic and broadcasts no asset or cue over a long run", async () => {
      const { engine } = boot();
      const events: string[] = [];
      for (const event of [
        "asset:loaded",
        "asset:failed",
        "cue:played",
        "cue:looped",
        "cue:stopped",
      ] as const) {
        engine.events.on(event, () => events.push(event));
      }

      await engine.initialize();
      await engine.advance(240);

      expect(events).toEqual([]);
      expect(engine.diagnostics()).toEqual([]);
    });

    it("adds the light and the cube to the retained scene, and both stay there", async () => {
      // "`initialize` adds the light and the cube to `api.scene`, the engine's
      // retained scene, and both are still there when every later `render` runs."
      const { engine } = boot();
      await engine.initialize();

      expect(engine.scene.children).toHaveLength(2);
      expect(engine.scene.children[0]).toBeInstanceOf(THREE.HemisphereLight);
      expect(engine.scene.children[1]).toBe(cube);
      expect(engine.scene.getObjectByName("drifter")).toBe(cube);

      await engine.advance(300);

      expect(engine.scene.children).toHaveLength(2);
      expect(engine.scene.getObjectByName("drifter")).toBe(cube);
      // Retained past the engine's own life, as the contract says.
      engine.destroy();
      expect(engine.scene.getObjectByName("drifter")).toBe(cube);
    });
  });

  describe("update", () => {
    it("keeps the value returned as the state the next frame receives", async () => {
      // "Each branch spreads the current state into a new one, and the engine keeps
      // the value returned as the state the next frame receives."
      const { engine } = boot();
      const opening = await engine.initialize();

      const seen: State[] = [];
      for (let frame = 0; frame < 5; frame += 1) {
        await engine.advance(1);
        seen.push(engine.state as State);
      }

      // A fresh value every frame, none of them the one `initialize` built.
      expect(new Set(seen).size).toBe(5);
      expect(seen).not.toContain(opening);
      for (const [index, state] of seen.entries()) {
        expect(state.x).toBeCloseTo(-LIMIT + (SPEED * (index + 1)) / 60, 12);
        expect(state.vx).toBe(SPEED);
      }
    });

    it("drifts at SPEED and reflects the overshoot off both ends of the run", async () => {
      const { engine } = boot();
      await engine.initialize();

      // One second in: a quarter of the run travelled, no end reached.
      await engine.advance(60);
      expect(engine.state.x).toBeCloseTo(-LIMIT + SPEED, 6);
      expect(engine.state.vx).toBe(SPEED);

      // The run is 16 units at 4 units a second, so `x = LIMIT` falls at t = 4s.
      // A frame later the cube has reflected and is heading back.
      await engine.advance(180);
      expect(engine.state.x).toBeCloseTo(LIMIT, 6);
      const atFour = engine.state.x;
      await engine.advance(1);
      expect(engine.state.vx).toBe(-SPEED);
      expect(engine.state.x).toBeLessThan(atFour);

      // The far end falls at t = 8s, and the cube reflects there too. Every frame
      // in between stays inside the run the page derives.
      for (let frame = 241; frame < 481; frame += 1) {
        await engine.advance(1);
        expect(engine.state.x).toBeGreaterThanOrEqual(-LIMIT);
        expect(engine.state.x).toBeLessThanOrEqual(LIMIT);
      }
      expect(engine.frame().count).toBe(481);
      expect(engine.state.x).toBeCloseTo(expectedX(engine.frame().timeMs / 1000), 6);
      expect(engine.state.vx).toBe(SPEED);

      // And it agrees with the continuous fold at every sample along the way.
      for (const seconds of [0.5, 1, 2, 3.5, 4.5, 6, 7.5, 9, 11]) {
        await advanceMs(engine, seconds * 1000 - engine.frame().timeMs);
        expect(engine.state.x).toBeCloseTo(
          expectedX(engine.frame().timeMs / 1000),
          6,
        );
      }
    });

    it("keeps the outcome the same whatever step size the clock delivers", async () => {
      // "`update` multiplies by `dt` in seconds and reflects the overshoot back
      // into the run, which keeps the outcome the same whatever step size the clock
      // delivers." An even step, a repeating uneven pattern, and a seeded draw all
      // land on the fold of the same uniform motion.
      const clocks: Clock[] = [
        new ConstantClock(1000 / 60),
        new SequenceClock([8, 33, 12, 21]),
        new JitterClock(8, 40, 7),
      ];

      for (const clock of clocks) {
        const { engine } = boot(clock);
        await engine.initialize();

        // Long enough to cross both ends of the run, whatever the cadence.
        await advanceMs(engine, 9000);

        expect(engine.frame().count).toBeGreaterThan(0);
        expect(engine.state.x).toBeCloseTo(
          expectedX(engine.frame().timeMs / 1000),
          6,
        );
        engine.destroy();
      }
    });
  });

  describe("render", () => {
    it("writes the cube's position from the state", async () => {
      // "`render` writes the cube's position from the state". The cube is a three
      // object the state never names, so this is the only place the two meet.
      const { engine } = boot();
      await engine.initialize();

      for (let step = 0; step < 4; step += 1) {
        await engine.advance(37);
        expect(cube.position.x).toBeCloseTo(engine.state.x, 12);
        expect(cube.position.y).toBe(0);
        expect(cube.position.z).toBe(0);
      }
    });

    it("draws the readout in logical units on a cleared, viewport-transformed context", async () => {
      // "`render` ... draws the readout on the screen layer in logical units,
      // against a context that arrives cleared and already carrying the viewport
      // transform, so the text lands in the same place on every display."
      const { engine, screen } = boot();
      await engine.initialize();

      screen.forget();
      await engine.advance(1);

      // Cleared under the identity, so the whole backing store goes, and only then
      // pointed at the logical field.
      const names = screen.names();
      const cleared = names.indexOf("clearRect");
      const drawn = names.indexOf("fillText");
      expect(cleared).toBeGreaterThanOrEqual(0);
      expect(drawn).toBeGreaterThan(cleared);
      const clear = screen.opsOf("clearRect")[0];
      expect(clear?.transform).toEqual(IDENTITY);
      expect(clear?.args).toEqual([0, 0, CSS_WIDTH * DPR, CSS_HEIGHT * DPR]);

      const readout = screen.opsOf("fillText")[0];
      expect(readout?.text).toBe(`x ${engine.state.x.toFixed(2)}`);
      expect(readout?.args).toEqual([`x ${engine.state.x.toFixed(2)}`, 16, 28]);
      expect(readout?.transform).toEqual(VIEWPORT_TRANSFORM);
      expect(readout?.fill).toBe("#e6edf6");
      expect(screen.ctx.font).toBe("16px monospace");

      // "so the text lands in the same place on every display" — the same logical
      // coordinates under a different fit, and one readout per frame.
      screen.forget();
      await engine.advance(1);
      expect(screen.opsOf("fillText")).toHaveLength(1);
      expect(screen.opsOf("fillText")[0]?.args.slice(1)).toEqual([16, 28]);
    });

    it("renders the scene and composites the layer after render returns", async () => {
      // "The engine renders the scene through the camera after `render` returns and
      // composites the screen layer over the picture." Read through the geometry
      // the renderer actually submitted: none of it had been drawn when the game
      // wrote its readout, and by the end of the frame there are two draws — the
      // cube through the camera, and the composite's full-canvas quad.
      const { engine, gl, screen } = boot();
      await engine.initialize();

      let drawsWhenTheGameDrew = -1;
      const ctx = screen.ctx;
      const realFillText = ctx.fillText.bind(ctx);
      ctx.fillText = ((text: string, x: number, y: number): void => {
        if (drawsWhenTheGameDrew < 0) {
          drawsWhenTheGameDrew = gl.callsTo("drawElements").length;
        }
        realFillText(text, x, y);
      }) as CanvasRenderingContext2D["fillText"];

      gl.forget();
      await engine.advance(1);

      expect(drawsWhenTheGameDrew).toBe(0);
      expect(gl.callsTo("drawElements")).toHaveLength(2);

      // "A CSS color the whole canvas is cleared to before every frame, letterbox
      // bars included" — `background: "#05060a"`, opaque, cleared with the scissor
      // off so the bars are covered too.
      const clearColour = gl.callsTo("clearColor")[0]?.args as number[];
      expect(clearColour?.[3]).toBe(1);
      const scissored = gl
        .callsTo("scissor")
        .map((call) => call.args as number[]);
      expect(scissored[scissored.length - 1]).toEqual([
        OFFSET_X,
        OFFSET_Y,
        640 * SCALE,
        360 * SCALE,
      ]);
    });
  });
});
