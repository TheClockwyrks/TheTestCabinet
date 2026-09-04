import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeepReadonly } from "ts-essentials";
import type {
  Clock,
  Engine,
  EngineEventMap,
  Game,
  InitApi,
  Model,
  RenderApi,
  UpdateApi,
  Vec3,
} from "./contract";
import { cloneModel, ConstantClock, createEngine } from "./index";
import type { Context2dStub, Stage } from "./testing/canvas";
import { createStage } from "./testing/canvas";

/**
 * The documentation's worked example "Audio and Assets", transcribed and run.
 *
 * The code under test is the page at
 * `docs/engines/simple-3d/examples/audio-and-assets.md` — the Runner build: a
 * game that resolves a produced `.glb` and a produced `.wav` during
 * initialization, clones the model into the scene, sounds a synthesized cue on a
 * control edge and the file-backed cue at the ship's position when the ship
 * reaches a wall, and puts the one file this workspace holds no copy of on
 * screen. `src/game.ts` is transcribed below unchanged, and `src/main.ts` is
 * followed line for line as far as a test process allows.
 *
 * Only what the environment forces is adapted, and none of it touches the
 * example's own code:
 *
 * - **The page.** jsdom performs no layout and yields no canvas of any kind, so
 *   the `<canvas id="game">` the markup declares becomes the stage canvas from
 *   `src/testing/`, with a second canvas for the screen layer and a
 *   `SurfaceMetrics` reporting the size the CSS would have produced. The design
 *   field is measured at a device pixel ratio of 2 on purpose: the screen layer
 *   then carries a scale-2 transform, so an assertion about *logical*
 *   coordinates is an assertion about the arguments the game passed rather than
 *   about the identity transform.
 * - **The frames.** `main.ts` runs the loop off the host's frame callback on a
 *   wall clock; a suite steps synchronously with a scripted clock and
 *   `engine.advance`, which is what the validators pages prescribe. The step is
 *   125 ms — a delta of an eighth of a second, so `SPEED * dt` is exactly 1.5
 *   and every position the ship reaches is exact in binary.
 * - **The files.** `assets/models/ship.glb` and `assets/audio/impact.wav` are
 *   served over a scripted `fetch` — the `.glb` a real glTF container three's own
 *   decoder parses — and `assets/sprites/banner.png` is the 404 the page's notice
 *   reports. Web Audio and the image decoder are stood in for, because jsdom has
 *   neither.
 * - **`watched`.** Two checks need the very `UpdateApi` and `InitApi` objects the
 *   engine hands the game, to reach `audio.loop`/`place`/`stop` and
 *   `assets.loadModel` — API surface the page narrates but this particular build
 *   never calls. `watched` is a delegate that records those two objects and
 *   forwards every call to `runner` unchanged; every other check is handed
 *   `runner` itself.
 *
 * The assertions are the outcomes the page narrates: where the files resolve,
 * what `initialize` has finished doing by the time it returns, the two kinds of
 * cue and the two ways of placing them, the edge that fires once per wall, both
 * direction edges being consumed, the banner turned into a value, and the failed
 * load reaching both the game's own handler and the caller's.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures: the environment the example's page would have supplied           */
/* -------------------------------------------------------------------------- */

/** The logical design field `main.ts` declares. */
const DESIGN_WIDTH = 640;
const DESIGN_HEIGHT = 360;

/** The device pixel ratio the rig measures at, and the fit it produces. */
const DPR = 2;
const VIEWPORT_TRANSFORM = [DPR, 0, 0, DPR, 0, 0];

/** The step every scripted clock below delivers: an eighth of a second. */
const STEP_MS = 125;

/** `SPEED * dt` for that step — the distance the ship covers in one frame. */
const PER_FRAME = 1.5;

/** The three paths the build names, as they resolve under the default root. */
const URL_MODEL = "assets/models/ship.glb";
const URL_AUDIO = "assets/audio/impact.wav";
const URL_BANNER = "assets/sprites/banner.png";

/** The bitmap `sprites/banner.png` decodes to on the run where it is present. */
const BANNER = {
  width: 200,
  height: 40,
  close: () => {},
} as unknown as ImageBitmap;

/** The buffer `audio/impact.wav` decodes to, checked back by identity. */
const IMPACT = { duration: 0.3 } as unknown as AudioBuffer;

/* -------------------------------------------------------------------------- */
/* The produced `.glb`                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The bytes of a UTF-8 string, in a freshly constructed `ArrayBuffer`.
 *
 * The copy matters under jsdom: `TextEncoder`'s own buffer belongs to another
 * realm, and three branches on `data instanceof ArrayBuffer` to tell glTF bytes
 * from a glTF document. A real `Blob.arrayBuffer()` has no such problem, and the
 * copy is what makes the fixture behave like one.
 */
function utf8(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return buffer;
}

