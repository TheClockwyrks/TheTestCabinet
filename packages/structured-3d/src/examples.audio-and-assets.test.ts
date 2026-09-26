import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Model, Vec3 } from "./contract";
import type { Engine } from "./engine";
import type { EngineEventMap } from "./events";
import type { GameDefinition, InitApi } from "./game-instance";
import type { LoadApi } from "./worlds";
import {
  Actor,
  ConstantClock,
  createEngine,
  distance,
  FORWARD,
  GameInstance,
  GameMode,
  LightComponent,
  MeshComponent,
  ModelComponent,
  normalize,
  quatFromAxisAngle,
  quatLookAt,
  quatRotate,
  RIGHT,
  sub,
  TextComponent,
  vec3,
} from "./index";
import { createStage, type Stage } from "./testing/canvas";

/**
 * The documentation's "Audio and Assets" example, transcribed and asserted.
 *
 * The code under test is the worked example at
 * `docs/engines/structured-3d/examples/audio-and-assets.md` — the Vault build:
 * a level that loads a produced `.glb`, a texture, and a produced `.wav` before
 * its world is built, an instance that defines a synthesized cue, a mode that
 * plays both while the match runs, and a missing banner reported on screen. The
 * example's modules are transcribed verbatim below, one section per source
 * file, and the suite asserts the outcomes the page narrates: where each file
 * resolved, that one event was announced per loader call, that three coins
 * share one model and each spins on its own clone, that the texture reached the
 * floor's material as its `map`, that the notice is a screen-space component at
 * its logical point, and that a positioned cue is routed through a panner
 * standing where the coin stood and heard from the camera.
 *
 * Four adaptations, all forced by the test environment and none touching the
 * example's own code: the stage and screen canvases come from the package's own
 * harness (jsdom yields neither a `webgl2` context nor a 2D one, and the WebGL2
 * stub is what a real `THREE.WebGLRenderer` renders through), the engine takes
 * a `ConstantClock` and the harness's `SurfaceMetrics` and is stepped with
 * `advance` instead of `run` (the pattern the validators pages show), the four
 * files the page lists are served over a scripted `fetch` with a hand-built
 * `.glb` standing in for `coin.glb`, and `src/levels/vault-mode.ts` is
 * transcribed before `src/game.ts` because in a single module the class must
 * exist by the time the definition's object literal names it.
 *
 * jsdom supplies no Web Audio at all, so the graph a positional cue is routed
 * through is a fake installed as `AudioContext`. Every claim about *where* a
 * panner stood and where the listener was placed is read off that fake; the
 * sound itself is a browser's business and a case's own validators check it
 * there.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures: the environment the example's page would have supplied           */
/* -------------------------------------------------------------------------- */

/** The bytes of a UTF-8 string, as their own exactly-sized buffer. */
function utf8(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return buffer;
}

/**
 * A `.glb` container around a glTF JSON document and its binary chunk.
 *
 * Hand-built rather than checked in as a fixture file, so the document this
 * suite loads — the scene graph, the clip named `spin`, the material — is
 * visible in the suite that depends on it.
 */
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
  out.fill(
    0x20,
    at + 8 + jsonBytes.length,
    at + 8 + jsonBytes.length + jsonPad,
  );
  at += 8 + jsonBytes.length + jsonPad;

  view.setUint32(at, bin.length + binPad, true);
  view.setUint32(at + 4, 0x004e4942, true); // "BIN\0"
  out.set(bin, at + 8);

  return buffer;
}

/** One triangle's positions, the clip's two key times, and its two rotations. */
function coinBin(): Uint8Array {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const times = new Float32Array([0, 1]);
  const rotations = new Float32Array([0, 0, 0, 1, 0, 1, 0, 0]);
  const bin = new Uint8Array(
    positions.byteLength + times.byteLength + rotations.byteLength,
  );
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(times.buffer), positions.byteLength);
  bin.set(
    new Uint8Array(rotations.buffer),
    positions.byteLength + times.byteLength,
  );
  return bin;
}

/**
 * The page's `coin.glb`: "a glTF 2.0 binary carrying one animation clip named
 * `spin`". The clip turns the `rim` node, which is what makes the model's own
 * time observable frame by frame.
 *
 * `painted` gives the material a base color map that lives beside the model, so
 * a load whose texture cannot be fetched can be asked for on demand.
 */
function coinJson(options: { painted?: boolean } = {}) {
  return {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ name: "coin", nodes: [0] }],
    nodes: [{ name: "coin-body", mesh: 0, children: [1] }, { name: "rim" }],
    meshes: [
      {
        name: "coin-mesh",
        primitives: [{ attributes: { POSITION: 0 }, material: 0 }],
      },
    ],
    materials: [
      options.painted
        ? {
            name: "gold",
            pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
          }
        : { name: "gold" },
    ],
    ...(options.painted
      ? { textures: [{ source: 0 }], images: [{ uri: "gold.png" }] }
      : {}),
    animations: [
      {
        name: "spin",
        channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }],
        samplers: [{ input: 1, output: 2, interpolation: "LINEAR" }],
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: 2,
        type: "SCALAR",
        min: [0],
        max: [1],
      },
      { bufferView: 2, componentType: 5126, count: 2, type: "VEC4" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 8 },
      { buffer: 0, byteOffset: 44, byteLength: 32 },
    ],
    buffers: [{ byteLength: 76 }],
  };
}

