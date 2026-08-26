import { deflateSync } from "node:zlib";
import { createCanvas } from "@test-cabinet/headless-webgl2";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConstantClock, createEngine, quatFromAxisAngle } from "./index";
import type {
  CameraState,
  DrawValue,
  Engine,
  Game,
  InitApi,
  LightState,
  MeshHandle,
  Quat,
  Recording,
  RenderApi,
  SurfaceMetrics,
  TextureHandle,
  Transform,
  UpdateApi,
  Vec3,
} from "./index";
import type { DeepReadonly } from "ts-essentials";

/**
 * The documentation's worked example "Audio and Assets", transcribed and run.
 *
 * The page promises its code works against the engine verbatim, so `src/game.ts`
 * below — the constants, the camera, the lights, and the `skiff` definition — is
 * copied from the page unchanged, and the boot module's subscription order is
 * followed. Only what a test environment forces is adapted:
 *
 * - The page's `assets/` directory is a directory on disk served over HTTP.
 *   Here it is a route table installed as `globalThis.fetch`, which is exactly
 *   what the validator docs prescribe: "a suite whose build loads assets
 *   installs a `fetch` that serves the seeded asset directory from disk". The
 *   two files the page says the workspace holds are served; `textures/beacon.png`,
 *   which the page says it does not hold, is answered 404.
 * - The canvas is `@test-cabinet/headless-webgl2`'s, the element size arrives
 *   through an injected `SurfaceMetrics` at a fraction of the design size
 *   (rasterizer cost is per device pixel and nothing here reads one), and frames
 *   are stepped with `engine.advance` over a `ConstantClock` rather than driven
 *   from the host's frame callback.
 * - `window.addEventListener("pagehide", ...)` has no counterpart in Node; the
 *   abort controller it arms is exercised directly instead.
 *
 * The assertions are the outcomes the page narrates: a state with everything
 * present, an optional load turned into a value, the two kinds of cue, both
 * edges consumed in one frame, the wall cue firing once on the transition, and
 * the failed load reaching both the game's own handler and the caller's.
 */

/* -------------------------------------------------------------------------- */
/* src/game.ts — transcribed verbatim                                         */
/* -------------------------------------------------------------------------- */

const SPEED = 6;
const WALL = 7;

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ONE: Vec3 = { x: 1, y: 1, z: 1 };

const CAMERA: CameraState = {
  position: { x: 0, y: 6, z: 14 },
  rotation: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -0.35),
  fovY: Math.PI / 3,
  near: 0.1,
  far: 100,
};

const LIGHTS: readonly LightState[] = [
  { type: "ambient", color: "#ffffff", intensity: 0.35 },
  {
    type: "directional",
    color: "#ffffff",
    intensity: 0.9,
    direction: { x: -0.5, y: -1, z: -0.5 },
  },
];

function at(x: number, y: number, z: number): Transform {
  return { position: { x, y, z }, rotation: IDENTITY, scale: ONE };
}

export interface SkiffState {
  readonly ship: MeshHandle;
  readonly half: number;
  readonly beacon: TextureHandle | null;
  readonly notice: string | null;
  readonly x: number;
  readonly againstWall: boolean;
}