/** A `.glb` container around a glTF JSON document and its binary chunk. */
function glb(json: unknown, bin: Uint8Array): ArrayBuffer {
  const jsonBytes = new Uint8Array(utf8(JSON.stringify(json)));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length + binPad;

  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const out = new Uint8Array(buffer);

  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true); // glTF 2.0
  view.setUint32(8, total, true);

  let at = 12;
  view.setUint32(at, jsonBytes.length + jsonPad, true);
  view.setUint32(at + 4, 0x4e4f534a, true); // "JSON"
  out.set(jsonBytes, at + 8);
  // The JSON chunk pads with spaces, per the container's own rules.
  out.fill(0x20, at + 8 + jsonBytes.length, at + 8 + jsonBytes.length + jsonPad);
  at += 8 + jsonBytes.length + jsonPad;

  view.setUint32(at, bin.length + binPad, true);
  view.setUint32(at + 4, 0x004e4942, true); // "BIN\0"
  out.set(bin, at + 8);

  return buffer;
}

/**
 * The ship the case's asset generation would have produced: a named scene
 * holding a named hull with a named turret under it.
 *
 * Hand-built rather than checked in as a fixture file so the node tree the
 * example's `cloneModel` reproduces is visible in the suite that asserts it. The
 * scene's own name is deliberately *not* `"ship"`: the build renames its clone,
 * and keeping the template's name distinct is what lets a check see the rename.
 */
const SHIP_NODES = ["ship-rig", "hull", "turret"] as const;

function shipGlb(): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  return glb(
    {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ name: SHIP_NODES[0], nodes: [0] }],
      nodes: [{ name: SHIP_NODES[1], mesh: 0, children: [1] }, { name: SHIP_NODES[2] }],
      meshes: [{ name: "hull-mesh", primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: "VEC3",
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36 }],
    },
    new Uint8Array(positions.buffer),
  );
}

const SHIP_GLB = shipGlb();

/* -------------------------------------------------------------------------- */
/* The asset server                                                           */
/* -------------------------------------------------------------------------- */

/** A body whose bytes can be read, which jsdom's own `Blob` cannot promise. */
function body(buffer: ArrayBuffer = new ArrayBuffer(8)): Blob {
  return { arrayBuffer: () => Promise.resolve(buffer) } as unknown as Blob;
}

/**
 * The example's `assets/` directory, served over a scripted `fetch`.
 *
 * The two files the page lists are held; `sprites/banner.png` is the load the
 * notice on screen reports, unless a check asks for the run where it arrived.
 */
function serve(url: string): Promise<Response> {
  if (url === URL_MODEL) return Promise.resolve(response(body(SHIP_GLB)));
  if (url === URL_AUDIO) return Promise.resolve(response(body()));
  if (url === URL_BANNER && bannerHeld) return Promise.resolve(response(body()));
  return Promise.resolve({
    ok: false,
    status: 404,
    blob: () => Promise.resolve(body()),
  } as unknown as Response);
}

function response(held: Blob): Response {
  return {
    ok: true,
    status: 200,
    blob: () => Promise.resolve(held),
  } as unknown as Response;
}

/** Whether this run's workspace holds `sprites/banner.png`. */
let bannerHeld = false;

/* -------------------------------------------------------------------------- */
/* The Web Audio the host lacks                                               */
/* -------------------------------------------------------------------------- */

/** An `AudioParam` that remembers the last value scheduled on it. */
interface FakeParam {
  value: number;
  setValueAtTime(value: number): void;
}

function fakeParam(): FakeParam {
  const param: FakeParam = {
    value: 0,
    setValueAtTime(value: number): void {
      param.value = value;
    },
  };
  return param;
}

interface FakePanner {
  positionX: FakeParam;
  positionY: FakeParam;
  positionZ: FakeParam;
  connectedTo: unknown[];
  connect(node: unknown): void;
  disconnect(): void;
  panningModel: string;
  distanceModel: string;
  refDistance: number;
  rolloffFactor: number;
  maxDistance: number;
  setPosition(): void;
}

interface FakeSource {
  buffer: AudioBuffer | null;
  loop: boolean;
  connect(): void;
  disconnect(): void;
  start(): void;
  stop(): void;
}

interface FakeOscillator {
  type: string;
  frequency: { setValueAtTime(): void; linearRampToValueAtTime(): void };
  connect(): void;
  disconnect(): void;
  start(): void;
  stop(): void;
}

interface FakeGain {
  gain: FakeParam & { exponentialRampToValueAtTime(): void };
  connect(): void;
  disconnect(): void;
}

interface FakeListener {
  positionX: FakeParam;
  positionY: FakeParam;
  positionZ: FakeParam;
  forwardX: FakeParam;
  forwardY: FakeParam;
  forwardZ: FakeParam;
  upX: FakeParam;
  upY: FakeParam;
  upZ: FakeParam;
  setPosition(): void;
  setOrientation(): void;
}

/**
 * The audio graph the browser would have supplied, with every node the bus built
 * kept so a check can read where it was put.
 *
 * The same object serves both halves of the engine's shared context: it decodes
 * `impact.wav` for the asset loader and it plays for the audio bus, which is what
 * a real page's one `AudioContext` does.
 */
interface FakeAudio {
  ctx: AudioContext;
  listener: FakeListener;
  panners: FakePanner[];
  sources: FakeSource[];
  oscillators: FakeOscillator[];
  gains: FakeGain[];
  destination: object;
}