/** The bitmap `floor.png` decodes to, checked back by identity. */
const FLOOR = {
  width: 64,
  height: 64,
  close: () => {},
} as unknown as ImageBitmap;

/** The buffer the produced `.wav` decodes to. */
const WAV = { duration: 0.4, sampleRate: 48000 } as unknown as AudioBuffer;

/** A body whose bytes can be read, which jsdom's own `Blob` cannot promise. */
function body(buffer: ArrayBuffer): Blob {
  return {
    arrayBuffer: () => Promise.resolve(buffer),
  } as unknown as Blob;
}

/**
 * The example's asset directory, served over a scripted `fetch`.
 *
 * The three files the page lists exist under `assets/`, and
 * `sprites/banner.png` — "a file this workspace holds no copy of" — is the 404
 * the notice reports. `models/painted.glb` is not part of the build; it is here
 * so the page's last claim, about a model whose texture does not decode, can be
 * asked for through the same server.
 */
const HELD = new Map<string, () => ArrayBuffer>([
  ["assets/models/coin.glb", () => glb(coinJson(), coinBin())],
  [
    "assets/models/painted.glb",
    () => glb(coinJson({ painted: true }), coinBin()),
  ],
  ["assets/textures/floor.png", () => new ArrayBuffer(16)],
  ["assets/audio/collect.wav", () => new ArrayBuffer(32)],
]);

/**
 * `painted.glb`'s base color map, which three fetches for itself beside the
 * model. The workspace holds no copy, and the request is refused outright
 * rather than answered with a 404 body: three hands whatever body it receives
 * to the host's image decoder, and a decoder stubbed to succeed would decode a
 * 404 page as a picture.
 */
const UNREACHABLE = "assets/models/gold.png";

function serve(url: string): Promise<Response> {
  if (url === UNREACHABLE) {
    return Promise.reject(new Error("no such image"));
  }
  const held = HELD.get(url);
  if (held === undefined) {
    return Promise.resolve({
      ok: false,
      status: 404,
      blob: () => Promise.resolve(body(new ArrayBuffer(0))),
    } as unknown as Response);
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    blob: () => Promise.resolve(body(held())),
  } as unknown as Response);
}

/* -------------------------------------------------------------------------- */
/* Fixtures: the Web Audio jsdom has none of                                  */
/* -------------------------------------------------------------------------- */

/** An `AudioParam` that remembers the last value scheduled on it. */
function fakeParam(): { value: number; setValueAtTime(value: number): void } {
  const param = {
    value: 0,
    setValueAtTime(value: number): void {
      param.value = value;
    },
  };
  return param;
}

/** Where a panner or the listener ended up, as the three numbers it was given. */
function positionOf(node: {
  positionX: { value: number };
  positionY: { value: number };
  positionZ: { value: number };
}): Vec3 {
  return {
    x: node.positionX.value,
    y: node.positionY.value,
    z: node.positionZ.value,
  };
}

/** A panner, recorded so the point a positional cue sounded from is readable. */
class FakePanner {
  panningModel = "equalpower";
  distanceModel = "linear";
  refDistance = 0;
  rolloffFactor = 0;
  maxDistance = 0;
  readonly positionX = fakeParam();
  readonly positionY = fakeParam();
  readonly positionZ = fakeParam();
  setPosition(): void {}
  connect(): void {}
  disconnect(): void {}
}

/** The listener the engine poses from the camera at every render. */
class FakeListener {
  readonly positionX = fakeParam();
  readonly positionY = fakeParam();
  readonly positionZ = fakeParam();
  readonly forwardX = fakeParam();
  readonly forwardY = fakeParam();
  readonly forwardZ = fakeParam();
  readonly upX = fakeParam();
  readonly upY = fakeParam();
  readonly upZ = fakeParam();
  setPosition(): void {}
  setOrientation(): void {}
}

/**
 * The browser's audio graph, reduced to the nodes the bus builds.
 *
 * Every instance registers itself, because the engine memoizes one context and
 * shares it between the asset loader's decode and the bus's playback — so the
 * suite reads back the same object the engine plays through.
 */
class FakeAudioContext {
  static readonly built: FakeAudioContext[] = [];
  readonly currentTime = 0;
  readonly destination = {};
  readonly listener = new FakeListener();
  readonly panners: FakePanner[] = [];
  readonly oscillators: number[] = [];
  readonly sources: (AudioBuffer | null)[] = [];

  constructor() {
    FakeAudioContext.built.push(this);
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }

  decodeAudioData(): Promise<AudioBuffer> {
    return Promise.resolve(WAV);
  }

  createOscillator() {
    this.oscillators.push(this.oscillators.length);
    return {
      type: "sine",
      frequency: {
        setValueAtTime: (): void => {},
        linearRampToValueAtTime: (): void => {},
      },
      connect: (): void => {},
      disconnect: (): void => {},
      start: (): void => {},
      stop: (): void => {},
    };
  }