export const skiff: Game<SkiffState, null> = {
  async initialize(api: InitApi<SkiffState>): Promise<[SkiffState, null]> {
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

    const [ship] = await Promise.all([
      api.assets.loadMesh("meshes/skiff.glb"),
      api.audio.load("impact", "audio/impact.wav"),
    ]);

    const beacon = await api.assets
      .loadTexture("textures/beacon.png")
      .catch(() => null);
    off();

    const state: SkiffState = {
      ship,
      half: (ship.bounds.max.x - ship.bounds.min.x) / 2,
      beacon,
      notice: failed[0] ?? null,
      x: 0,
      againstWall: false,
    };
    return [state, null];
  },

  update(
    state: DeepReadonly<SkiffState>,
    api: UpdateApi,
    dt: number,
  ): SkiffState {
    if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());

    const startedLeft = api.input.pressed("left");
    const startedRight = api.input.pressed("right");
    if (startedLeft || startedRight) api.audio.play("thrust");

    const steer = api.input.value("right") - api.input.value("left");
    const limit = WALL - state.half;
    const moved = state.x + steer * SPEED * dt;
    const clamped = Math.min(Math.max(moved, -limit), limit);
    const againstWall = clamped !== moved;

    if (againstWall && !state.againstWall) api.audio.play("impact");
    return { ...state, x: clamped, againstWall };
  },

  render(state: DeepReadonly<SkiffState>, api: RenderApi): void {
    const { scene } = api;
    scene.setCamera(CAMERA);
    scene.setLights(LIGHTS);

    scene.drawGeometry(scene.createPlane(18, 10), "#182231", at(0, 0, 0));
    const wall = scene.createBox({ x: 0.5, y: 1.5, z: 10 });
    scene.drawGeometry(wall, "#31405a", at(-7.25, 0.75, 0));
    scene.drawGeometry(wall, "#31405a", at(7.25, 0.75, 0));

    scene.drawMesh(state.ship, at(state.x, 0.5, 0));

    if (state.beacon !== null) {
      scene.drawBillboard(
        state.beacon,
        { x: 0, y: 3.5, z: -3 },
        { x: 2, y: 2 },
      );
    }

    if (state.notice !== null) {
      scene.drawHudText(
        state.notice,
        { x: 16, y: 14 },
        {
          size: 14,
          color: "#ffb4a2",
        },
      );
    }
  },
};

/* -------------------------------------------------------------------------- */
/* assets/ — the seeded directory, served in process                          */
/* -------------------------------------------------------------------------- */

/**
 * The `.glb` at `assets/meshes/skiff.glb`: a hull two world units across in
 * `x`, so `(bounds.max.x - bounds.min.x) / 2` is the `half` the build reads
 * off it and the wall clamp lands at `WALL - 1`.
 */
function skiffGlb(): Uint8Array {
  const positions = Float32Array.from([-1, 0, -2, 1, 0, -2, 1, 0, 2, -1, 0, 2]);
  const indices = Uint16Array.from([0, 1, 2, 0, 2, 3]);
  const bin = new Uint8Array(positions.byteLength + indices.byteLength);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(indices.buffer), positions.byteLength);

  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "hull", mesh: 0 }],
    meshes: [
      {
        primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
      },
    ],
    materials: [
      { pbrMetallicRoughness: { baseColorFactor: [0.7, 0.8, 1, 1] } },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 4,
        type: "VEC3",
        min: [-1, 0, -2],
        max: [1, 0, 2],
      },
      { bufferView: 1, componentType: 5123, count: 6, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      {
        buffer: 0,
        byteOffset: positions.byteLength,
        byteLength: indices.byteLength,
      },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (text.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + text.length + jsonPad + 8 + bin.length + binPad;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // glTF
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, text.length + jsonPad, true);
  view.setUint32(16, 0x4e4f534a, true); // JSON
  out.set(text, 20);
  for (let i = 0; i < jsonPad; i += 1) out[20 + text.length + i] = 0x20;
  const binAt = 20 + text.length + jsonPad;
  view.setUint32(binAt, bin.length + binPad, true);
  view.setUint32(binAt + 4, 0x004e4942, true); // BIN\0
  out.set(bin, binAt + 8);
  return out;
}

/** The `.wav` at `assets/audio/impact.wav`: mono 16-bit PCM, as the tools produce. */
function impactWav(): Uint8Array {
  const samples = Array.from({ length: 128 }, (_, i) =>
    Math.round(Math.sin((i / 128) * Math.PI * 8) * 8_000),
  );
  const dataLength = samples.length * 2;
  const out = new Uint8Array(44 + dataLength);
  const view = new DataView(out.buffer);
  const tag = (offset: number, text: string): void => {
    for (let i = 0; i < 4; i += 1) out[offset + i] = text.charCodeAt(i);
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // integer PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8_000, true);
  view.setUint32(28, 16_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, dataLength, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, sample, true));
  return out;
}