function fakeAudio(): FakeAudio {
  const panners: FakePanner[] = [];
  const sources: FakeSource[] = [];
  const oscillators: FakeOscillator[] = [];
  const gains: FakeGain[] = [];
  const destination = {};

  const listener: FakeListener = {
    positionX: fakeParam(),
    positionY: fakeParam(),
    positionZ: fakeParam(),
    forwardX: fakeParam(),
    forwardY: fakeParam(),
    forwardZ: fakeParam(),
    upX: fakeParam(),
    upY: fakeParam(),
    upZ: fakeParam(),
    setPosition: () => {},
    setOrientation: () => {},
  };

  const ctx = {
    currentTime: 0,
    destination,
    listener,
    resume: () => Promise.resolve(),
    decodeAudioData: () => Promise.resolve(IMPACT),
    createPanner: (): FakePanner => {
      const panner: FakePanner = {
        positionX: fakeParam(),
        positionY: fakeParam(),
        positionZ: fakeParam(),
        connectedTo: [],
        connect: (node: unknown) => panner.connectedTo.push(node),
        disconnect: () => {},
        panningModel: "equalpower",
        distanceModel: "linear",
        refDistance: 0,
        rolloffFactor: 0,
        maxDistance: 0,
        setPosition: () => {},
      };
      panners.push(panner);
      return panner;
    },
    createBufferSource: (): FakeSource => {
      const source: FakeSource = {
        buffer: null,
        loop: false,
        connect: () => {},
        disconnect: () => {},
        start: () => {},
        stop: () => {},
      };
      sources.push(source);
      return source;
    },
    createOscillator: (): FakeOscillator => {
      const osc: FakeOscillator = {
        type: "sine",
        frequency: {
          setValueAtTime: () => {},
          linearRampToValueAtTime: () => {},
        },
        connect: () => {},
        disconnect: () => {},
        start: () => {},
        stop: () => {},
      };
      oscillators.push(osc);
      return osc;
    },
    createGain: (): FakeGain => {
      const node: FakeGain = {
        gain: { ...fakeParam(), exponentialRampToValueAtTime: () => {} },
        connect: () => {},
        disconnect: () => {},
      };
      // The spread above copies the closure-free half of `fakeParam`, so the
      // setter has to be rebound onto the object a check actually reads.
      node.gain.setValueAtTime = (value: number): void => {
        node.gain.value = value;
      };
      gains.push(node);
      return node;
    },
  };

  return {
    ctx: ctx as unknown as AudioContext,
    listener,
    panners,
    sources,
    oscillators,
    gains,
    destination,
  };
}

/** The graph this test's engine plays through. */
let audio: FakeAudio;

/**
 * The `AudioContext` constructor the engine reaches for.
 *
 * Returning an object from the constructor is what hands every `new AudioContext()`
 * the *same* graph, which is the engine's own arrangement: the asset loader decodes
 * through one context and the bus plays through it, and a buffer belongs to the
 * context that decoded it.
 */
class FakeAudioContext {
  constructor() {
    return audio.ctx as unknown as FakeAudioContext;
  }
}

/** Where a listener or a panner was put, as the three numbers it was given. */
function positionOf(node: {
  positionX: FakeParam;
  positionY: FakeParam;
  positionZ: FakeParam;
}): Vec3 {
  return {
    x: node.positionX.value,
    y: node.positionY.value,
    z: node.positionZ.value,
  };
}

/* -------------------------------------------------------------------------- */
/* src/game.ts — transcribed verbatim                                         */
/* -------------------------------------------------------------------------- */

const SPEED = 12;
const HALF_WIDTH = 8;

interface RunnerState {
  readonly banner: ImageBitmap | null;
  readonly notice: string | null;
  readonly x: number;
  readonly againstWall: boolean;
}

const runner: Game<RunnerState, null> = {
  async initialize(api: InitApi<RunnerState>): Promise<[RunnerState, null]> {
    api.input.register("left", { keys: ["KeyA", "ArrowLeft"], kind: "analog" });
    api.input.register("right", {
      keys: ["KeyD", "ArrowRight"],
      kind: "analog",
    });
    api.input.register("mute", { keys: ["KeyM"] });

    api.audio.define("thrust", {
      wave: "sawtooth",
      freq: 90,
      freqTo: 140,
      gain: 0.25,
      durationMs: 120,
    });

    const failed: string[] = [];
    const off = api.events.on("asset:failed", (event) => {
      failed.push(`${event.path} unavailable: ${event.reason}`);
    });

    const [model] = await Promise.all([
      api.assets.loadModel("models/ship.glb"),
      api.audio.load("impact", "audio/impact.wav"),
    ]);

    const banner = await api.assets
      .loadImage("sprites/banner.png")
      .catch(() => null);
    off();

    const ship = cloneModel(model);
    ship.name = "ship";
    api.scene.add(ship);
    api.scene.add(new THREE.HemisphereLight("#ffffff", "#30343f", 2));

    const state: RunnerState = {
      banner,
      notice: failed[0] ?? null,
      x: 0,
      againstWall: false,
    };
    return [state, null];
  },

  update(state: DeepReadonly<RunnerState>, api: UpdateApi, dt: number): RunnerState {
    if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());

    const startedLeft = api.input.pressed("left");
    const startedRight = api.input.pressed("right");
    if (startedLeft || startedRight) api.audio.play("thrust");

    const steer = api.input.value("right") - api.input.value("left");
    const moved = state.x + steer * SPEED * dt;
    const clamped = Math.min(Math.max(moved, -HALF_WIDTH), HALF_WIDTH);
    const againstWall = clamped !== moved;

    if (againstWall && !state.againstWall) {
      api.audio.play("impact", { at: { x: clamped, y: 0, z: 0 } });
    }
    return { ...state, x: clamped, againstWall };
  },

  render(state: DeepReadonly<RunnerState>, api: RenderApi): void {
    const ship = api.scene.getObjectByName("ship");
    if (ship !== undefined) ship.position.set(state.x, 0, 0);

    api.camera.position.set(0, 6, 14);
    api.camera.lookAt(0, 0, 0);

    const { screen } = api;
    const { width } = api.viewport();

    if (state.banner !== null) {
      screen.drawImage(state.banner, (width - state.banner.width) / 2, 56);
    }

    if (state.notice !== null) {
      screen.fillStyle = "#ffb4a2";
      screen.font = "14px monospace";
      screen.fillText(state.notice, 16, 28);
    }
  },
};