  createGain() {
    return {
      gain: {
        setValueAtTime: (): void => {},
        exponentialRampToValueAtTime: (): void => {},
      },
      connect: (): void => {},
      disconnect: (): void => {},
    };
  }

  createBufferSource() {
    const source = {
      buffer: null as AudioBuffer | null,
      loop: false,
      connect: (): void => {},
      disconnect: (): void => {},
      start: (): void => {
        this.sources.push(source.buffer);
      },
      stop: (): void => {},
    };
    return source;
  }

  createPanner(): FakePanner {
    const panner = new FakePanner();
    this.panners.push(panner);
    return panner;
  }
}

/** The one context the engine built for this test. */
function graph(): FakeAudioContext {
  const context = FakeAudioContext.built[0];
  if (context === undefined) throw new Error("no audio context was opened");
  return context;
}

/* -------------------------------------------------------------------------- */
/* src/constants.ts — verbatim                                                */
/* -------------------------------------------------------------------------- */

const LEVEL = "vault";

const PATH = {
  coin: "models/coin.glb",
  floor: "textures/floor.png",
  sound: "audio/collect.wav",
  banner: "sprites/banner.png",
};

const CUE = { collect: "collect", blip: "blip" } as const;

const COIN = {
  tag: "coin",
  animation: "spin",
  spots: [vec3(-3, 0.5, 0), vec3(0, 0.5, -2), vec3(3, 0.5, 0)],
};

const CAMERA = { position: vec3(0, 6, 9), target: vec3(0, 0, 0) };

/* -------------------------------------------------------------------------- */
/* src/instance.ts — verbatim                                                 */
/* -------------------------------------------------------------------------- */

let built: VaultInstance | null = null;

/** The instance the engine built, reachable from the level's own modules. */
function instance(): VaultInstance {
  if (built === null) throw new Error("the game instance is not built yet");
  return built;
}

class VaultInstance extends GameInstance<null> {
  coin: Model | null = null;
  floor: THREE.Texture | null = null;
  notice: string | null = null;

  constructor() {
    super();
    built = this;
  }

  override initialize(api: InitApi): null {
    api.audio.define(CUE.blip, {
      wave: "square",
      freq: 660,
      freqTo: 990,
      gain: 0.2,
      durationMs: 90,
    });

    api.events.on("asset:failed", (event) => {
      this.notice = `${event.path} unavailable: ${event.reason}`;
    });
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* src/levels/vault-mode.ts — verbatim                                        */
/* -------------------------------------------------------------------------- */

class VaultMode extends GameMode {
  override beginPlay(): void {
    const camera = this.world.camera;
    camera.position = CAMERA.position;
    camera.lookAt(CAMERA.target);

    this.world.every(1.2, () => this.take());
    this.setPhase("playing");
  }

  private take(): void {
    const coins = this.world.byTag(COIN.tag);
    const coin = coins[0];
    if (coin === undefined) return;

    coin.destroy();
    this.world.audio.play(CUE.collect, { at: coin.transform.position });
    if (coins.length === 1) {
      this.world.audio.play(CUE.blip);
      this.setPhase("over");
    }
  }
}

/* -------------------------------------------------------------------------- */
/* src/game.ts — verbatim                                                     */
/* -------------------------------------------------------------------------- */

const lights = {
  type: Actor,
  transform: { rotation: quatLookAt(vec3(-0.5, -1, -0.3)) },
  configure: (actor: Actor) => {
    actor.attach(
      new LightComponent({ light: { kind: "hemisphere", intensity: 0.5 } }),
    );
    actor.attach(
      new LightComponent({ light: { kind: "directional", intensity: 2 } }),
    );
  },
};

const floor = {
  type: Actor,
  transform: { rotation: quatFromAxisAngle(RIGHT, -Math.PI / 2) },
  configure: (actor: Actor) => {
    const map = instance().floor;
    actor.attach(
      new MeshComponent({
        geometry: { kind: "plane", width: 12, height: 8 },
        material: map === null ? { color: "#1c2230" } : { map, roughness: 1 },
      }),
    );
  },
};

const coins = COIN.spots.map((spot) => ({
  type: Actor,
  transform: { position: spot },
  tags: [COIN.tag],
  configure: (actor: Actor) => {
    const model = instance().coin;
    if (model === null) return;
    actor.attach(new ModelComponent({ model, animation: COIN.animation }));
  },
}));

const notice = {
  type: Actor,
  transform: { position: vec3(320, 40, 0) },
  configure: (actor: Actor) => {
    const text = instance().notice;
    if (text === null) return;
    actor.attach(new TextComponent({ text, fill: "#ffb4a2" }));
  },
};

async function load(api: LoadApi): Promise<void> {
  const game = instance();
  const [coin, floorMap] = await Promise.all([
    api.assets.loadModel(PATH.coin),
    api.assets.loadTexture(PATH.floor),
    api.audio.load(CUE.collect, PATH.sound),
  ]);
  game.coin = coin;
  game.floor = floorMap;
  await api.assets.loadImage(PATH.banner).catch(() => null);
}

const vault: GameDefinition<null> = {
  instance: VaultInstance,
  levels: {
    [LEVEL]: {
      mode: VaultMode,
      load,
      actors: [lights, floor, ...coins, notice],
    },
  },
  startLevel: LEVEL,
};

/* -------------------------------------------------------------------------- */
/* src/main.ts — adapted only where the environment forces it                 */
/* -------------------------------------------------------------------------- */

interface Booted {
  engine: Engine<null>;
  /** The stage and screen canvases, and the surface the engine listens on. */
  stage: Stage;
  /** What main.ts's own `asset:failed` subscription would have warned. */
  warned: string[];
}

let fetcher: ReturnType<typeof vi.fn>;
let engines: Engine<null>[];

beforeEach(() => {
  // The example's module accessor is module state, and every `boot` builds a
  // new instance into it; clearing it first is what makes "the instance exists
  // by now" a claim about this test rather than about the previous one.
  built = null;
  FakeAudioContext.built.length = 0;
  fetcher = vi.fn(serve);
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() => Promise.resolve(FLOOR)),
  );
  vi.stubGlobal("AudioContext", FakeAudioContext);
  engines = [];
});