/**
 * The seeded asset directory, as routes under the default asset root. The
 * beacon is deliberately absent: "`textures/beacon.png` names a file this
 * workspace holds no copy of, which is the load the notice on screen reports."
 */
const DIRECTORY: Record<string, () => Uint8Array> = {
  "assets/meshes/skiff.glb": skiffGlb,
  "assets/audio/impact.wav": impactWav,
};

let realFetch: typeof globalThis.fetch;
/** Every URL the engine asked for, in order, so a check can count the fetches. */
let fetched: string[] = [];

beforeEach(() => {
  realFetch = globalThis.fetch;
  fetched = [];
  globalThis.fetch = ((input: unknown): Promise<Response> => {
    const url = String(input);
    fetched.push(url);
    const body = DIRECTORY[url];
    if (body === undefined)
      return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(new Response(body().slice() as unknown as BodyInit));
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const engine of built.splice(0)) engine.destroy();
});

/* -------------------------------------------------------------------------- */
/* index.html + src/main.ts — transcribed, with the forced adaptations        */
/* -------------------------------------------------------------------------- */

/** The element size the suite reports: the design aspect, scaled down. */
const CSS_WIDTH = 160;
const CSS_HEIGHT = 90;

/** Every engine a test built, destroyed after it whatever the test did. */
const built: Engine<SkiffState, null>[] = [];

interface Rig {
  readonly engine: Engine<SkiffState, null>;
  readonly events: EventTarget;
  /** What the caller's own `asset:failed` subscription saw, in order. */
  readonly warnings: string[];
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
}

/** The page's boot module, adapted only as the header describes. */
function boot(): Rig {
  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: (): number => CSS_WIDTH,
    cssHeight: (): number => CSS_HEIGHT,
    dpr: (): number => 1,
    events: (): EventTarget => events,
  };

  const engine = createEngine({
    canvas: createCanvas(CSS_WIDTH, CSS_HEIGHT) as unknown as HTMLCanvasElement,
    width: 640,
    height: 360,
    background: "#05060a",
    game: skiff,
    clock: new ConstantClock(1000 / 60),
    surface,
  });
  built.push(engine);

  // "The engine exists before any loading happens, so the subscription is in
  // place for the loads the game's own `initialize` performs."
  const warnings: string[] = [];
  engine.events.on("asset:failed", (event) => {
    warnings.push(`asset failed: ${event.path} (${event.reason})`);
  });

  const key = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(
      Object.assign(new Event(type), { code, repeat: false }),
    );
  };
  return {
    engine,
    events,
    warnings,
    hold: (code) => key("keydown", code),
    release: (code) => key("keyup", code),
    tap: (code) => {
      key("keydown", code);
      key("keyup", code);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The narrated outcomes                                                      */
/* -------------------------------------------------------------------------- */

/** The `call` operations of one method across a recording, in issue order. */
function callsTo(
  recording: Recording,
  method: string,
): readonly (readonly DrawValue[])[] {
  return recording.frames.flatMap((frame) =>
    frame.ops.flatMap((index) => {
      const op = recording.ops[index];
      return op !== undefined && op.op === "call" && op.method === method
        ? [op.args]
        : [];
    }),
  );
}

describe("examples/audio-and-assets", () => {
  it("returns a state with everything present once every load has resolved", async () => {
    const { engine } = boot();
    const opening = await engine.initialize();

    // "`initialize` returns once every load it awaited has resolved, so `ship`
    // is a `MeshHandle` and the `impact` cue is playable from the first frame."
    expect(opening.ship.path).toBe("meshes/skiff.glb");
    expect(opening.ship.nodes).toEqual(["hull"]);
    expect(opening.ship.bounds).toEqual({
      min: { x: -1, y: 0, z: -2 },
      max: { x: 1, y: 0, z: 2 },
    });

    // "`half` reads the ship's width off `ship.bounds` once so the clamp is
    // stated against the mesh the file carries."
    expect(opening.half).toBe(1);
    expect(opening.x).toBe(0);
    expect(opening.againstWall).toBe(false);
    expect(engine.debug).toBeNull();
  });

  it("turns the optional load into a value, and the failure into a notice", async () => {
    const { engine, warnings } = boot();
    const opening = await engine.initialize();

    // "`beacon` is optional to this build, so its load is turned into a value:
    // the texture when it arrives ... and `null` when it does not."
    expect(opening.beacon).toBeNull();

    // "the first reason is placed in the state that `initialize` returns."
    expect(opening.notice).toMatch(/^textures\/beacon\.png unavailable: /);

    // "The same event reaches any subscriber the caller attached to
    // `engine.events` before `initialize` ran."
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^asset failed: textures\/beacon\.png \(/);
  });

  it("announces each load once, at the URL the asset root resolved it to", async () => {
    const { engine } = boot();
    const loaded: { path: string; url: string }[] = [];
    const failed: { path: string; url: string; reason: string }[] = [];
    engine.events.on("asset:loaded", (event) => loaded.push(event));
    engine.events.on("asset:failed", (event) => failed.push(event));

    await engine.initialize();

    // "Every path a game names resolves under the asset root, which is
    // `assets/` relative to the page the build is served from." The `.wav`
    // travels the same route: `audio.load` binds a cue to a file under the root.
    expect(loaded.map((event) => event.path).sort()).toEqual([
      "audio/impact.wav",
      "meshes/skiff.glb",
    ]);
    expect(loaded.map((event) => event.url).sort()).toEqual([
      "assets/audio/impact.wav",
      "assets/meshes/skiff.glb",
    ]);
    expect(failed).toEqual([
      {
        path: "textures/beacon.png",
        url: "assets/textures/beacon.png",
        reason: expect.any(String),
      },
    ]);
    expect(fetched).toHaveLength(3);
  });

  it("plays the synthesized cue on the steer edge, consuming both reads", async () => {
    const rig = boot();
    const { engine } = rig;
    await engine.initialize();

    const played: { cue: string; t: number; gain: number }[] = [];
    engine.events.on("cue:played", (event) => played.push(event));

    // "Reading `left` and `right` into locals before the `||` keeps both edges
    // consumed, so a frame that starts two directions at once leaves nothing
    // armed for the next frame to replay."
    rig.hold("KeyA");
    rig.hold("KeyD");
    await engine.advance(2);

    expect(played.map((event) => event.cue)).toEqual(["thrust"]);
    // The declared gain, not the default: `define` fixed it at 0.25.
    expect(played[0]?.gain).toBe(0.25);
    // "`t` is the frame loop's simulated time": the first frame's own stamp.
    expect(played[0]?.t).toBeCloseTo(1000 / 60, 6);

    // Both directions held cancel, so nothing moved either.
    expect(engine.state.x).toBe(0);
  });

  it("plays the file-backed cue once, on the frame the skiff reaches the wall", async () => {
    const rig = boot();
    const { engine } = rig;
    await engine.initialize();

    const played: string[] = [];
    engine.events.on("cue:played", ({ cue }) => played.push(cue));

    // The limit is `WALL - half` = 6 world units, reached in one second at
    // `SPEED`; the latch on `againstWall` is what makes it one cue rather than
    // one per frame from then on.
    rig.hold("KeyD");
    await engine.advance(120);

    expect(engine.state.againstWall).toBe(true);
    expect(engine.state.x).toBeCloseTo(WALL - 1, 6);
    expect(played.filter((cue) => cue === "impact")).toEqual(["impact"]);
    expect(played.filter((cue) => cue === "thrust")).toEqual(["thrust"]);
  });

  it("mutes the bus live, and reports a muted cue with no gain", async () => {
    const rig = boot();
    const { engine } = rig;
    await engine.initialize();

    const gains: number[] = [];
    engine.events.on("cue:played", ({ gain }) => gains.push(gain));

    rig.tap("KeyM");
    await engine.advance(1);
    rig.hold("KeyD");
    await engine.advance(1);

    // "muted → `gain: 0`": the cue is still announced, and nothing sounds.
    expect(gains).toEqual([0]);

    rig.tap("KeyM");
    rig.release("KeyD");
    await engine.advance(1);
    rig.hold("KeyA");
    await engine.advance(1);
    expect(gains).toEqual([0, 0.25]);
  });

  it("draws the court, the ship, and the notice, and no billboard for a texture it never got", async () => {
    const { engine } = boot();
    await engine.initialize();

    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    // The two walls are one produced box drawn twice, so one resource entry
    // serves both — the pattern the page's own `const wall = ...` states.
    const boxes = recording.resources.filter(
      (r) => r.make.method === "createBox",
    );
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.make.args).toEqual([{ x: 0.5, y: 1.5, z: 10 }]);
    const walls = callsTo(recording, "drawGeometry").filter(
      (args) => args[1] === "#31405a",
    );
    expect(walls).toHaveLength(2);

    // The mesh rides as a captured asset rather than as a resource recipe.
    const meshes = callsTo(recording, "drawMesh");
    expect(meshes).toHaveLength(1);
    expect(meshes[0]?.[0]).toEqual({ $asset: 0 });
    expect(recording.assets[0]).toMatchObject({
      kind: "mesh",
      path: "meshes/skiff.glb",
    });

    // "the render's test is a question about the design rather than about
    // timing": no beacon, no billboard.
    expect(callsTo(recording, "drawBillboard")).toHaveLength(0);
    expect(callsTo(recording, "drawHudText")[0]).toEqual([
      engine.state.notice,
      { x: 16, y: 14 },
      { size: 14, color: "#ffb4a2" },
    ]);
  });

  it("draws the billboard when the texture does arrive", async () => {
    // The same build against a workspace that holds the file: the decision the
    // page describes is made during initialization, and the render follows it.
    DIRECTORY["assets/textures/beacon.png"] = beaconPng;
    try {
      const { engine, warnings } = boot();
      const opening = await engine.initialize();

      expect(opening.beacon).toMatchObject({
        path: "textures/beacon.png",
        width: 2,
        height: 2,
      });
      expect(opening.notice).toBeNull();
      expect(warnings).toEqual([]);

      engine.startRecording();
      await engine.advance(1);
      const recording = engine.stopRecording();

      const billboards = callsTo(recording, "drawBillboard");
      expect(billboards).toHaveLength(1);
      expect(billboards[0]?.slice(1)).toEqual([
        { x: 0, y: 3.5, z: -3 },
        { x: 2, y: 2 },
      ]);
      expect(callsTo(recording, "drawHudText")).toHaveLength(0);
    } finally {
      delete DIRECTORY["assets/textures/beacon.png"];
    }
  });

  it("halts the loop on the signal the page's controller aborts", async () => {
    const { engine } = boot();
    await engine.initialize();

    // `window.addEventListener("pagehide", ...)` has no counterpart here, so
    // the controller it arms is aborted directly. "The controller is how the
    // page halts the loop, and `destroy` runs once the loop has stopped."
    const controller = new AbortController();
    const running = engine.run({ signal: controller.signal });
    controller.abort();
    await expect(running).resolves.toBeUndefined();
    engine.destroy();
  });
});

/** A 2×2 PNG, for the run of the build whose workspace does hold the beacon. */
function beaconPng(): Uint8Array {
  const chunk = (type: string, data: readonly number[]): number[] => {
    const out = [
      (data.length >>> 24) & 255,
      (data.length >>> 16) & 255,
      (data.length >>> 8) & 255,
      data.length & 255,
      ...[...type].map((c) => c.charCodeAt(0)),
      ...data,
      0,
      0,
      0,
      0, // the decoder is handed a zeroed CRC, which it does not verify
    ];
    return out;
  };
  // Two rows of two RGBA pixels, each row prefixed by its filter byte.
  const raw = [
    0, 255, 180, 162, 255, 255, 180, 162, 255, 0, 255, 180, 162, 255, 255, 180,
    162, 255,
  ];
  const stored = [...deflateSync(Uint8Array.from(raw))];
  const ihdr = [0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0];
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", stored),
    ...chunk("IEND", []),
  ]);
}