/* -------------------------------------------------------------------------- */
/* src/main.ts — transcribed, with the adaptations the header describes       */
/* -------------------------------------------------------------------------- */

/**
 * A delegate over `runner` that records the two scoped API objects the engine
 * hands it and forwards every call unchanged.
 *
 * The engine builds those objects once and reuses them for its lifetime, so a
 * check holding one holds a live seam onto the engine — which is what lets the
 * two checks below reach `audio.loop`, `audio.place` and `assets.loadModel`, API
 * the page narrates but the Runner build itself never calls.
 */
interface Watched {
  game: Game<RunnerState, null>;
  init(): InitApi<RunnerState>;
  update(): UpdateApi;
}

function watched(): Watched {
  let initApi: InitApi<RunnerState> | null = null;
  let updateApi: UpdateApi | null = null;
  return {
    game: {
      initialize: (api): Promise<[RunnerState, null]> => {
        initApi = api;
        return Promise.resolve(runner.initialize(api));
      },
      update: (state, api, dt): RunnerState => {
        updateApi = api;
        return runner.update(state, api, dt);
      },
      render: (state, api): void => runner.render(state, api),
    },
    init: (): InitApi<RunnerState> => {
      if (initApi === null) throw new Error("the game has not initialized yet");
      return initApi;
    },
    update: (): UpdateApi => {
      if (updateApi === null) throw new Error("no frame has run yet");
      return updateApi;
    },
  };
}

/** Everything a check holds onto: the engine, and the rig it was built over. */
interface Booted {
  engine: Engine<RunnerState, null>;
  /** The operations the screen layer recorded, with the transform in force for each. */
  screen: Context2dStub;
  /** The target the engine listens on — where a player's keystrokes arrive. */
  target: EventTarget;
  /** What `main.ts`'s own `asset:failed` subscription warned. */
  warned: string[];
  stage: Stage;
}

interface BootOptions {
  /** The scripted clock the frames are stepped off; an eighth of a second by default. */
  clock?: Clock;
  /** Runs between construction and `initialize`, where `main.ts` subscribes. */
  before?: (engine: Engine<RunnerState, null>) => void;
  /** The game to drive; `runner` itself unless a check needs the delegate. */
  game?: Game<RunnerState, null>;
}

let fetcher: ReturnType<typeof vi.fn>;
let decoder: ReturnType<typeof vi.fn>;
const engines: Engine<RunnerState, null>[] = [];

/**
 * `main.ts`, line for line where the environment allows: the engine is built over
 * the page's own options, `asset:failed` is subscribed *before* `initialize`, and
 * `initialize` is awaited. `run` and its `AbortController` are replaced by the
 * scripted clock and `advance`, and `destroy` runs from the suite's teardown
 * rather than after the loop.
 */
async function boot(options: BootOptions = {}): Promise<Booted> {
  const stage = createStage({
    cssWidth: DESIGN_WIDTH,
    cssHeight: DESIGN_HEIGHT,
    dpr: DPR,
  });

  const engine = createEngine<RunnerState, null>({
    canvas: stage.stage.canvas,
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    background: "#05060a",
    game: options.game ?? runner,
    clock: options.clock ?? new ConstantClock(STEP_MS),
    surface: stage.surface.surface,
    screen: stage.screen.canvas,
  });
  engines.push(engine);

  const warned: string[] = [];
  engine.events.on("asset:failed", (event) => {
    warned.push(`asset failed: ${event.path} (${event.reason})`);
  });

  options.before?.(engine);
  await engine.initialize();

  return {
    engine,
    screen: stage.screen.context2d,
    target: stage.surface.target,
    warned,
    stage,
  };
}