afterEach(() => {
  for (const engine of engines) engine.destroy();
  vi.unstubAllGlobals();
});

/**
 * main.ts, line for line where the environment allows: the engine is created
 * over the example's own options, `asset:failed` is subscribed before
 * `initialize`, and `initialize` is awaited. `run` is replaced by the scripted
 * clock and `advance`, and `before` runs between construction and
 * initialization — exactly where the page says a subscription is in place
 * before the instance is built and before the start level loads anything.
 *
 * The stage is 320x180 CSS pixels at a device pixel ratio of 2, so its backing
 * store is the 640x360 design field exactly and the screen layer's logical
 * units are its device pixels: a notice at logical `(320, 40)` is drawn at
 * `(320, 40)`.
 */
async function boot(before?: (engine: Engine<null>) => void): Promise<Booted> {
  const stage = createStage({ cssWidth: 320, cssHeight: 180, dpr: 2 });

  const engine = createEngine({
    canvas: stage.stage.canvas,
    screen: stage.screen.canvas,
    width: 640,
    height: 360,
    background: "#05060a",
    game: vault,
    clock: new ConstantClock(100),
    surface: stage.surface.surface,
  });
  engines.push(engine);

  const warned: string[] = [];
  engine.events.on("asset:failed", (event) => {
    warned.push(`asset failed: ${event.path} (${event.reason})`);
  });

  before?.(engine);
  await engine.initialize();
  return { engine, stage, warned };
}

/** The one actor of the built world carrying a component of this kind. */
function actorWith<C extends { new (...args: never[]): object }>(
  engine: Engine<null>,
  type: C,
): Actor {
  const found = engine.world
    .actors()
    .find((actor) => actor.component(type as never) !== null);
  if (found === undefined) {
    throw new Error(`no actor carries a ${type.name}`);
  }
  return found;
}

/** The `ModelComponent` on each coin, in spawn order. */
function coinModels(engine: Engine<null>): ModelComponent[] {
  return engine.world.byTag(COIN.tag).map((actor) => {
    const component = actor.component(ModelComponent);
    if (component === null) throw new Error("a coin carries no ModelComponent");
    return component;
  });
}

/* -------------------------------------------------------------------------- */
/* The outcomes the page narrates                                             */
/* -------------------------------------------------------------------------- */

type Announced =
  | { event: "loaded"; payload: EngineEventMap["asset:loaded"] }
  | { event: "failed"; payload: EngineEventMap["asset:failed"] };