beforeEach(() => {
  bannerHeld = false;
  audio = fakeAudio();
  fetcher = vi.fn(serve);
  decoder = vi.fn(() => Promise.resolve(BANNER));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("createImageBitmap", decoder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => {
  for (const engine of engines.splice(0)) engine.destroy();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* Driving the build                                                          */
/* -------------------------------------------------------------------------- */

/** A key going down at the surface, the path a player's keystrokes take. */
function keyDown(target: EventTarget, code: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { code }));
}

/** The same key coming up. */
function keyUp(target: EventTarget, code: string): void {
  target.dispatchEvent(new KeyboardEvent("keyup", { code }));
}

/** One recorded cue, as the page's own prose talks about them. */
interface Cue {
  cue: string;
  t: number;
  gain: number;
  at: Vec3 | null;
}

/** Collects every cue transition the engine publishes, in order. */
function cues(engine: Engine<RunnerState, null>): {
  played: Cue[];
  looped: Cue[];
  stopped: string[];
} {
  const played: Cue[] = [];
  const looped: Cue[] = [];
  const stopped: string[] = [];
  engine.events.on("cue:played", (event) => played.push({ ...event }));
  engine.events.on("cue:looped", (event) => looped.push({ ...event }));
  engine.events.on("cue:stopped", (event) => stopped.push(event.cue));
  return { played, looped, stopped };
}

/** Where the build's ship stands in the scene. */
function shipOf(engine: Engine<RunnerState, null>): THREE.Object3D {
  const ship = engine.scene.getObjectByName("ship");
  if (ship === undefined) throw new Error("the scene holds no object named ship");
  return ship;
}

/**
 * How many handlers are subscribed to `event`.
 *
 * Reaches past the bus's own surface deliberately, and it is the only assertion
 * here that does. The page claims the game's `asset:failed` subscription is
 * *removed* once its loads have settled, and in this build the removal has no
 * other outward sign: the handler it drops writes to a local array whose first
 * entry has already been copied into the state.
 */
function subscribers(
  engine: Engine<RunnerState, null>,
  event: keyof EngineEventMap,
): number {
  const bus = engine.events as unknown as {
    bins: Map<keyof EngineEventMap, readonly unknown[]>;
  };
  return bus.bins.get(event)?.length ?? 0;
}

/* -------------------------------------------------------------------------- */
/* The outcomes the page narrates                                             */
/* -------------------------------------------------------------------------- */

type Announced =
  | { event: "loaded"; payload: EngineEventMap["asset:loaded"] }
  | { event: "failed"; payload: EngineEventMap["asset:failed"] };

describe("the audio-and-assets example", () => {
  it("resolves every path under the asset root and reports the file the workspace has no copy of", async () => {
    const announced: Announced[] = [];
    const { warned } = await boot({
      before: (engine) => {
        // "The engine exists before any loading happens" — construction fetched
        // nothing and ran no game code.
        expect(fetcher).not.toHaveBeenCalled();
        engine.events.on("asset:loaded", (payload) =>
          announced.push({ event: "loaded", payload }),
        );
        engine.events.on("asset:failed", (payload) =>
          announced.push({ event: "failed", payload }),
        );
      },
    });

    // "Every path a game names resolves under the asset root, which is `assets/`":
    // the model and the sound the build awaits together, then the optional banner.
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      URL_MODEL,
      URL_AUDIO,
      URL_BANNER,
    ]);

    // Exactly one event per load, the two arrivals in either order and the
    // failure last, after the pair `Promise.all` waited on.
    expect(announced).toHaveLength(3);
    expect(announced.slice(0, 2)).toEqual(
      expect.arrayContaining([
        { event: "loaded", payload: { path: "models/ship.glb", url: URL_MODEL } },
        { event: "loaded", payload: { path: "audio/impact.wav", url: URL_AUDIO } },
      ]),
    );

    // "The payload names the path the game asked for, the URL it resolved to,
    // and the reason, so the notice on screen identifies the file to add."
    expect(announced[2]).toEqual({
      event: "failed",
      payload: {
        path: "sprites/banner.png",
        url: URL_BANNER,
        reason: expect.stringContaining("404"),
      },
    });

    // "The same event reaches any subscriber the caller attached to
    // `engine.events` before `initialize` ran" — main.ts's own warning.
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatch(/^asset failed: sprites\/banner\.png \(/);
    expect(warned[0]).toContain("404");
  });

  it("returns a state with every field present, the ship placed and the light with it", async () => {
    const { engine } = await boot();

    // "`initialize` returns once every load it awaited has resolved ... `update`
    // and `render` read the state's fields directly, and the state type declares
    // each of them as present." Nothing is pending and nothing is a placeholder.
    expect(Object.keys(engine.state).sort()).toEqual([
      "againstWall",
      "banner",
      "notice",
      "x",
    ]);
    expect(engine.state.banner).toBeNull();
    expect(engine.state.x).toBe(0);
    expect(engine.state.againstWall).toBe(false);
    expect(engine.state.notice).toMatch(/^sprites\/banner\.png unavailable: /);
    expect(engine.state.notice).toContain("404");

    // "The model is a three object, so it lives in the scene rather than in the
    // state" — the scene holds the clone and the light, and nothing else.
    expect(engine.scene.children).toHaveLength(2);
    const ship = shipOf(engine);
    expect(ship).toBeInstanceOf(THREE.Group);
    expect(engine.scene.children[0]).toBe(ship);

    // "`initialize` clones the template `loadModel` returned with `cloneModel`,
    // names the clone, and adds it to `api.scene`". Node names survive the clone,
    // so the exporter's own names are what `getObjectByName` finds; the root's
    // name is the build's, not the file's.
    expect(ship.name).toBe("ship");
    expect(ship.getObjectByName(SHIP_NODES[1])).toBeInstanceOf(THREE.Mesh);
    expect(ship.getObjectByName(SHIP_NODES[2])).toBeDefined();
    expect(engine.scene.getObjectByName(SHIP_NODES[0])).toBeUndefined();
    // The clone starts at its rest pose, before any frame has posed it.
    expect(ship.position.toArray()).toEqual([0, 0, 0]);

    const light = engine.scene.children[1];
    expect(light).toBeInstanceOf(THREE.HemisphereLight);
    expect((light as THREE.HemisphereLight).intensity).toBe(2);
    expect((light as THREE.HemisphereLight).color.getHexString()).toBe("ffffff");
    expect((light as THREE.HemisphereLight).groundColor.getHexString()).toBe(
      "30343f",
    );
  });

  it("yields as many placed copies from one template as a game needs, each posed on its own", async () => {
    // "One template yields as many placed copies as a game needs through the same
    // call, each posed on its own." Loaded through the engine's own `InitApi`,
    // which is the call the build makes, and cloned twice rather than once.
    const observed = watched();
    await boot({ game: observed.game });

    const model: Model = await observed.init().assets.loadModel("models/ship.glb");
    expect(model.nodes).toEqual([...SHIP_NODES]);

    const first = cloneModel(model);
    const second = cloneModel(model);
    expect(first).not.toBe(second);
    expect(first).not.toBe(model.scene);
    expect(first.getObjectByName(SHIP_NODES[1])).not.toBe(
      second.getObjectByName(SHIP_NODES[1]),
    );

    first.position.set(3, 0, 0);
    expect(second.position.x).toBe(0);
    expect(model.scene.position.x).toBe(0);
  });

  it("has the impact cue playable from the very first frame", async () => {
    // A one-second step covers the whole half-width in a single frame, so the
    // file-backed cue is asked for before any frame could have finished loading
    // it — which is the page's claim about what `initialize` has already done.
    const { engine, target } = await boot({ clock: new ConstantClock(1000) });
    const recorded = cues(engine);

    keyDown(target, "KeyD");
    await engine.advance(1);

    expect(engine.state.x).toBe(HALF_WIDTH);
    expect(recorded.played.map((event) => event.cue)).toEqual([
      "thrust",
      "impact",
    ]);
    // The cue really is backed by the decoded file: the bus played the buffer the
    // loader handed it, by identity.
    expect(audio.sources).toHaveLength(1);
    expect(audio.sources[0]?.buffer).toBe(IMPACT);
  });

  it("steers at SPEED, clamps at the wall, and sounds the impact once per arrival", async () => {
    const { engine, target } = await boot();
    const recorded = cues(engine);
    const impacts = (): Cue[] =>
      recorded.played.filter((event) => event.cue === "impact");

    keyDown(target, "KeyD");
    for (const expected of [1, 2, 3, 4, 5]) {
      await engine.advance(1);
      expect(engine.state.x).toBe(expected * PER_FRAME);
      expect(engine.state.againstWall).toBe(false);
    }
    expect(impacts()).toHaveLength(0);

    // The sixth frame overshoots, so the ship is held at the wall and the
    // file-backed cue sounds at the point it reached.
    await engine.advance(1);
    expect(engine.state.x).toBe(HALF_WIDTH);
    expect(engine.state.againstWall).toBe(true);
    expect(impacts()).toHaveLength(1);
    expect(impacts()[0]?.at).toEqual({ x: HALF_WIDTH, y: 0, z: 0 });
    // A file-backed cue carries its own level, so it is announced at unity gain.
    expect(impacts()[0]?.gain).toBe(1);
    // The cue is stamped in simulated time: six frames of an eighth of a second.
    expect(impacts()[0]?.t).toBe(6 * STEP_MS);
    expect(engine.frame().count).toBe(6);

    // Still pushing into the wall is not a new arrival.
    await engine.advance(1);
    expect(engine.state.x).toBe(HALF_WIDTH);
    expect(impacts()).toHaveLength(1);

    // Backing off re-arms it: one frame left, then one frame right that lands
    // exactly on the wall without overshooting it, then the overshoot.
    keyUp(target, "KeyD");
    keyDown(target, "KeyA");
    await engine.advance(1);
    expect(engine.state.x).toBe(HALF_WIDTH - PER_FRAME);
    expect(engine.state.againstWall).toBe(false);

    keyUp(target, "KeyA");
    keyDown(target, "KeyD");
    await engine.advance(1);
    expect(engine.state.x).toBe(HALF_WIDTH);
    expect(engine.state.againstWall).toBe(false);
    expect(impacts()).toHaveLength(1);

    await engine.advance(1);
    expect(engine.state.againstWall).toBe(true);
    expect(impacts()).toHaveLength(2);
  });

  it("sounds the control cue unpositioned and the wall cue through a panner at the point reached", async () => {
    const { engine, target } = await boot();
    const recorded = cues(engine);

    keyDown(target, "KeyA");
    await engine.advance(6);

    // "`thrust` is played without `at` and sounds unpositioned, as a control cue
    // does"; "`impact` is played with `at`, the world point the ship reached".
    expect(recorded.played.map((event) => event.cue)).toEqual([
      "thrust",
      "impact",
    ]);
    expect(recorded.played[0]?.at).toBeNull();
    // A synthesized cue is announced at the gain its spec declares.
    expect(recorded.played[0]?.gain).toBe(0.25);
    expect(recorded.played[1]?.at).toEqual({ x: -HALF_WIDTH, y: 0, z: 0 });

    // "`define` declares a synthesized cue from a waveform, a frequency, an
    // optional sweep, a gain, and a duration" — the waveform the spec named is
    // the one the oscillator was built with.
    expect(audio.oscillators).toHaveLength(1);
    expect(audio.oscillators[0]?.type).toBe("sawtooth");

    // Exactly one panner: the unpositioned cue went straight to the destination,
    // and the placed one was routed through a panner standing at its point.
    expect(audio.panners).toHaveLength(1);
    const panner = audio.panners[0];
    if (panner === undefined) throw new Error("no panner was built");
    expect(positionOf(panner)).toEqual({ x: -HALF_WIDTH, y: 0, z: 0 });
    expect(panner.connectedTo).toEqual([audio.destination]);

    // "The listener is the camera as it stood at the most recent render, and this
    // build's camera is still" — so a wall at negative x is heard to the left of
    // a listener standing at the camera and facing the origin.
    expect(positionOf(audio.listener)).toEqual({ x: 0, y: 6, z: 14 });
    const length = Math.hypot(6, 14);
    expect(audio.listener.forwardX.value).toBeCloseTo(0, 10);
    expect(audio.listener.forwardY.value).toBeCloseTo(-6 / length, 10);
    expect(audio.listener.forwardZ.value).toBeCloseTo(-14 / length, 10);
    expect(engine.view().camera().position).toEqual({ x: 0, y: 6, z: 14 });
  });

  it("consumes both direction edges, so a frame that starts two directions leaves nothing armed", async () => {
    // "Reading `left` and `right` into locals before the `||` keeps both edges
    // consumed, so a frame that starts two directions at once leaves nothing
    // armed for the next frame to replay."
    const { engine, target } = await boot();
    const recorded = cues(engine);

    keyDown(target, "KeyA");
    keyDown(target, "KeyD");
    await engine.advance(1);
    expect(recorded.played.map((event) => event.cue)).toEqual(["thrust"]);
    // Both directions held cancel, so the frame is about the edges alone.
    expect(engine.state.x).toBe(0);

    await engine.advance(1);
    expect(recorded.played).toHaveLength(1);

    // A fresh press is a fresh edge, from either key of either action.
    keyUp(target, "KeyA");
    keyDown(target, "ArrowLeft");
    await engine.advance(1);
    expect(recorded.played.map((event) => event.cue)).toEqual([
      "thrust",
      "thrust",
    ]);
  });

  it("toggles mute on M, and a muted cue still announces itself at gain zero", async () => {
    const observed = watched();
    const { engine, target } = await boot({ game: observed.game });
    const recorded = cues(engine);
    const gains = (): number[] => recorded.played.map((event) => event.gain);

    keyDown(target, "KeyM");
    await engine.advance(1);
    expect(observed.update().audio.muted()).toBe(true);
    expect(recorded.played).toHaveLength(0);

    keyUp(target, "KeyM");
    keyDown(target, "KeyD");
    await engine.advance(1);
    expect(gains()).toEqual([0]);

    keyUp(target, "KeyD");
    keyDown(target, "KeyM");
    await engine.advance(1);
    expect(observed.update().audio.muted()).toBe(false);

    keyUp(target, "KeyM");
    keyDown(target, "KeyD");
    await engine.advance(1);
    expect(gains()).toEqual([0, 0.25]);
  });

  it("loops either kind of cue by name, moves a running loop with place, and ends it with stop", async () => {
    // "Both are played by name from `update` through `api.audio.play`, and either
    // kind is looped by name through `api.audio.loop` and ended through
    // `api.audio.stop`. ... A loop takes the same option, and `place` moves a
    // running loop ... `cue:played` and `cue:looped` carry the point as `at`."
    const observed = watched();
    const { engine, target } = await boot({ game: observed.game });
    // The gesture that opens the context, so the loops below build real graphs.
    keyDown(target, "KeyD");
    await engine.advance(1);

    const recorded = cues(engine);
    const bus = observed.update().audio;

    bus.loop("thrust");
    bus.loop("impact", { at: { x: 4, y: 0, z: -2 } });
    // A cue already looping is left as it is, and nothing is announced.
    bus.loop("impact", { at: { x: 0, y: 0, z: 0 } });

    expect(recorded.looped.map((event) => event.cue)).toEqual([
      "thrust",
      "impact",
    ]);
    expect(recorded.looped[0]?.at).toBeNull();
    expect(recorded.looped[1]?.at).toEqual({ x: 4, y: 0, z: -2 });
    expect(bus.looping("thrust")).toBe(true);
    expect(bus.looping("impact")).toBe(true);

    // The positioned loop stands at its point, and `place` moves it there and then.
    const panner = audio.panners.at(-1);
    if (panner === undefined) throw new Error("the placed loop built no panner");
    expect(positionOf(panner)).toEqual({ x: 4, y: 0, z: -2 });
    bus.place("impact", { x: -5, y: 1, z: 0 });
    expect(positionOf(panner)).toEqual({ x: -5, y: 1, z: 0 });
    // A move is not a transition, so nothing further is announced.
    expect(recorded.looped).toHaveLength(2);

    bus.stop("thrust");
    bus.stop("impact");
    bus.stop("impact");
    expect(recorded.stopped).toEqual(["thrust", "impact"]);
    expect(bus.looping("impact")).toBe(false);
  });

  it("moves the named clone to the state's position and poses the still camera each frame", async () => {
    // "`render` finds it again with `scene.getObjectByName` and moves it to the
    // position the state carries."
    const { engine, target } = await boot();
    const ship = shipOf(engine);

    keyDown(target, "KeyD");
    for (const expected of [1, 2, 3]) {
      await engine.advance(1);
      expect(ship.position.x).toBe(expected * PER_FRAME);
      expect(ship.position.y).toBe(0);
      expect(ship.position.z).toBe(0);
    }

    // The camera is posed by the build every frame and is still, so the reading
    // the engine takes after the render is the same one every frame.
    const camera = engine.view().camera();
    expect(camera.projection).toBe("perspective");
    expect(camera.position).toEqual({ x: 0, y: 6, z: 14 });
    await engine.advance(1);
    expect(engine.view().camera().position).toEqual(camera.position);
    expect(engine.view().camera().rotation).toEqual(camera.rotation);
  });

  it("draws the notice on the screen layer in logical coordinates, with no banner", async () => {
    const { engine, screen } = await boot();
    screen.forget();
    await engine.advance(1);

    // "The frames that draw the notice read it from there like any other field."
    const drawn = screen.opsOf("fillText");
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.args[0]).toBe(engine.state.notice);
    expect(drawn[0]?.args[0]).toMatch(/^sprites\/banner\.png unavailable: /);
    expect(drawn[0]?.fill).toBe("#ffb4a2");
    expect(screen.ctx.font).toBe("14px monospace");

    // The text lands at the logical point the build named, under the viewport
    // transform the engine installed — device pixels are the engine's business.
    expect(drawn[0]?.args.slice(1)).toEqual([16, 28]);
    expect(drawn[0]?.transform).toEqual(VIEWPORT_TRANSFORM);

    // No banner arrived, so nothing was blitted.
    expect(screen.opsOf("drawImage")).toHaveLength(0);
  });

  it("carries an arrived banner as a plain value and centres it, leaving no notice", async () => {
    // "`banner` is optional to this build, so its load is turned into a value: the
    // bitmap when it arrives and `null` when it does not."
    bannerHeld = true;
    const { engine, screen, warned } = await boot();

    expect(engine.state.banner).toBe(BANNER);
    expect(engine.state.notice).toBeNull();
    expect(warned).toEqual([]);
    expect(decoder).toHaveBeenCalledTimes(1);

    screen.forget();
    await engine.advance(1);

    // "An `ImageBitmap` is a plain value the state carries, and the screen layer
    // draws it in logical coordinates" — centred on the design width.
    const drawn = screen.opsOf("drawImage");
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.args[0]).toBe(BANNER);
    expect(drawn[0]?.args.slice(1)).toEqual([(DESIGN_WIDTH - 200) / 2, 56]);
    expect(drawn[0]?.transform).toEqual(VIEWPORT_TRANSFORM);
    expect(screen.opsOf("fillText")).toHaveLength(0);
  });

  it("removes the game's own asset:failed subscription once its loads have settled", async () => {
    // "`api.events.on(\"asset:failed\", handler)` runs the handler at the moment
    // the load fails, and returns the function that removes it ... the
    // subscription is removed once they have settled."
    let beforeInitialize = 0;
    let atTheFailure = 0;
    const { engine } = await boot({
      before: (booting) => {
        beforeInitialize = subscribers(booting, "asset:failed");
        // Counted from inside the dispatch, which is the moment the page says
        // the game's handler runs at.
        booting.events.on("asset:failed", () => {
          atTheFailure = subscribers(booting, "asset:failed");
        });
      },
    });

    // main.ts's own handler alone before a line of game code ran.
    expect(beforeInitialize).toBe(1);
    // The game's handler was on while its loads were running: main.ts's, this
    // probe's, and the game's own.
    expect(atTheFailure).toBe(3);
    // "the subscription is removed once they have settled" — the game's handler
    // is gone, and the two nothing removed are not.
    expect(subscribers(engine, "asset:failed")).toBe(2);
  });
});