describe("the audio-and-assets example", () => {
  it("loads the level's files under the asset root and reports the missing banner, one event per call", async () => {
    const announced: Announced[] = [];
    const { warned } = await boot((engine) => {
      // Construction performed no loading and ran no game code: nothing has
      // been fetched, and no instance exists for the accessor to hand back.
      expect(fetcher).not.toHaveBeenCalled();
      expect(() => instance()).toThrow(/not built yet/);
      engine.events.on("asset:loaded", (payload) =>
        announced.push({ event: "loaded", payload }),
      );
      engine.events.on("asset:failed", (payload) =>
        announced.push({ event: "failed", payload }),
      );
    });

    // Every path resolved under the default root, in the order `load` named
    // them; the banner only after the three the level waits on.
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      "assets/models/coin.glb",
      "assets/textures/floor.png",
      "assets/audio/collect.wav",
      "assets/sprites/banner.png",
    ]);

    // Exactly one event per loader call: three arrivals, then the one failure,
    // the failure carrying the resolved URL and the reason as well.
    expect(announced).toHaveLength(4);
    expect(announced.slice(0, 3)).toEqual(
      expect.arrayContaining([
        {
          event: "loaded",
          payload: { path: PATH.coin, url: "assets/models/coin.glb" },
        },
        {
          event: "loaded",
          payload: { path: PATH.floor, url: "assets/textures/floor.png" },
        },
        {
          event: "loaded",
          payload: { path: PATH.sound, url: "assets/audio/collect.wav" },
        },
      ]),
    );
    expect(announced[3]).toEqual({
      event: "failed",
      payload: {
        path: PATH.banner,
        url: "assets/sprites/banner.png",
        reason: expect.stringContaining("404"),
      },
    });

    // main.ts's own subscription, in place before the level loaded anything.
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatch(/^asset failed: sprites\/banner\.png \(/);
    expect(warned[0]).toContain("404");

    // The instance holds what the level filled: the decoded model, the texture
    // itself, and the notice its own handler wrote from the failure.
    expect(instance().coin?.animations.map((clip) => clip.name)).toEqual([
      COIN.animation,
    ]);
    expect(instance().floor).toBeInstanceOf(THREE.Texture);
    expect(instance().floor?.image).toBe(FLOOR);
    expect(instance().notice).toMatch(/^sprites\/banner\.png unavailable: /);
    expect(instance().notice).toContain("404");
  });

  it("builds the instance and runs its initialize before the start level loads anything", async () => {
    const opening: Array<{ from: string | null; to: string; fetched: number }> =
      [];
    const { engine } = await boot((booting) => {
      booting.events.on("world:opening", (event) => {
        // `instance()` throws until the constructor has recorded one, so
        // reaching it here is the assertion that the instance already exists —
        // and its `initialize` has run, since the engine awaits it before it
        // opens the start level.
        opening.push({
          from: event.from,
          to: event.to,
          fetched: fetcher.mock.calls.length,
        });
        expect(instance().notice).toBeNull();
      });
    });

    expect(opening).toEqual([{ from: null, to: LEVEL, fetched: 0 }]);

    // "A cue defined here belongs to the engine rather than to a world": the
    // start level declared no `blip`, and the world it built plays one anyway,
    // at the gain the instance's spec gave. A name nothing declared is a typo
    // in the build, and saying it throws.
    const played: EngineEventMap["cue:played"][] = [];
    engine.events.on("cue:played", (event) => played.push(event));
    engine.world.audio.play(CUE.blip);
    expect(played).toEqual([
      { cue: CUE.blip, t: expect.any(Number), gain: 0.2, at: null },
    ]);
    expect(() => engine.world.audio.play("chime")).toThrow(/chime/);
  });

  it("lays the floor flat facing +Y with the loaded texture as its material's map", async () => {
    const { engine } = await boot();
    const actor = actorWith(engine, MeshComponent);
    const mesh = actor.component(MeshComponent);

    // "The texture goes onto a `MaterialSpec` as its `map`."
    expect(mesh?.material.map).toBe(instance().floor);
    expect(mesh?.material.roughness).toBe(1);
    expect(mesh?.geometry).toEqual({ kind: "plane", width: 12, height: 8 });

    // "the plane it covers lies in its local `XY` plane facing `+Z`, and a
    // quarter turn about `RIGHT` lays it flat facing `+Y`."
    const facing = quatRotate(actor.transform.rotation, vec3(0, 0, 1));
    expect(facing.x).toBeCloseTo(0, 10);
    expect(facing.y).toBeCloseTo(1, 10);
    expect(facing.z).toBeCloseTo(0, 10);
  });

  it("gives each of the three coins its own clone of one loaded model, spinning from its first frame", async () => {
    const { engine } = await boot();
    const placed = engine.world.byTag(COIN.tag);
    expect(placed).toHaveLength(3);
    expect(placed.map((coin) => coin.transform.position)).toEqual(COIN.spots);

    const models = coinModels(engine);

    // "Three coins share one loaded model": one `Model`, by identity, for all
    // three, and the one the instance holds.
    for (const component of models) {
      expect(component.model).toBe(instance().coin);
      // "plays the named clip looping from its first frame."
      expect(component.animation()).toBe(COIN.animation);
      expect(component.time).toBe(0);
    }

    await engine.advance(1);

    // "which clones the model's `scene` on construction": the pipeline placed
    // three separate trees, none of them the template itself.
    const bodies: THREE.Object3D[] = [];
    engine.scene.traverse((object) => {
      if (object.name === "coin-body") bodies.push(object);
    });
    expect(bodies).toHaveLength(3);
    expect(new Set(bodies).size).toBe(3);
    const template = instance().coin?.scene;
    expect(template?.parent).toBeNull();
    for (const body_ of bodies) expect(body_).not.toBe(template);

    // "and each animates on its own": the frame advanced every clip by the
    // world's delta, and seeking one leaves the other two where they were.
    expect(models.map((component) => component.time)).toEqual([0.1, 0.1, 0.1]);

    const [first, second, third] = models;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("three coins were expected");
    }
    first.time = 0.5;
    await engine.advance(1);
    expect(first.time).toBeCloseTo(0.6, 10);
    expect(second.time).toBeCloseTo(0.2, 10);
    expect(third.time).toBeCloseTo(0.2, 10);
  });

  it("reports the failed load on screen as a screen-space notice at its logical point", async () => {
    const { engine, stage } = await boot();
    const actor = actorWith(engine, TextComponent);
    const text = actor.component(TextComponent);

    // "The notice is a `TextComponent`, a screen-space component."
    expect(text?.space).toBe("screen");
    expect(text?.text).toBe(instance().notice);
    expect(text?.fill).toBe("#ffb4a2");

    await engine.advance(1);

    // "its position is logical units from the top-left of the design field" —
    // the design field is the screen canvas's backing store here, so the draw
    // lands on the numbers the spec gave. "Its `z` plays no part in the screen
    // pass", and there is none in the two coordinates the draw carries.
    const drawn = stage.screen.context2d.opsOf("fillText");
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.args).toEqual([instance().notice, 320, 40]);
    expect(drawn[0]?.fill).toBe("#ffb4a2");
  });

  it("poses the world's camera in beginPlay, looking from its position toward the target", async () => {
    const { engine } = await boot();
    const camera = engine.world.camera;

    expect(camera.position).toEqual(CAMERA.position);

    // "`lookAt` writes the rotation that looks from `position` toward the
    // target with `+Y` up": the camera's own forward, `FORWARD` turned by its
    // rotation, is the direction from the camera to the target.
    const facing = quatRotate(camera.rotation, FORWARD);
    const wanted = normalize(sub(CAMERA.target, CAMERA.position));
    expect(facing.x).toBeCloseTo(wanted.x, 10);
    expect(facing.y).toBeCloseTo(wanted.y, 10);
    expect(facing.z).toBeCloseTo(wanted.z, 10);

    // The camera "starts at its defaults on every transition", which is why the
    // mode poses it rather than the level declaring it.
    expect(engine.world.mode.phase).toBe("playing");
  });

  it("collects a coin every 1.2 seconds of simulated time, playing both kinds of cue", async () => {
    const played: EngineEventMap["cue:played"][] = [];
    const phases: string[] = [];
    const { engine } = await boot((booting) => {
      booting.events.on("cue:played", (event) => played.push(event));
      booting.events.on("match:phase", ({ phase }) => phases.push(phase));
    });

    // Four seconds under a 100 ms scripted clock: collections at 1.2, 2.4, and
    // 3.6 seconds, the last one also playing the blip and ending the match.
    await engine.advance(40);

    expect(played.map((event) => event.cue)).toEqual([
      CUE.collect,
      CUE.collect,
      CUE.collect,
      CUE.blip,
    ]);
    // "The gain reported is the cue's own, before any distance attenuation": a
    // file-backed cue reports unity gain and the synthesized blip its spec's,
    // even though the three coins stood at three different distances.
    expect(played.map((event) => event.gain)).toEqual([1, 1, 1, 0.2]);

    // "The timer runs on simulated world time, so a scripted clock collects at
    // the same rate": each instant is the stated period within one step.
    const bands: Array<[number, number]> = [
      [1200, 1300],
      [2400, 2500],
      [3600, 3700],
    ];
    for (const [index, [from, to]] of bands.entries()) {
      expect(played[index]?.t).toBeGreaterThanOrEqual(from);
      expect(played[index]?.t).toBeLessThanOrEqual(to);
    }
    // The blip plays in the same frame as the last collection.
    expect(played[3]?.t).toBe(played[2]?.t);

    expect(engine.world.byTag(COIN.tag)).toHaveLength(0);
    expect(engine.world.mode.phase).toBe("over");
    expect(phases).toEqual(["playing", "over"]);
  });

  it("carries the world point each collect was played at, as a copy, and none for the blip", async () => {
    const played: EngineEventMap["cue:played"][] = [];
    const { engine } = await boot((booting) => {
      booting.events.on("cue:played", (event) => played.push(event));
    });

    // The points the coins stood at, held before the match destroys them.
    const stood = engine.world
      .byTag(COIN.tag)
      .map((coin) => coin.transform.position);

    await engine.advance(40);

    // "A check that the collect cue sounded where the coin stood reads that
    // field", and the field is "the world point the call gave, as a copy".
    expect(played.slice(0, 3).map((event) => event.at)).toEqual(COIN.spots);
    for (const [index, point] of stood.entries()) {
      expect(played[index]?.at).not.toBe(point);
    }

    // "A cue played without `at`, as `blip` is, is unpositioned."
    expect(played[3]?.at).toBeNull();
  });

  it("routes a positioned cue through a panner, heard from the camera as it last rendered", async () => {
    const { engine, stage } = await boot();

    // "The engine opens the audio context on the first pointer or key event it
    // sees" — nothing below this line sounds until it has.
    stage.surface.target.dispatchEvent(new Event("pointerdown"));

    await engine.advance(40);

    const context = graph();

    // One panner per positioned play, standing where each coin stood; the
    // unpositioned blip built none.
    expect(context.panners).toHaveLength(3);
    expect(context.panners.map(positionOf)).toEqual(COIN.spots);
    for (const panner of context.panners) {
      expect(panner.panningModel).toBe("HRTF");
      expect(panner.distanceModel).toBe("inverse");
      expect(panner.refDistance).toBe(1);
      expect(panner.rolloffFactor).toBe(1);
      expect(panner.maxDistance).toBe(10000);
    }

    // "heard from the camera as it stood at the most recent render": the
    // listener sits at the pose `beginPlay` gave the camera, facing the target.
    const ear = positionOf(context.listener);
    expect(ear.x).toBeCloseTo(CAMERA.position.x, 10);
    expect(ear.y).toBeCloseTo(CAMERA.position.y, 10);
    expect(ear.z).toBeCloseTo(CAMERA.position.z, 10);

    // "so the coin on the left sounds from the left and the far coin sounds
    // quieter than the near ones" — read off the panners themselves, against
    // the ear, rather than off the constants they were placed from.
    const [left, far, right] = context.panners.map(positionOf);
    if (left === undefined || far === undefined || right === undefined) {
      throw new Error("three panners were expected");
    }
    expect(left.x).toBeLessThan(ear.x);
    expect(right.x).toBeGreaterThan(ear.x);
    expect(distance(ear, far)).toBeGreaterThan(distance(ear, left));
    expect(distance(ear, far)).toBeGreaterThan(distance(ear, right));

    // "as it stood at the most recent render": the ear is written from the
    // camera every frame, so moving the camera moves where the world is heard
    // from without the game touching the listener.
    engine.world.camera.position = vec3(-8, 1, 0);
    await engine.advance(1);
    const moved = positionOf(graph().listener);
    expect(moved.x).toBeCloseTo(-8, 10);
    expect(moved.y).toBeCloseTo(1, 10);
    expect(moved.z).toBeCloseTo(0, 10);
  });

  it("emits a muted play at gain zero, and loops and stops either kind of cue once each", async () => {
    const { engine } = await boot();
    const world = engine.world;
    const events: Array<{ event: string; cue: string; gain?: number }> = [];
    engine.events.on("cue:played", ({ cue, gain }) =>
      events.push({ event: "played", cue, gain }),
    );
    engine.events.on("cue:looped", ({ cue, gain }) =>
      events.push({ event: "looped", cue, gain }),
    );
    engine.events.on("cue:stopped", ({ cue }) =>
      events.push({ event: "stopped", cue }),
    );

    // "`world.audio.setMuted` sets the mute bit and `world.audio.muted()`
    // reports it", and "a play on a muted bus reports that event with
    // `gain: 0`".
    world.audio.setMuted(true);
    expect(world.audio.muted()).toBe(true);
    world.audio.play(CUE.collect);
    expect(events).toEqual([{ event: "played", cue: CUE.collect, gain: 0 }]);
    world.audio.setMuted(false);
    expect(world.audio.muted()).toBe(false);

    // "Either kind is looped by name through `world.audio.loop` and ended
    // through `world.audio.stop`, which emit `cue:looped` and `cue:stopped`
    // once each" — a repeated request in either direction announces nothing.
    events.length = 0;
    world.audio.loop(CUE.collect);
    world.audio.loop(CUE.blip);
    world.audio.loop(CUE.collect);
    world.audio.stop(CUE.collect);
    world.audio.stop(CUE.blip);
    world.audio.stop(CUE.collect);
    expect(events).toEqual([
      { event: "looped", cue: CUE.collect, gain: 1 },
      { event: "looped", cue: CUE.blip, gain: 0.2 },
      { event: "stopped", cue: CUE.collect },
      { event: "stopped", cue: CUE.blip },
    ]);
  });

  it("opens the audio context on the first pointer or key event, announcing the unlock once", async () => {
    let unlocks = 0;
    const { stage } = await boot((engine) => {
      engine.events.on("audio:unlocked", () => {
        unlocks += 1;
      });
    });

    expect(unlocks).toBe(0);
    stage.surface.target.dispatchEvent(new Event("pointerdown"));
    stage.surface.target.dispatchEvent(new Event("pointerdown"));
    stage.surface.target.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyA" }),
    );
    expect(unlocks).toBe(1);
  });

  it("fails a refused path with an empty URL, and a missing file with the resolved one", async () => {
    const { engine } = await boot();
    const failures: EngineEventMap["asset:failed"][] = [];
    engine.events.on("asset:failed", (payload) => failures.push(payload));

    await expect(engine.world.assets.load("../outside.png")).rejects.toThrow(
      /escapes the asset root/,
    );
    await expect(engine.world.assets.load(PATH.banner)).rejects.toThrow(/404/);

    expect(failures).toEqual([
      {
        path: "../outside.png",
        url: "",
        reason: expect.stringContaining("escapes the asset root"),
      },
      {
        path: PATH.banner,
        url: "assets/sprites/banner.png",
        reason: expect.stringContaining("404"),
      },
    ]);
  });

  it("resolves a model whose texture did not decode, with that material's map unset", async () => {
    // three fetches a glTF's side files itself and logs the failure; the load
    // is still a success, which is the claim.
    const complaint = vi.spyOn(console, "error").mockImplementation(() => {});
    const { engine } = await boot();
    const announced: Announced[] = [];
    engine.events.on("asset:loaded", (payload) =>
      announced.push({ event: "loaded", payload }),
    );
    engine.events.on("asset:failed", (payload) =>
      announced.push({ event: "failed", payload }),
    );

    // "A model whose file decodes and whose texture does not is a value that
    // arrived: the load resolves and the material affected has no `map`."
    const model = await engine.world.assets.loadModel("models/painted.glb");

    const body_ = model.scene.getObjectByName("coin-body") as THREE.Mesh;
    expect((body_.material as THREE.MeshStandardMaterial).map).toBeNull();
    expect(model.animations.map((clip) => clip.name)).toEqual([COIN.animation]);
    expect(announced).toEqual([
      {
        event: "loaded",
        payload: {
          path: "models/painted.glb",
          url: "assets/models/painted.glb",
        },
      },
    ]);
    complaint.mockRestore();
  });

  it("plays the coin's clip looping, so its time wraps at the clip's end", async () => {
    const { engine } = await boot();
    const [coin] = coinModels(engine);
    if (coin === undefined) throw new Error("a coin was expected");

    // The clip the hand-built `.glb` carries is one second long, which is what
    // makes the wrap observable inside the first collection's 1.2 seconds.
    expect(instance().coin?.animations[0]?.duration).toBe(1);

    await engine.advance(11);

    // "plays the named clip looping from its first frame": eleven tenths of a
    // second into a one-second clip is a tenth of a second into its second
    // pass, not eleven tenths into a clip that ran out.
    expect(coin.animation()).toBe(COIN.animation);
    expect(coin.time).toBeCloseTo(0.1, 6);
  });

  it("carries the instance and its engine-owned cue across a transition", async () => {
    const played: EngineEventMap["cue:played"][] = [];
    const { engine } = await boot((booting) => {
      booting.events.on("cue:played", (event) => played.push(event));
    });
    const first = engine.world;
    const game = instance();
    const loadedOnce = fetcher.mock.calls.length;

    // A transition is requested from a tick and deferred to the end of the
    // frame, and the engine awaits the new level's `load` before the frame
    // renders, so one step is the whole transition.
    engine.world.open(LEVEL);
    await engine.advance(1);

    // The world is new — its own actors, built from the level's own `load`
    // running again — and the four files are fetched a second time.
    expect(engine.world).not.toBe(first);
    expect(engine.world.level).toBe(LEVEL);
    expect(engine.world.byTag(COIN.tag)).toHaveLength(3);
    expect(fetcher.mock.calls.length).toBe(loadedOnce * 2);

    // The instance is not: "`initialize` runs once, before the start level
    // opens", so the accessor still hands back the object the constructor
    // recorded, holding everything the level filled.
    expect(instance()).toBe(game);
    expect(instance().coin).not.toBeNull();
    expect(instance().notice).not.toBeNull();

    // "so `blip` is playable from every level and survives every transition."
    played.length = 0;
    engine.world.audio.play(CUE.blip);
    expect(played.map((event) => [event.cue, event.gain])).toEqual([
      [CUE.blip, 0.2],
    ]);
  });

  it("stops a running loop when the next level's load rebinds the cue it was sounding", async () => {
    const events: Array<{ event: string; cue: string }> = [];
    const { engine } = await boot((booting) => {
      booting.events.on("cue:looped", ({ cue }) =>
        events.push({ event: "looped", cue }),
      );
      booting.events.on("cue:stopped", ({ cue }) =>
        events.push({ event: "stopped", cue }),
      );
    });

    engine.world.audio.loop(CUE.collect);
    engine.world.audio.loop(CUE.blip);
    expect(engine.world.audio.looping(CUE.collect)).toBe(true);

    engine.world.open(LEVEL);
    await engine.advance(1);

    // "A cue name carries one source, and declaring a name that already exists
    // replaces what it plays": the reopened level's `load` binds `collect` to a
    // freshly decoded file, and the loop that was sounding the cue it replaced
    // ends, announced once. `blip`, which no level declares, is untouched and
    // still looping in the new world.
    expect(events).toEqual([
      { event: "looped", cue: CUE.collect },
      { event: "looped", cue: CUE.blip },
      { event: "stopped", cue: CUE.collect },
    ]);
    expect(engine.world.audio.looping(CUE.collect)).toBe(false);
    expect(engine.world.audio.looping(CUE.blip)).toBe(true);
  });

  it("holds the notice's place on the canvas whatever the camera does", async () => {
    const { engine, stage } = await boot();
    await engine.advance(1);
    const first = stage.screen.context2d.opsOf("fillText")[0];
    expect(first?.args).toEqual([instance().notice, 320, 40]);

    // The notice is drawn "through the viewport alone", so a camera that has
    // moved and turned changes nothing about where the text lands.
    engine.world.camera.position = vec3(-40, 2, 12);
    engine.world.camera.lookAt(vec3(9, -3, -5));
    stage.screen.context2d.forget();
    await engine.advance(1);

    const again = stage.screen.context2d.opsOf("fillText");
    expect(again).toHaveLength(1);
    expect(again[0]?.args).toEqual(first?.args);
  });

  it("fails a fetch that never answered, and a body that will not decode, each with the resolved URL", async () => {
    const { engine } = await boot();
    const failures: EngineEventMap["asset:failed"][] = [];
    engine.events.on("asset:failed", (payload) => failures.push(payload));

    // "a failed fetch, and a body that will not decode each fail with the
    // resolved URL" — the first request is refused outright, and the second
    // arrives as bytes that are not a glTF container.
    await expect(
      engine.world.assets.loadImage("models/gold.png"),
    ).rejects.toThrow(/no such image/);
    await expect(engine.world.assets.loadModel(PATH.floor)).rejects.toThrow();

    expect(failures.map((event) => [event.path, event.url])).toEqual([
      ["models/gold.png", "assets/models/gold.png"],
      [PATH.floor, "assets/textures/floor.png"],
    ]);
    expect(failures[0]?.reason).toContain("no such image");
    expect(failures[1]?.reason).not.toBe("");
  });
});
