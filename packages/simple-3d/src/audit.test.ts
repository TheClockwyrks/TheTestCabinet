import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createCanvas } from "@test-cabinet/headless-webgl2";
import * as entry from "./index";
import {
  ConstantClock,
  JitterClock,
  PacedClock,
  RECORDING_FORMAT,
  SequenceClock,
  TOUCH_LAYOUTS,
  WallClock,
  createEngine,
  fitViewport,
  pointerRay,
  projectPoint,
  quatFromAxisAngle,
  quatMultiply,
  rotateVec3,
  syncCanvas,
  transformPoint,
  vec3Add,
  vec3Cross,
  vec3Dot,
  vec3Length,
  vec3Normalize,
  vec3Scale,
  vec3Sub,
} from "./index";
import type {
  ActionBinding,
  ActionKind,
  AudioState,
  Box3,
  CameraState,
  CapturedAsset,
  Clock,
  Color,
  CueSpec,
  DeepReadonly,
  DrawMeshOptions,
  DrawOp,
  DrawValue,
  Engine,
  EngineEventMap,
  EngineEvents,
  EngineOptions,
  FrameInfo,
  FrameMetrics,
  Game,
  Geometry,
  HudTextOptions,
  InitApi,
  LightState,
  Material,
  MaterialHandle,
  MaterialLike,
  MaterialMapSlot,
  MaterialSpec,
  MeshHandle,
  PacedClockOptions,
  PointerSample,
  PointerSampleType,
  PointerSnapshot,
  Quat,
  Ray,
  RecordedFrame,
  Recording,
  RegisteredAction,
  RenderApi,
  RenderMode,
  RenderState,
  Resource,
  ResourceOp,
  RunOptions,
  SceneContext,
  SurfaceMetrics,
  TextureHandle,
  TouchLayout,
  Transform,
  Transition,
  UpdateApi,
  Vec2,
  Vec3,
  Viewport,
} from "./index";
import { AssetLoader, registerTexture } from "./assets";
import { Scene, encodePng } from "./scene";

/**
 * An adversarial conformance sweep of the package against the doc-site pages
 * under `docs/engines/simple-3d/` — the specification the implementation
 * answers to.
 *
 * This suite is deliberately *not* another pass over what the per-module suites
 * already cover. Each of those checks one module against its own page; what is
 * left over, and what is checked here, is the work no single module owns:
 *
 * - **The export surface, symbol by symbol.** Every `apis/*.md` page closes with
 *   an Exports section. Those nine lists are transcribed below and checked
 *   against the entry point as a *set*, so a symbol the docs promise and the
 *   barrel forgot fails here rather than in a case that ships — and so does an
 *   undocumented symbol a case could come to depend on.
 * - **The recording format, field for field**, read off a document a real
 *   recorder wrote over real draws: every field of the envelope, the frame, and
 *   the renderer state, with the format's own bounds.
 * - **Refutation probes** for claims whose *negation* the neighbouring suites do
 *   not rule out — a projection round trip a sign error would survive, the
 *   per-run translucent rule at a run *boundary* (where a global sort gives a
 *   visibly different picture), the bus's snapshot dispatch as a game actually
 *   reaches it, audio in a host that offers no audio at all, and the capsule's
 *   tessellated silhouette rather than its declared bounds.
 * - **The two defects this audit found**, kept here as regressions.
 *
 * The environment is plain Node over `@test-cabinet/headless-webgl2`, exactly as
 * the validator docs prescribe: every pixel claim is a claim about pixels, and
 * every measurement arrives through an injected `SurfaceMetrics`. Two tests drop
 * below `createEngine` to the `Scene` the engine owns, and say why where they do.
 */

const DESIGN_W = 160;
const DESIGN_H = 120;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** A transform at a position, unrotated, uniformly scaled. */
function at(x: number, y: number, z: number, scale = 1): Transform {
  return {
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: scale, y: scale, z: scale },
  };
}

/** A plane turned to face the default camera: its +Y normal becomes +Z. */
function facingCamera(z: number): Transform {
  return {
    position: { x: 0, y: 0, z },
    rotation: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2),
    scale: { x: 1, y: 1, z: 1 },
  };
}

/** The state every game below carries. */
interface AuditState {
  readonly frames: number;
}

/** Anything a test wants to do at one of the three moments. */
interface Hooks {
  init?: (api: InitApi<AuditState>) => void;
  update?: (api: UpdateApi, dt: number) => void;
  render?: (api: RenderApi) => void;
}

interface Rig {
  engine: Engine<AuditState, null>;
  /** The target the engine's key and pointer listeners went on. */
  events: EventTarget;
  /** One pixel as RGBA bytes, addressed top-down in device coordinates. */
  pixel(x: number, y: number): number[];
}

/**
 * A game shaped exactly like the docs' own: a value state each frame replaces, a
 * debug surface of `null`, and hooks a test drives the three moments through.
 */
function auditGame(hooks: Hooks): Game<AuditState, null> {
  return {
    initialize(api) {
      hooks.init?.(api);
      return [{ frames: 0 }, null];
    },
    update(state, api, dt) {
      hooks.update?.(api, dt);
      return { frames: state.frames + 1 };
    },
    render(_state, api) {
      hooks.render?.(api);
    },
  };
}

/**
 * An engine over the headless canvas, with the surface supplied so nothing is
 * measured from a document that does not exist and the clock supplying its own
 * deltas so `advance` turns ticks into frames one for one.
 */
function build(
  hooks: Hooks = {},
  options: {
    cssWidth?: number;
    cssHeight?: number;
    dpr?: number;
    background?: string;
  } = {},
): Rig {
  const cssWidth = options.cssWidth ?? DESIGN_W;
  const cssHeight = options.cssHeight ?? DESIGN_H;
  const dpr = options.dpr ?? 1;
  const raw = createCanvas(
    Math.round(cssWidth * dpr),
    Math.round(cssHeight * dpr),
  );
  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };
  const engine = createEngine<AuditState, null>({
    canvas: raw as unknown as HTMLCanvasElement,
    width: DESIGN_W,
    height: DESIGN_H,
    game: auditGame(hooks),
    clock: new ConstantClock(1000 / 60),
    surface,
    ...(options.background === undefined
      ? {}
      : { background: options.background }),
  });
  const gl = raw.getContext("webgl2") as unknown as WebGL2RenderingContext;
  return {
    engine,
    events,
    pixel(x, y) {
      const out = new Uint8Array(4);
      gl.readPixels(
        x,
        raw.height - 1 - y,
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        out,
      );
      return [...out];
    },
  };
}

/** A canvas and a surface for a construction that is expected to refuse. */
function bareOptions(): Pick<
  EngineOptions<AuditState, null>,
  "canvas" | "surface"
> {
  const raw = createCanvas(DESIGN_W, DESIGN_H);
  return {
    canvas: raw as unknown as HTMLCanvasElement,
    surface: {
      cssWidth: () => DESIGN_W,
      cssHeight: () => DESIGN_H,
      dpr: () => 1,
      events: () => new EventTarget(),
    },
  };
}

/** A `KeyboardEvent`-shaped event, which is all the engine's listeners read. */
function keyEvent(code: string): Event {
  return Object.assign(new Event("keydown"), { code, repeat: false });
}

/** A `PointerEvent`-shaped event, which is all the engine's listeners read. */
function pointerEvent(type: string, x: number, y: number): Event {
  return Object.assign(new Event(type), {
    clientX: x,
    clientY: y,
    isPrimary: true,
  });
}

/** The design viewport a projection test computes against. */
function designViewport(): Viewport {
  return fitViewport(DESIGN_W, DESIGN_H, DESIGN_W, DESIGN_H, 1);
}

/** The default `CameraState`, spelled out as `apis/viewport.md`'s table gives it. */
function documentedCamera(): CameraState {
  return {
    position: { x: 0, y: 0, z: 10 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    fovY: Math.PI / 3,
    near: 0.1,
    far: 1000,
  };
}

/** The ops one frame issued, resolved through the recording's shared table. */
function frameOps(recording: Recording, index: number): DrawOp[] {
  const frame = recording.frames[index];
  if (frame === undefined) throw new Error(`no frame ${index}`);
  return frame.ops.map((i) => {
    const op = recording.ops[i];
    if (op === undefined) throw new Error(`no op ${i}`);
    return op;
  });
}

/** Every `$asset` index some operation or captured material names. */
function namedAssets(recording: Recording): Set<number> {
  const named = new Set<number>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const object = value as Record<string, unknown>;
    const asset = object["$asset"];
    if (typeof asset === "number") named.add(asset);
    Object.values(object).forEach(visit);
  };
  for (const frame of recording.frames) {
    for (const index of frame.ops) {
      const op = recording.ops[index];
      if (op?.op === "call") op.args.forEach(visit);
      else if (op?.op === "set") visit(op.value);
    }
  }
  for (const asset of recording.assets) {
    if (asset.kind === "material")
      Object.values(asset.maps).forEach((n) => named.add(n));
  }
  return named;
}

/** A PNG the engine's own decoder reads back, of the given size. */
function png(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 0x20;
    pixels[i + 1] = 0x40;
    pixels[i + 2] = 0x80;
    pixels[i + 3] = 0xff;
  }
  return encodePng(pixels, width, height);
}

/**
 * A one-channel 16-bit PCM WAV over the given samples — the container the
 * asset-generation tools produce and the only one the engine decodes.
 */
function pcmWav(samples: readonly number[], sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1)
      bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
  });
  return bytes;
}

/** Runs `body` with `globalThis.fetch` answering from `serve`, and restores it. */
async function overFetch(
  serve: (url: string) => Response,
  body: () => Promise<void>,
): Promise<void> {
  const previous = globalThis.fetch;
  globalThis.fetch = ((input: string): Promise<Response> =>
    Promise.resolve(serve(input))) as unknown as typeof fetch;
  try {
    await body();
  } finally {
    globalThis.fetch = previous;
  }
}

/** Lets every already-resolved load settle before a test reads what it produced. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/* -------------------------------------------------------------------------- */
/* 1. The export surface, against every apis/ page's Exports section          */
/* -------------------------------------------------------------------------- */

/**
 * Every value the nine `apis/*.md` Exports sections promise, and nothing else.
 *
 * `apis/overview.md` summarizes them as "`createEngine`, the clocks,
 * `TOUCH_LAYOUTS`, the viewport functions, the math functions, `projectPoint`
 * and `pointerRay`, `RECORDING_FORMAT`"; this is that sentence enumerated
 * against the per-page lists it stands for.
 */
const DOCUMENTED_VALUES = [
  // apis/engine.md — "createEngine is the root entry point's only function".
  "createEngine",
  // apis/clocks.md
  "WallClock",
  "PacedClock",
  "ConstantClock",
  "SequenceClock",
  "JitterClock",
  // apis/input.md
  "TOUCH_LAYOUTS",
  // apis/viewport.md — the eleven math functions and the four viewport ones.
  "vec3Add",
  "vec3Sub",
  "vec3Scale",
  "vec3Dot",
  "vec3Cross",
  "vec3Length",
  "vec3Normalize",
  "quatFromAxisAngle",
  "quatMultiply",
  "rotateVec3",
  "transformPoint",
  "projectPoint",
  "pointerRay",
  "fitViewport",
  "syncCanvas",
  // apis/recording.md
  "RECORDING_FORMAT",
] as const;

/** Every type name the same nine Exports sections promise. */
const DOCUMENTED_TYPES = [
  // apis/engine.md
  "EngineOptions",
  "SurfaceMetrics",
  "Engine",
  "RunOptions",
  "Transition",
  "DeepReadonly",
  // apis/game.md
  "Game",
  "InitApi",
  "UpdateApi",
  "RenderApi",
  "SceneContext",
  "DrawMeshOptions",
  "MaterialLike",
  "MaterialSpec",
  "Material",
  "Geometry",
  "HudTextOptions",
  "EngineEvents",
  "EngineEventMap",
  "FrameInfo",
  // apis/clocks.md
  "Clock",
  "PacedClockOptions",
  // apis/viewport.md
  "Vec2",
  "Vec3",
  "Quat",
  "Transform",
  "Box3",
  "Ray",
  "CameraState",
  "Viewport",
  // apis/input.md
  "ActionKind",
  "ActionBinding",
  "RegisteredAction",
  "TouchLayout",
  "PointerSampleType",
  "PointerSample",
  "PointerSnapshot",
  // apis/audio.md
  "CueSpec",
  "AudioState",
  // apis/assets.md
  "MeshHandle",
  "TextureHandle",
  "MaterialHandle",
  "MaterialMapSlot",
  // apis/diagnostics.md
  "FrameMetrics",
  // apis/recording.md
  "Recording",
  "RecordedFrame",
  "RenderState",
  "RenderMode",
  "LightState",
  "Color",
  "DrawOp",
  "DrawValue",
  "CapturedAsset",
  "Resource",
  "ResourceOp",
] as const;

/**
 * The type names the entry point makes reachable, read out of the source.
 *
 * A type export leaves no runtime trace, so the set-equality check the values
 * get has nothing to look at here: vitest erases types rather than checking
 * them, and `tsc -b` excludes the test files. Reading `index.ts`'s own re-export
 * list — plus, for its closing `export type * from "./contract"`, every name
 * `contract.ts` exports — is what gives this half of the audit teeth under a
 * plain `vitest run`. `AuditedTypes` at the foot of this file is the same claim
 * made to the compiler, for a run that typechecks the tests.
 */
function reachableTypeNames(): Set<string> {
  const read = (name: string): string =>
    readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
  const names = new Set<string>();
  const index = read("./index.ts");
  for (const match of index.matchAll(/export (?:type )?\{([^}]*)\}/g)) {
    for (const part of (match[1] ?? "").split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) names.add(name);
    }
  }
  for (const match of index.matchAll(/^export (?:interface|type) (\w+)/gm)) {
    names.add(match[1] ?? "");
  }
  if (index.includes('export type * from "./contract"')) {
    for (const match of read("./contract.ts").matchAll(
      /^export (?:interface|type|const) (\w+)/gm,
    )) {
      names.add(match[1] ?? "");
    }
  }
  return names;
}

describe("the entry point's export surface", () => {
  it("exports exactly the values the apis pages list, and nothing they do not", () => {
    // Set equality in both directions: a missing symbol is a promise broken,
    // and an extra one is a surface a case can come to depend on that no page
    // says the engine keeps.
    expect(Object.keys(entry).sort()).toEqual([...DOCUMENTED_VALUES].sort());
  });

  it("makes every documented type name reachable from the root specifier", () => {
    const reachable = reachableTypeNames();
    expect(DOCUMENTED_TYPES.filter((name) => !reachable.has(name))).toEqual([]);
  });

  it("exports the five clocks as constructible classes, each answering delta()", () => {
    const clocks: Clock[] = [
      new WallClock(),
      new PacedClock(60),
      new ConstantClock(16),
      new SequenceClock([16, 32]),
      new JitterClock(10, 20, 7),
    ];
    for (const clock of clocks) {
      const delta = clock.delta(1_000);
      expect(delta === null || Number.isFinite(delta)).toBe(true);
    }
  });

  it("clamps a WallClock to 100 ms by default, and to whatever it was given otherwise", () => {
    // Read back through behaviour, because neither default is a readable field.
    expect(new WallClock().delta(0)).toBe(0);
    const clock = new WallClock();
    clock.delta(0);
    expect(clock.delta(5_000)).toBe(100);
    const tight = new WallClock(50);
    tight.delta(0);
    expect(tight.delta(5_000)).toBe(50);
  });

  it("gives a PacedClock four intervals of catch-up before it abandons the grid", () => {
    // Ten-millisecond slots. Thirty milliseconds late is three slots — inside
    // the default four — so the missed slots are delivered one at a time.
    const paced = new PacedClock(100);
    expect(paced.delta(0)).toBe(10);
    expect(paced.delta(40)).toBe(10);
    expect(paced.delta(40)).toBe(10);
    // A stall past the window costs the game a pause rather than a burst.
    const stalled = new PacedClock(100);
    expect(stalled.delta(0)).toBe(10);
    expect(stalled.delta(1_000)).toBe(10);
    expect(stalled.delta(1_000)).toBeNull();
    // And a shorter window gives up sooner, which is what the option is for.
    const eager = new PacedClock(100, { resyncAfter: 1 });
    expect(eager.delta(0)).toBe(10);
    expect(eager.delta(40)).toBe(10);
    expect(eager.delta(40)).toBeNull();
  });

  it("refuses every clock argument its error table names, with a RangeError", () => {
    expect(() => new WallClock(0)).toThrow(RangeError);
    expect(() => new WallClock(0)).toThrow(/got 0/);
    expect(() => new PacedClock(0)).toThrow(RangeError);
    expect(() => new PacedClock(60, { resyncAfter: 0.5 })).toThrow(RangeError);
    expect(() => new ConstantClock(Number.NaN)).toThrow(RangeError);
    expect(() => new SequenceClock([])).toThrow(RangeError);
    expect(() => new SequenceClock([16, -1])).toThrow(/-1 at index 1/);
    expect(() => new JitterClock(20, 10, 1)).toThrow(RangeError);
    expect(() => new JitterClock(10, 20, Number.NaN)).toThrow(RangeError);
  });

  it("writes recording format 1, the one version there is", () => {
    expect(RECORDING_FORMAT).toBe(1);
  });

  it("freezes the touch-layout catalogue through its entries and their actions", () => {
    expect(Object.isFrozen(TOUCH_LAYOUTS)).toBe(true);
    expect(Object.keys(TOUCH_LAYOUTS)).toEqual([
      "stick-move",
      "stick-look",
      "stick-look-two-buttons",
      "wheel-pedals",
    ]);
    for (const layout of Object.values(TOUCH_LAYOUTS)) {
      expect(Object.isFrozen(layout)).toBe(true);
      expect(Object.isFrozen(layout.actions)).toBe(true);
      // The four menu actions close every vocabulary, in that order.
      expect(layout.actions.slice(-4)).toEqual([
        "confirm",
        "back",
        "pause",
        "mute",
      ]);
    }
    // The literal array `apis/input.md` prints.
    expect(TOUCH_LAYOUTS["stick-move"]?.actions).toEqual([
      "move-forward",
      "move-back",
      "move-left",
      "move-right",
      "confirm",
      "back",
      "pause",
      "mute",
    ]);
  });

  it("refuses a layout outside the catalogue at construction, naming every valid one", () => {
    const attempt = (): unknown =>
      createEngine<AuditState, null>({
        ...bareOptions(),
        width: DESIGN_W,
        height: DESIGN_H,
        game: auditGame({}),
        layout: "twin-stick",
      });
    expect(attempt).toThrow(Error);
    for (const name of Object.keys(TOUCH_LAYOUTS))
      expect(attempt).toThrow(name);
  });

  it("refuses a design size that is not finite and positive, naming the size", () => {
    expect(() =>
      createEngine<AuditState, null>({
        ...bareOptions(),
        width: 0,
        height: DESIGN_H,
        game: auditGame({}),
      }),
    ).toThrow(/0x120/);
  });

  it("refuses a canvas that yields no WebGL2 context", () => {
    expect(() =>
      createEngine<AuditState, null>({
        ...bareOptions(),
        canvas: {
          getContext: (): null => null,
          width: 1,
          height: 1,
        } as unknown as HTMLCanvasElement,
        width: DESIGN_W,
        height: DESIGN_H,
        game: auditGame({}),
      }),
    ).toThrow(/WebGL2/);
  });

  it("names the ordering when state, debug, apply, run, or advance is reached too early", () => {
    const rig = build();
    expect(() => rig.engine.state).toThrow(
      /await engine\.initialize\(\) first/,
    );
    expect(() => rig.engine.debug).toThrow(/\[state, debug\]/);
    expect(() => rig.engine.apply((state) => state as AuditState)).toThrow(
      /await engine\.initialize\(\) first/,
    );
    expect(() => rig.engine.run()).toThrow(
      /await engine\.initialize\(\) first/,
    );
    expect(() => rig.engine.advance(1)).toThrow(
      /await engine\.initialize\(\) first/,
    );
    // Everything the table does not guard is reachable from construction, which
    // is what lets a caller subscribe and measure before any game code runs.
    expect(rig.engine.recording()).toBe(false);
    expect(rig.engine.viewport()).toEqual({
      width: DESIGN_W,
      height: DESIGN_H,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    expect(rig.engine.frame()).toEqual({ count: 0, timeMs: 0, lastDeltaMs: 0 });
    rig.engine.destroy();
  });

  it("refuses an advance count that is not a whole, non-negative number, naming it", async () => {
    const rig = build();
    await rig.engine.initialize();
    expect(() => rig.engine.advance(-1)).toThrow(RangeError);
    expect(() => rig.engine.advance(1.5)).toThrow(/1\.5/);
    await expect(rig.engine.advance(0)).resolves.toBeUndefined();
    expect(rig.engine.frame().count).toBe(0);
    rig.engine.destroy();
  });

  it("refuses an unbalanced startRecording or stopRecording, naming the call", () => {
    const rig = build();
    expect(() => rig.engine.stopRecording()).toThrow(/stopRecording/);
    rig.engine.startRecording();
    expect(() => rig.engine.startRecording()).toThrow(/startRecording/);
    rig.engine.stopRecording();
    rig.engine.destroy();
  });

  it("refuses a transition that returns undefined and keeps the state it had", async () => {
    const rig = build();
    const opening = await rig.engine.initialize();
    expect(() =>
      rig.engine.apply(() => undefined as unknown as AuditState),
    ).toThrow(/must return the next state/);
    expect(rig.engine.state).toEqual(opening);
    rig.engine.destroy();
  });

  it("rejects an initialize that returns anything but the pair, naming [state, debug]", async () => {
    const engine = createEngine<AuditState, null>({
      ...bareOptions(),
      width: DESIGN_W,
      height: DESIGN_H,
      game: {
        initialize: () => ({ frames: 0 }) as unknown as [AuditState, null],
        update: (state) => state as AuditState,
        render: () => {},
      },
    });
    await expect(engine.initialize()).rejects.toThrow(/\[state, debug\]/);
    engine.destroy();
  });

  it("refuses an action kind outside the vocabulary, naming the value", async () => {
    let refusal: unknown = null;
    const rig = build({
      init: (api) => {
        try {
          api.input.register("fire", {
            keys: ["Space"],
            kind: "trigger" as ActionKind,
          });
        } catch (error) {
          refusal = error;
        }
      },
    });
    await rig.engine.initialize();
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toMatch(/"trigger"/);
    rig.engine.destroy();
  });
});

/* -------------------------------------------------------------------------- */
/* 2. The recording format, field for field                                   */
/* -------------------------------------------------------------------------- */

describe("the recording format, field for field", () => {
  /** One armed recording over two frames that exercise the whole vocabulary. */
  async function record(): Promise<{ rig: Rig; recording: Recording }> {
    const rig = build(
      {
        render: (api) => {
          const scene = api.scene;
          scene.setCamera(documentedCamera());
          scene.setLights([
            { type: "ambient", color: "#ffffff", intensity: 1 },
          ]);
          scene.setMode("unlit");
          scene.clearDepth();
          scene.drawGeometry(
            scene.createBox({ x: 2, y: 2, z: 2 }),
            "#ff0000",
            at(0, 0, 0),
          );
          scene.drawGeometry(
            scene.createSphere(1),
            scene.createMaterial({ baseColor: "#00ff00" }),
            at(2, 0, 0),
          );
          scene.drawLine(
            [
              { x: -1, y: 0, z: 0 },
              { x: 1, y: 0, z: 0 },
            ],
            "#ffffff",
          );
          scene.drawHudText("HP", { x: 4, y: 4 });
          scene.drawHudRect({ x: 0, y: 0 }, { x: 10, y: 2 }, "#000000");
        },
      },
      { background: "#101820" },
    );
    await rig.engine.initialize();
    rig.engine.startRecording();
    await rig.engine.advance(2);
    return { rig, recording: rig.engine.stopRecording() };
  }

  it("carries every envelope field the Recording interface names, and no others", async () => {
    const { rig, recording } = await record();
    expect(Object.keys(recording).sort()).toEqual([
      "assets",
      "background",
      "format",
      "frames",
      "height",
      "ops",
      "resources",
      "space",
      "states",
      "width",
    ]);
    expect(recording.format).toBe(RECORDING_FORMAT);
    expect(recording.space).toBe("3d");
    expect(recording.width).toBe(DESIGN_W);
    expect(recording.height).toBe(DESIGN_H);
    expect(recording.background).toBe("#101820");
    rig.engine.destroy();
  });

  it("reports a null background for an engine built without one", async () => {
    const rig = build();
    await rig.engine.initialize();
    rig.engine.startRecording();
    await rig.engine.advance(1);
    expect(rig.engine.stopRecording().background).toBeNull();
    rig.engine.destroy();
  });

  it("carries every RecordedFrame field exactly, and no stack field", async () => {
    const { rig, recording } = await record();
    const frame = recording.frames[0];
    expect(Object.keys(frame ?? {}).sort()).toEqual([
      "count",
      "deltaMs",
      "ops",
      "state",
      "surface",
      "timeMs",
    ]);
    expect(frame).not.toHaveProperty("stack");
    // The FrameInfo figures for the same frame, exact rather than rounded.
    expect(frame?.count).toBe(1);
    expect(frame?.deltaMs).toBe(1000 / 60);
    expect(frame?.timeMs).toBe(1000 / 60);
    expect(frame?.surface).toEqual({ width: DESIGN_W, height: DESIGN_H });
    rig.engine.destroy();
  });

  it("keeps the frame metadata exact where it cuts a DrawValue to nine digits", async () => {
    // 1000/60 is 16.666666666666668 — seventeen digits. The frame keeps every
    // one, because it is the axis a reviewer scrubs on; a coordinate does not.
    const rig = build({
      render: (api) =>
        api.scene.drawHudRect(
          { x: 1000 / 60, y: 0 },
          { x: 1, y: 1 },
          "#ffffff",
        ),
    });
    await rig.engine.initialize();
    rig.engine.startRecording();
    await rig.engine.advance(1);
    const recording = rig.engine.stopRecording();
    expect(recording.frames[0]?.deltaMs).toBe(1000 / 60);
    const op = frameOps(recording, 0)[0];
    if (op?.op !== "call") return expect.fail("expected a call");
    expect((op.args[0] as { x: number }).x).toBe(16.6666667);
    rig.engine.destroy();
  });

  it("carries a RenderState of exactly camera, lights, and mode", async () => {
    const { rig, recording } = await record();
    for (const state of recording.states) {
      expect(Object.keys(state).sort()).toEqual(["camera", "lights", "mode"]);
      expect(Object.keys(state.camera).sort()).toEqual([
        "far",
        "fovY",
        "near",
        "position",
        "rotation",
      ]);
      expect(state.lights.length).toBeLessThanOrEqual(64);
      expect(["standard", "wireframe", "unlit", "normals"]).toContain(
        state.mode,
      );
    }
    // The first captured frame inherits the defaults a fresh engine holds —
    // written, like every number inside a RenderState, to nine significant
    // digits, so `Math.PI / 3` arrives as 1.04719755 rather than in full.
    expect(recording.states[recording.frames[0]?.state ?? -1]).toEqual({
      camera: { ...documentedCamera(), fovY: 1.04719755 },
      lights: [],
      mode: "standard",
    });
    rig.engine.destroy();
  });

  it("holds call entries only, over the ten-verb vocabulary, with no producing call", async () => {
    const { rig, recording } = await record();
    const vocabulary = [
      "setCamera",
      "setLights",
      "setMode",
      "clearDepth",
      "drawMesh",
      "drawGeometry",
      "drawBillboard",
      "drawLine",
      "drawHudText",
      "drawHudRect",
    ];
    for (const op of recording.ops) {
      expect(op.op).toBe("call");
      if (op.op === "call") expect(vocabulary).toContain(op.method);
    }
    // The six producers appear as resource recipes instead, each immutable.
    expect(recording.resources.length).toBeGreaterThan(0);
    for (const resource of recording.resources) {
      expect([
        "createBox",
        "createSphere",
        "createCylinder",
        "createCapsule",
        "createPlane",
        "createMaterial",
      ]).toContain(resource.make.method);
      expect(resource.then).toEqual([]);
    }
    rig.engine.destroy();
  });

  it("settles its four tables so every entry is one some frame names", async () => {
    const { rig, recording } = await record();
    const namedOps = new Set(recording.frames.flatMap((frame) => frame.ops));
    const namedStates = new Set(recording.frames.map((frame) => frame.state));
    expect([...namedOps].sort((a, b) => a - b)).toEqual(
      recording.ops.map((_, i) => i),
    );
    expect([...namedStates].sort((a, b) => a - b)).toEqual(
      recording.states.map((_, i) => i),
    );

    const namedResources = new Set<number>();
    const visit = (value: DrawValue): void => {
      if (value === null || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      const object = value as Record<string, DrawValue>;
      const res = object["$res"];
      if (typeof res === "number") namedResources.add(res);
      Object.values(object).forEach(visit);
    };
    for (const op of recording.ops)
      if (op.op === "call") op.args.forEach(visit);
    expect([...namedResources].sort((a, b) => a - b)).toEqual(
      recording.resources.map((_, i) => i),
    );
    expect(namedAssets(recording).size).toBe(recording.assets.length);
    rig.engine.destroy();
  });

  it("encodes the structured values as their plain-data shapes", async () => {
    const { rig, recording } = await record();
    const ops = frameOps(recording, 0).filter(
      (op): op is Extract<DrawOp, { op: "call" }> => op.op === "call",
    );
    expect(ops.find((op) => op.method === "setCamera")?.args[0]).toEqual({
      position: { x: 0, y: 0, z: 10 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      fovY: 1.04719755,
      near: 0.1,
      far: 1000,
    });
    expect(ops.find((op) => op.method === "setLights")?.args[0]).toEqual([
      { type: "ambient", color: "#ffffff", intensity: 1 },
    ]);
    const geometry = ops.find((op) => op.method === "drawGeometry");
    expect(geometry?.args[0]).toHaveProperty("$res");
    expect(geometry?.args[2]).toEqual({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
    // An omitted optional argument is omitted rather than filled in.
    expect(ops.find((op) => op.method === "drawHudText")?.args).toEqual([
      "HP",
      { x: 4, y: 4 },
    ]);
    rig.engine.destroy();
  });

  it("shares one entry between identical operations, states, and producing calls", async () => {
    // Two frames drawing the same things: the tables hold one of each, and each
    // frame names them by index. This is what makes a per-frame `create*` free.
    const { rig, recording } = await record();
    expect(recording.frames).toHaveLength(2);
    expect(recording.frames[0]?.ops).toEqual(recording.frames[1]?.ops);
    expect(recording.frames[0]?.ops).toHaveLength(9);
    expect(recording.ops).toHaveLength(9);
    // Four producers were called twice apiece and interned once apiece.
    expect(recording.resources).toHaveLength(3);
    rig.engine.destroy();
  });

  it("cuts an inherited light list to 64 and says so on the frame that inherited it", async () => {
    const lights: LightState[] = Array.from({ length: 70 }, (_, i) => ({
      type: "point",
      color: "#ffffff",
      intensity: 1,
      position: { x: i, y: 0, z: 0 },
      range: 5,
    }));
    const rig = build({
      render: (api) => {
        if (api.frame().count === 1) api.scene.setLights(lights);
      },
    });
    await rig.engine.initialize();
    rig.engine.startRecording();
    await rig.engine.advance(2);
    const recording = rig.engine.stopRecording();
    // The frame that *issued* the call inherited nothing and is not truncated;
    // the frame that inherited the long list is.
    expect(recording.frames[0]?.truncated).toBeUndefined();
    expect(recording.frames[1]?.truncated).toBe(true);
    expect(
      recording.states[recording.frames[1]?.state ?? -1]?.lights,
    ).toHaveLength(64);
    // The op records the call as the build made it, all seventy of them.
    const call = frameOps(recording, 0)[0];
    if (call?.op !== "call") return expect.fail("expected a call");
    expect(call.args[0]).toHaveLength(70);
    rig.engine.destroy();
  });

  it("bounds an encoded value at depth 32 and at 65,536 expanded values", async () => {
    // Both bounds are the format's own rather than a recorder's choice, so a
    // build hands the same input to any recorder and gets the same document.
    let deep: Record<string, unknown> = { bottom: true };
    for (let i = 0; i < 40; i += 1) deep = { deep };
    const wide = Array.from({ length: 70_000 }, (_, i) => i);
    const rig = build({
      render: (api) => {
        api.scene.drawHudText(
          "a",
          { x: 0, y: 0 },
          deep as unknown as HudTextOptions,
        );
        api.scene.drawHudText("b", { x: 0, y: 0 }, {
          size: wide,
        } as unknown as HudTextOptions);
      },
    });
    await rig.engine.initialize();
    rig.engine.startRecording();
    await rig.engine.advance(1);
    const recording = rig.engine.stopRecording();
    const ops = frameOps(recording, 0).filter(
      (op): op is Extract<DrawOp, { op: "call" }> => op.op === "call",
    );

    let walked = ops[0]?.args[2] as Record<string, DrawValue>;
    let depth = 0;
    while (walked && typeof walked === "object" && "deep" in walked) {
      walked = walked["deep"] as Record<string, DrawValue>;
      depth += 1;
    }
    // The value an operation carries sits at depth zero, so the container at
    // depth 32 is the marker rather than being expanded.
    expect(depth).toBe(32);
    expect(walked).toEqual({ $opaque: expect.any(String) });

    const cut = (ops[1]?.args[2] as { size: DrawValue[] }).size;
    expect(cut.length).toBeLessThan(70_000);
    expect(cut[cut.length - 1]).toEqual({ $opaque: "truncated" });
    rig.engine.destroy();
  });

  it("brackets the frame around the render, so the engine's own chrome stays out", async () => {
    // A registered diagnostic source and the overlay's own work happen after
    // the render and never reach the evidence: each frame holds the one call
    // the game made and nothing else.
    const rig = build({
      init: (api) =>
        api.diagnostics.register("frames", (state) => state.frames),
      render: (api) =>
        api.scene.drawHudRect({ x: 0, y: 0 }, { x: 1, y: 1 }, "#ffffff"),
    });
    await rig.engine.initialize();
    rig.engine.startRecording();
    await rig.engine.advance(3);
    const recording = rig.engine.stopRecording();
    expect(recording.frames).toHaveLength(3);
    for (const frame of recording.frames) expect(frame.ops).toHaveLength(1);
    rig.engine.destroy();
  });

  it("begins capture at the frame after startRecording, even armed from inside one", async () => {
    let armed = false;
    const rig: Rig = build({
      update: (api) => {
        if (!armed && api.frame().count === 1) {
          armed = true;
          rig.engine.startRecording();
        }
      },
      render: (api) =>
        api.scene.drawHudRect({ x: 0, y: 0 }, { x: 1, y: 1 }, "#ffffff"),
    });
    await rig.engine.initialize();
    await rig.engine.advance(3);
    const recording = rig.engine.stopRecording();
    // Armed from inside frame 1's update, so frames 2 and 3 are the capture.
    expect(recording.frames.map((frame) => frame.count)).toEqual([2, 3]);
    rig.engine.destroy();
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Projection round trips                                                  */
/* -------------------------------------------------------------------------- */

describe("projection round trips", () => {
  /** Where a ray lands after `distance` world units. */
  function along(ray: Ray, distance: number): Vec3 {
    return vec3Add(ray.origin, vec3Scale(ray.direction, distance));
  }

  it("passes back through the point for a camera posed anywhere, at any field of view", () => {
    // A sign error in the y flip, in the aspect, or in the inverse view
    // rotation all survive a round trip taken with an identity camera on a
    // square viewport. None of these is that: each camera turns about a skew
    // axis, the field is 4:3, and every point sits off both axes.
    const viewport = designViewport();
    for (const [axis, angle, fovY] of [
      [{ x: 0, y: 1, z: 0 }, 0.9, Math.PI / 3],
      [{ x: 1, y: 2, z: -1 }, -1.2, 0.6],
      [{ x: -3, y: 1, z: 2 }, 2.5, 1.4],
    ] as const) {
      const camera: CameraState = {
        ...documentedCamera(),
        position: { x: 3, y: -2, z: 5 },
        rotation: quatFromAxisAngle(axis, angle),
        fovY,
      };
      for (const view of [
        { x: 0.7, y: -0.4, z: -3 },
        { x: -2, y: 1.5, z: -8 },
      ]) {
        // Built in view space with a negative z, so each point is in front of
        // the camera by construction, then carried out into the world.
        const world = vec3Add(
          camera.position,
          rotateVec3(camera.rotation, view),
        );
        const logical = projectPoint(camera, viewport, world);
        expect(logical).not.toBeNull();
        const hit = along(
          pointerRay(camera, viewport, logical as Vec2),
          vec3Length(vec3Sub(world, camera.position)),
        );
        expect(hit.x).toBeCloseTo(world.x, 9);
        expect(hit.y).toBeCloseTo(world.y, 9);
        expect(hit.z).toBeCloseTo(world.z, 9);
      }
    }
  });

  it("holds the round trip for a point outside the frustum, where the map still applies", () => {
    // `apis/viewport.md`: an out-of-frustum point "maps outside that range and
    // is returned as-is". The round trip is arithmetic rather than visibility,
    // so it has to survive a point well off the corner of the picture.
    const camera = documentedCamera();
    const viewport = designViewport();
    const world: Vec3 = { x: 40, y: -25, z: 0 };
    const logical = projectPoint(camera, viewport, world) as Vec2;
    expect(logical.x).toBeGreaterThan(DESIGN_W);
    expect(logical.y).toBeGreaterThan(DESIGN_H);
    const hit = along(
      pointerRay(camera, viewport, logical),
      vec3Length(vec3Sub(world, camera.position)),
    );
    expect(hit.x).toBeCloseTo(world.x, 6);
    expect(hit.y).toBeCloseTo(world.y, 6);
  });

  it("round-trips a device pixel back to the world point that drew into it", () => {
    // The whole documented bridge taken backwards: device to logical by the
    // inverse equations, logical to world by pointerRay, and back again by
    // projectPoint composed with the forward equations — under a letterboxed
    // dpr-2 fit, so the scale and both offsets are in play.
    const viewport = fitViewport(DESIGN_W, DESIGN_H, 320, 180, 2);
    expect(viewport.offsetX).toBeGreaterThan(0);
    const camera = documentedCamera();
    for (const [logicalX, logicalY] of [
      [10, 90],
      [155, 5],
    ] as const) {
      const deviceX = viewport.offsetX + logicalX * viewport.scale;
      const deviceY = viewport.offsetY + logicalY * viewport.scale;
      const back = projectPoint(
        camera,
        viewport,
        along(
          pointerRay(camera, viewport, {
            x: (deviceX - viewport.offsetX) / viewport.scale,
            y: (deviceY - viewport.offsetY) / viewport.scale,
          }),
          7,
        ),
      ) as Vec2;
      expect(viewport.offsetX + back.x * viewport.scale).toBeCloseTo(
        deviceX,
        6,
      );
      expect(viewport.offsetY + back.y * viewport.scale).toBeCloseTo(
        deviceY,
        6,
      );
    }
  });

  it("hands the game a pointer already on the axes projectPoint answers in", async () => {
    // `apis/input.md` and `apis/viewport.md` meet here. The engine's pointer is
    // `(cssX * dpr - offsetX) / scale`, so a click aimed at where a world point
    // projected reads back as that same logical point — which is the whole
    // composition a game then hands to `pointerRay`.
    let read: PointerSnapshot = { x: -1, y: -1, down: false };
    const rig = build(
      { update: (api) => (read = api.input.pointer()) },
      { cssWidth: 320, cssHeight: 180, dpr: 2 },
    );
    await rig.engine.initialize();
    const viewport = rig.engine.viewport();
    const world: Vec3 = { x: 1.5, y: -0.75, z: 0 };
    const logical = projectPoint(documentedCamera(), viewport, world) as Vec2;
    rig.events.dispatchEvent(
      pointerEvent(
        "pointerdown",
        (logical.x * viewport.scale + viewport.offsetX) / 2,
        (logical.y * viewport.scale + viewport.offsetY) / 2,
      ),
    );
    await rig.engine.advance(1);
    expect(read.x).toBeCloseTo(logical.x, 6);
    expect(read.y).toBeCloseTo(logical.y, 6);
    expect(read.down).toBe(true);
    rig.engine.destroy();
  });

  it("has no round trip at all for a point at or behind the camera plane", () => {
    const camera = documentedCamera();
    const viewport = designViewport();
    // Exactly on the plane, and behind it. Both are null rather than a point a
    // caller could mistake for somewhere on the picture.
    expect(projectPoint(camera, viewport, { x: 1, y: 1, z: 10 })).toBeNull();
    expect(projectPoint(camera, viewport, { x: 0, y: 0, z: 11 })).toBeNull();
    expect(
      projectPoint(camera, viewport, { x: 0, y: 0, z: 9.999 }),
    ).not.toBeNull();
  });

  it("reads its arguments without writing to them and hands back fresh values", () => {
    const camera = documentedCamera();
    const viewport = designViewport();
    const before = JSON.stringify({ camera, viewport });
    const ray = pointerRay(camera, viewport, { x: 10, y: 10 });
    projectPoint(camera, viewport, { x: 1, y: 2, z: 3 });
    expect(JSON.stringify({ camera, viewport })).toBe(before);
    // The origin is a copy, so writing to it cannot move the camera.
    ray.origin.x = 999;
    expect(camera.position.x).toBe(0);
    expect(vec3Length(ray.direction)).toBeCloseTo(1, 12);
  });

  it("draws the same picture on every canvas, because the aspect is the design aspect", () => {
    // `apis/viewport.md`: "Aspect is not a field." A projection computed against
    // wildly different device fits lands on the same logical point.
    const camera = documentedCamera();
    const world: Vec3 = { x: 2, y: 1, z: -3 };
    expect(
      projectPoint(
        camera,
        fitViewport(DESIGN_W, DESIGN_H, 1600, 400, 1),
        world,
      ),
    ).toEqual(
      projectPoint(
        camera,
        fitViewport(DESIGN_W, DESIGN_H, 300, 1200, 3),
        world,
      ),
    );
  });

  it("holds the eleven math functions to the behaviour their table states", () => {
    // The rows `apis/viewport.md` prints, each one a claim a plausible
    // implementation gets backwards.
    expect(vec3Normalize({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
    expect(quatFromAxisAngle({ x: 0, y: 0, z: 0 }, 1.2)).toEqual({
      x: 0,
      y: 0,
      z: 0,
      w: 1,
    });
    // quatMultiply(a, b) applies b first: a quarter turn about X after a
    // quarter turn about Y sends +Z somewhere a swapped order does not.
    const aboutX = quatFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2);
    const aboutY = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const spun = rotateVec3(quatMultiply(aboutX, aboutY), { x: 0, y: 0, z: 1 });
    expect(spun.x).toBeCloseTo(1, 12);
    expect(spun.y).toBeCloseTo(0, 12);
    expect(spun.z).toBeCloseTo(0, 12);
    const swapped = rotateVec3(quatMultiply(aboutY, aboutX), {
      x: 0,
      y: 0,
      z: 1,
    });
    expect(swapped.y).toBeCloseTo(-1, 12);
    // transformPoint composes scale, then rotation, then translation: scaling
    // after the rotation would put this point somewhere else entirely.
    expect(
      transformPoint(
        {
          position: { x: 1, y: 0, z: 0 },
          rotation: aboutY,
          scale: { x: 2, y: 1, z: 1 },
        },
        { x: 1, y: 0, z: 0 },
      ).z,
    ).toBeCloseTo(-2, 12);
    // The rest of the vocabulary, and its purity.
    const a: Vec3 = { x: 1, y: 2, z: 3 };
    const b: Vec3 = { x: -1, y: 0.5, z: 2 };
    expect(vec3Add(a, b)).toEqual({ x: 0, y: 2.5, z: 5 });
    expect(vec3Sub(a, b)).toEqual({ x: 2, y: 1.5, z: 1 });
    expect(vec3Scale(a, 2)).toEqual({ x: 2, y: 4, z: 6 });
    expect(vec3Dot(a, b)).toBeCloseTo(6, 12);
    expect(vec3Cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toEqual({
      x: 0,
      y: 0,
      z: 1,
    });
    expect(vec3Length({ x: 3, y: 4, z: 0 })).toBe(5);
    expect(a).toEqual({ x: 1, y: 2, z: 3 });
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Runs, and what the recording carries of them                            */
/* -------------------------------------------------------------------------- */

describe("runs, and what the recording carries of them", () => {
  /**
   * A white backdrop and two half-opaque planes facing the camera, the nearer
   * issued first, with whatever `divider` puts between them.
   *
   * The picture is what refutes a global sort. Split into two runs, the nearer
   * red plane paints in the first run and the farther blue plane paints over it
   * in the second, giving blue over red; sorted across the whole frame the
   * farther one would paint first and the answer would be red over blue. The
   * two differ in the red and blue channels, and each is exact because a plane
   * is one quad and blends exactly once.
   */
  function twoRuns(divider: (scene: SceneContext) => void): Hooks {
    return {
      render: (api) => {
        const scene = api.scene;
        scene.setMode("unlit");
        scene.drawGeometry(
          scene.createBox({ x: 12, y: 10, z: 0.2 }),
          "#ffffff",
          at(0, 0, -3),
        );
        const red = scene.createMaterial({
          baseColor: "#ff0000",
          opacity: 0.5,
          unlit: true,
        });
        const blue = scene.createMaterial({
          baseColor: "#0000ff",
          opacity: 0.5,
          unlit: true,
        });
        const quad = scene.createPlane(6, 6);
        scene.drawGeometry(quad, red, facingCamera(3));
        divider(scene);
        scene.drawGeometry(quad, blue, facingCamera(0));
      },
    };
  }

  /** White, then half-red over it, then half-blue over that. */
  const BLUE_OVER_RED = [128, 64, 192];
  /** The same three draws sorted across the frame instead of within a run. */
  const RED_OVER_BLUE = [192, 64, 128];

  it("sorts translucent draws inside their own run, which a depth clear ends", async () => {
    const rig = build(twoRuns((scene) => scene.clearDepth()));
    await rig.engine.initialize();
    await rig.engine.advance(1);
    expect(rig.pixel(80, 50).slice(0, 3)).toEqual(BLUE_OVER_RED);
    rig.engine.destroy();
  });

  it("ends a run at each of the three state setters as well", async () => {
    for (const divider of [
      (scene: SceneContext): void => scene.setCamera(documentedCamera()),
      (scene: SceneContext): void => scene.setLights([]),
      (scene: SceneContext): void => scene.setMode("unlit"),
    ]) {
      const rig = build(twoRuns(divider));
      await rig.engine.initialize();
      await rig.engine.advance(1);
      expect(rig.pixel(80, 50).slice(0, 3)).toEqual(BLUE_OVER_RED);
      rig.engine.destroy();
    }
  });

  it("still sorts farthest-first within one run, which is what makes the runs matter", async () => {
    // The same three draws with nothing between them: one run, so the farther
    // blue paints first and the nearer red over it — the opposite answer, and
    // the reason the two tests above are not tautologies.
    const rig = build(twoRuns(() => {}));
    await rig.engine.initialize();
    await rig.engine.advance(1);
    expect(rig.pixel(80, 50).slice(0, 3)).toEqual(RED_OVER_BLUE);
    rig.engine.destroy();
  });

  it("records the operations in issue order rather than in the order they painted", async () => {
    // The recording is evidence of what the build issued. Paint order is the
    // renderer's business, re-derived by a player from the recorded state
    // setters and depth clears — so the ops arrive in issue order, and the
    // divider has to be among them, at the position it was issued at.
    const rig = build(twoRuns((scene) => scene.clearDepth()));
    await rig.engine.initialize();
    rig.engine.startRecording();
    await rig.engine.advance(1);
    const recording = rig.engine.stopRecording();
    expect(
      frameOps(recording, 0).map((op) =>
        op.op === "call" ? op.method : op.op,
      ),
    ).toEqual([
      "setMode",
      "drawGeometry",
      "drawGeometry",
      "clearDepth",
      "drawGeometry",
    ]);
    rig.engine.destroy();
  });

  it("draws the same picture from the recording alone as the build drew", async () => {
    // "Frame independence is exact, with no exceptions clause." Taken at its
    // word: a fresh engine blanks its own canvas, applies the frame's inherited
    // state, and re-issues the frame's ops with each `$res` built on demand
    // from its recipe — then the two canvases are compared pixel for pixel,
    // translucent runs, lines, and HUD compositing included.
    const source = build({
      render: (api) => {
        const scene = api.scene;
        scene.setMode("unlit");
        scene.drawGeometry(
          scene.createBox({ x: 12, y: 10, z: 0.2 }),
          "#ffffff",
          at(0, 0, -3),
        );
        const red = scene.createMaterial({
          baseColor: "#ff0000",
          opacity: 0.5,
          unlit: true,
        });
        const blue = scene.createMaterial({
          baseColor: "#0000ff",
          opacity: 0.5,
          unlit: true,
        });
        const quad = scene.createPlane(6, 6);
        scene.drawGeometry(quad, red, facingCamera(3));
        scene.clearDepth();
        scene.drawGeometry(quad, blue, facingCamera(0));
        scene.drawLine(
          [
            { x: -5, y: 2, z: 4 },
            { x: 5, y: 2, z: 4 },
          ],
          "#00ff00",
        );
        scene.drawHudText("SCORE", { x: 6, y: 6 }, { size: 16 });
        scene.drawHudRect({ x: 110, y: 96 }, { x: 40, y: 12 }, "#204080");
      },
    });
    await source.engine.initialize();
    source.engine.startRecording();
    await source.engine.advance(1);
    const recording = source.engine.stopRecording();
    const frame = recording.frames[0];
    if (frame === undefined) return expect.fail("expected a captured frame");

    const player = build({
      render: (api) => {
        const calls = api.scene as unknown as Record<
          string,
          (...args: unknown[]) => unknown
        >;
        const made = new Map<number, unknown>();
        const resolve = (value: DrawValue): unknown => {
          if (value === null || typeof value !== "object") return value;
          if (Array.isArray(value)) return value.map(resolve);
          const object = value as Record<string, DrawValue>;
          const res = object["$res"];
          if (typeof res === "number") {
            if (!made.has(res)) {
              const recipe = recording.resources[res];
              if (recipe === undefined) throw new Error(`no resource ${res}`);
              made.set(
                res,
                calls[recipe.make.method]?.(...recipe.make.args.map(resolve)),
              );
            }
            return made.get(res);
          }
          const out: Record<string, unknown> = {};
          for (const [key, entry] of Object.entries(object))
            out[key] = resolve(entry);
          return out;
        };
        const state = recording.states[frame.state];
        if (state === undefined) throw new Error("no inherited state");
        api.scene.setMode(state.mode);
        api.scene.setCamera(state.camera);
        api.scene.setLights(state.lights);
        for (const index of frame.ops) {
          const op = recording.ops[index];
          if (op?.op !== "call")
            throw new Error("a conforming 3D recording holds calls only");
          calls[op.method]?.(...op.args.map(resolve));
        }
      },
    });
    await player.engine.initialize();
    await player.engine.advance(1);

    // Sampled across the whole picture rather than at one point, so a replay
    // that got the runs right and the lettering wrong still fails.
    for (let y = 2; y < DESIGN_H; y += 7) {
      for (let x = 2; x < DESIGN_W; x += 7) {
        expect({ x, y, rgba: player.pixel(x, y) }).toEqual({
          x,
          y,
          rgba: source.pixel(x, y),
        });
      }
    }
    source.engine.destroy();
    player.engine.destroy();
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Event snapshot semantics, as a game reaches them                        */
/* -------------------------------------------------------------------------- */

describe("event snapshot semantics, as a game reaches them", () => {
  /** An engine that plays one cue per frame, so a test has an event to watch. */
  function beeper(hooks: Hooks = {}): Rig {
    return build({
      ...hooks,
      init: (api) => {
        api.audio.define("beep", { freq: 440, durationMs: 10 });
        hooks.init?.(api);
      },
      update: (api, dt) => {
        api.audio.play("beep");
        hooks.update?.(api, dt);
      },
    });
  }

  it("delivers synchronously, inside the frame the event belongs to", async () => {
    // The point of the bus: a subscriber attributes an event to its frame,
    // which it could not if delivery were deferred to a microtask.
    const seen: number[] = [];
    const rig = beeper();
    rig.engine.events.on("cue:played", (payload) => {
      seen.push(payload.t);
      expect(rig.engine.frame().count).toBe(seen.length);
    });
    await rig.engine.initialize();
    await rig.engine.advance(3);
    expect(seen).toEqual([1000 / 60, 2000 / 60, 3000 / 60]);
    rig.engine.destroy();
  });

  it("still calls a handler that another handler removed during the same dispatch", async () => {
    // Walking the live array would drop it, and which subscriber survived a
    // sibling's teardown would depend on the order they happened to subscribe.
    const order: string[] = [];
    const rig = beeper();
    let offSecond = (): void => {};
    rig.engine.events.on("cue:played", () => {
      order.push("first");
      offSecond();
    });
    offSecond = rig.engine.events.on("cue:played", () => order.push("second"));
    await rig.engine.initialize();
    await rig.engine.advance(1);
    expect(order).toEqual(["first", "second"]);
    // Removed for good, though: the next frame is the first handler alone.
    order.length = 0;
    await rig.engine.advance(1);
    expect(order).toEqual(["first"]);
    rig.engine.destroy();
  });

  it("does not call a handler that subscribed during the dispatch that would have called it", async () => {
    const order: string[] = [];
    const rig = beeper();
    let added = false;
    rig.engine.events.on("cue:played", () => {
      order.push("first");
      if (added) return;
      added = true;
      rig.engine.events.on("cue:played", () => order.push("late"));
    });
    await rig.engine.initialize();
    await rig.engine.advance(1);
    expect(order).toEqual(["first"]);
    order.length = 0;
    await rig.engine.advance(1);
    expect(order).toEqual(["first", "late"]);
    rig.engine.destroy();
  });

  it("contains a throwing handler, so the rest of the frame happens anyway", async () => {
    const order: string[] = [];
    const rig = beeper();
    rig.engine.events.on("cue:played", () => {
      throw new Error("a subscriber's bug");
    });
    rig.engine.events.on("cue:played", () => order.push("after"));
    await rig.engine.initialize();
    await expect(rig.engine.advance(1)).resolves.toBeUndefined();
    expect(order).toEqual(["after"]);
    expect(rig.engine.frame().count).toBe(1);
    rig.engine.destroy();
  });

  it("returns an unsubscriber that is idempotent, because teardown runs twice", async () => {
    const order: string[] = [];
    const rig = beeper();
    const off = rig.engine.events.on("cue:played", () => order.push("a"));
    rig.engine.events.on("cue:played", () => order.push("b"));
    off();
    off();
    await rig.engine.initialize();
    await rig.engine.advance(1);
    expect(order).toEqual(["b"]);
    rig.engine.destroy();
  });

  it("lets one function subscribe twice and removes one copy per unsubscribe", async () => {
    const order: string[] = [];
    const rig = beeper();
    const handler = (): void => void order.push("x");
    const off = rig.engine.events.on("cue:played", handler);
    rig.engine.events.on("cue:played", handler);
    await rig.engine.initialize();
    await rig.engine.advance(1);
    expect(order).toEqual(["x", "x"]);
    off();
    order.length = 0;
    await rig.engine.advance(1);
    expect(order).toEqual(["x"]);
    rig.engine.destroy();
  });

  it("stops every loop at destroy, and announces nothing while doing it", async () => {
    // `apis/audio.md`: "engine.destroy() stops every loop". Teardown is not a
    // transition the game made, so it emits nothing — and the bus is cleared,
    // so a handler that closed over a test's scope cannot outlive the engine.
    const seen: string[] = [];
    const rig = beeper({ update: (api) => api.audio.loop("beep") });
    rig.engine.events.on("cue:stopped", (payload) => seen.push(payload.cue));
    rig.engine.events.on("cue:looped", (payload) =>
      seen.push(`looped:${payload.cue}`),
    );
    await rig.engine.initialize();
    await rig.engine.advance(1);
    expect(seen).toEqual(["looped:beep"]);
    rig.engine.destroy();
    expect(seen).toEqual(["looped:beep"]);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Audio in a host that offers no audio                                    */
/* -------------------------------------------------------------------------- */

describe("audio in a host that offers no audio", () => {
  it("really has no AudioContext, which is what makes the rest of this honest", () => {
    expect(
      (globalThis as { AudioContext?: unknown }).AudioContext,
    ).toBeUndefined();
  });

  it("announces a play at the cue's own gain rather than reporting the silence", async () => {
    // `apis/audio.md`'s error table: "No audio context is available → play and
    // loop emit their events and nothing sounds." The gain the event carries is
    // the cue's nominal gain, so a check can tell a build that reacted from one
    // that did not; the mute bit, and only the mute bit, reports zero.
    const played: number[] = [];
    const rig = build({
      init: (api) => {
        api.audio.define("loud", { freq: 440, durationMs: 10, gain: 0.7 });
        api.audio.define("plain", { freq: 220, durationMs: 10 });
      },
      update: (api) => {
        api.audio.play("loud");
        api.audio.play("plain");
      },
    });
    rig.engine.events.on("cue:played", (payload) => played.push(payload.gain));
    await rig.engine.initialize();
    await rig.engine.advance(1);
    expect(played).toEqual([0.7, 0.2]);
    rig.engine.destroy();
  });

  it("reports gain zero for a muted play, and the cue's gain again once unmuted", async () => {
    const played: number[] = [];
    let muted = true;
    const rig = build({
      init: (api) =>
        api.audio.define("beep", { freq: 440, durationMs: 10, gain: 0.5 }),
      update: (api) => {
        api.audio.setMuted(muted);
        expect(api.audio.muted()).toBe(muted);
        api.audio.play("beep");
        muted = false;
      },
    });
    rig.engine.events.on("cue:played", (payload) => played.push(payload.gain));
    await rig.engine.initialize();
    await rig.engine.advance(2);
    expect(played).toEqual([0, 0.5]);
    rig.engine.destroy();
  });

  it("keeps a cue looping with nothing to loop it through, and stops it exactly once", async () => {
    const log: string[] = [];
    const looping: boolean[] = [];
    let step = 0;
    const rig = build({
      init: (api) => api.audio.define("hum", { freq: 100, durationMs: 10 }),
      update: (api) => {
        step += 1;
        if (step <= 2) api.audio.loop("hum");
        if (step >= 3) api.audio.stop("hum");
        looping.push(api.audio.looping("hum"));
      },
    });
    rig.engine.events.on("cue:looped", (p) =>
      log.push(`looped:${p.cue}:${p.gain}`),
    );
    rig.engine.events.on("cue:stopped", (p) => log.push(`stopped:${p.cue}`));
    await rig.engine.initialize();
    await rig.engine.advance(4);
    // One event per transition, however many calls asked for the same thing.
    expect(log).toEqual(["looped:hum:0.2", "stopped:hum"]);
    expect(looping).toEqual([true, true, false, false]);
    rig.engine.destroy();
  });

  it("unlocks on the first gesture and says so once, though no context follows", async () => {
    // `apis/audio.md`: "`unlocked` becomes `true` on that gesture in every
    // browser, including one that then offers no audio context."
    let unlocks = 0;
    const rig = build();
    rig.engine.events.on("audio:unlocked", () => (unlocks += 1));
    await rig.engine.initialize();
    expect(unlocks).toBe(0);
    rig.events.dispatchEvent(keyEvent("KeyA"));
    rig.events.dispatchEvent(keyEvent("KeyB"));
    rig.events.dispatchEvent(pointerEvent("pointerdown", 1, 1));
    expect(unlocks).toBe(1);
    rig.engine.destroy();
  });

  it("throws on a cue nothing declared, and reads false rather than throwing for looping", async () => {
    const failures: string[] = [];
    const rig = build({
      update: (api) => {
        for (const call of ["play", "loop", "stop"] as const) {
          try {
            api.audio[call]("ghost");
            failures.push(`${call} did not throw`);
          } catch (error) {
            if (!/ghost/.test((error as Error).message))
              failures.push(`${call} did not name it`);
          }
        }
        if (api.audio.looping("ghost") !== false)
          failures.push("looping should read false");
      },
    });
    await rig.engine.initialize();
    await rig.engine.advance(1);
    expect(failures).toEqual([]);
    rig.engine.destroy();
  });

  it("stamps every cue with the frame's simulated time, never with the wall clock", async () => {
    const stamps: number[] = [];
    const rig = build({
      init: (api) =>
        api.audio.define("beep", { freq: 1, durationMs: 1 } satisfies CueSpec),
      update: (api) => api.audio.play("beep"),
    });
    rig.engine.events.on("cue:played", (payload) => stamps.push(payload.t));
    await rig.engine.initialize();
    rig.engine.setClock(new ConstantClock(20));
    await rig.engine.advance(3);
    expect(stamps).toEqual([20, 40, 60]);
    rig.engine.destroy();
  });

  it("decodes a file-backed cue with no context anywhere, and announces it at gain one", async () => {
    // `apis/audio.md`: "Decoding needs no audio context ... `load` resolves once
    // the cue is decoded", and an unmuted file-backed cue reports gain 1.
    const wav = pcmWav([0, 0.5, -0.5, 0], 8_000);
    await overFetch(
      () => new Response(wav.slice()),
      async () => {
        const played: number[] = [];
        const loaded: string[] = [];
        const rig = build({
          init: (api) => void api.audio.load("thud", "audio/thud.wav"),
          update: (api) => api.audio.play("thud"),
        });
        rig.engine.events.on("cue:played", (payload) =>
          played.push(payload.gain),
        );
        rig.engine.events.on("asset:loaded", (payload) =>
          loaded.push(payload.url),
        );
        await rig.engine.initialize();
        await settle();
        await rig.engine.advance(1);
        expect(loaded).toEqual(["assets/audio/thud.wav"]);
        expect(played).toEqual([1]);
        rig.engine.destroy();
      },
    );
  });

  it("resolves loadAudio to an AudioBuffer-shaped value carrying the decoded samples", async () => {
    // The headless half of the same rule: a suite awaits the promise a browser
    // build awaits, and reads channel data, sample rate, and duration off it.
    const wav = pcmWav([0, 1, 0, -1, 0, 1], 4_000);
    await overFetch(
      () => new Response(wav.slice()),
      async () => {
        let decoded: AudioBuffer | null = null;
        const rig = build({
          init: (api) =>
            void api.assets
              .loadAudio("audio/clip.wav")
              .then((b) => (decoded = b)),
        });
        await rig.engine.initialize();
        await settle();
        const buffer = decoded as AudioBuffer | null;
        expect(buffer).not.toBeNull();
        expect(buffer?.sampleRate).toBe(4_000);
        expect(buffer?.numberOfChannels).toBe(1);
        expect(buffer?.length).toBe(6);
        expect(buffer?.duration).toBeCloseTo(6 / 4_000, 9);
        expect(buffer?.getChannelData(0).length).toBe(6);
        rig.engine.destroy();
      },
    );
  });

  it('refuses an asset path that leaves the root, with url "" on the failure event', async () => {
    const failures: Array<{ path: string; url: string }> = [];
    const rejections: string[] = [];
    const rig = build({
      init: (api) => {
        for (const path of [
          "",
          "/models/ship.glb",
          "../secrets.txt",
          "https://x.test/a.glb",
        ]) {
          void api.assets
            .loadTexture(path)
            .catch((error: Error) => rejections.push(error.message));
        }
      },
    });
    rig.engine.events.on("asset:failed", (payload) =>
      failures.push({ path: payload.path, url: payload.url }),
    );
    await rig.engine.initialize();
    await settle();
    expect(failures.map((f) => f.url)).toEqual(["", "", "", ""]);
    expect(rejections).toHaveLength(4);
    rig.engine.destroy();
  });
});

/* -------------------------------------------------------------------------- */
/* 7. The capsule producer                                                    */
/* -------------------------------------------------------------------------- */

describe("the capsule producer", () => {
  /** The logical y a world point on the view axis projects to. */
  function logicalY(worldY: number): number {
    return (
      projectPoint(documentedCamera(), designViewport(), {
        x: 0,
        y: worldY,
        z: 0,
      }) as Vec2
    ).y;
  }

  /** The logical x a world point on the view axis projects to. */
  function logicalX(worldX: number): number {
    return (
      projectPoint(documentedCamera(), designViewport(), {
        x: worldX,
        y: 0,
        z: 0,
      }) as Vec2
    ).x;
  }

  /** An engine drawing one unlit capsule at the origin over black. */
  function capsuleRig(radius: number, height: number): Rig {
    return build(
      {
        render: (api) => {
          api.scene.setMode("unlit");
          api.scene.drawGeometry(
            api.scene.createCapsule(radius, height),
            "#ff0000",
            at(0, 0, 0),
          );
        },
      },
      { background: "#000000" },
    );
  }

  it("bounds the capsule at height/2 + radius on the axis and radius across it", async () => {
    let bounds: Box3 = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    const rig = build({
      render: (api) => (bounds = api.scene.createCapsule(0.5, 4).bounds),
    });
    await rig.engine.initialize();
    await rig.engine.advance(1);
    // `height` is cap-centre to cap-centre, so the extent is height + 2 * radius.
    expect(bounds).toEqual({
      min: { x: -0.5, y: -2.5, z: -0.5 },
      max: { x: 0.5, y: 2.5, z: 0.5 },
    });
    rig.engine.destroy();
  });

  it("tessellates to the silhouette its bounds promise, rather than only declaring it", async () => {
    // A capsule whose declared bounds are right and whose vertices are a
    // cylinder of the wrong length would pass the check above. This one reads
    // the picture, locating each edge with `projectPoint` rather than guessing
    // a pixel: the caps really do add a radius apiece to the axis, and the body
    // really is only a radius wide.
    const radius = 0.5;
    const height = 4;
    const rig = capsuleRig(radius, height);
    await rig.engine.initialize();
    await rig.engine.advance(1);
    const lit = (x: number, y: number): boolean =>
      (rig.pixel(x, y)[0] ?? 0) > 128;

    const rows: number[] = [];
    for (let y = 0; y < DESIGN_H; y += 1) if (lit(80, y)) rows.push(y);
    const columns: number[] = [];
    for (let x = 0; x < DESIGN_W; x += 1) if (lit(x, 60)) columns.push(x);

    const top = logicalY(height / 2 + radius);
    const bottom = logicalY(-(height / 2 + radius));
    expect(rows[0]).toBeGreaterThanOrEqual(top - 2);
    expect(rows[0]).toBeLessThanOrEqual(top + 2);
    expect(rows[rows.length - 1]).toBeGreaterThanOrEqual(bottom - 2);
    expect(rows[rows.length - 1]).toBeLessThanOrEqual(bottom + 2);
    expect(columns[0]).toBeGreaterThanOrEqual(logicalX(-radius) - 2);
    expect(columns[columns.length - 1]).toBeLessThanOrEqual(
      logicalX(radius) + 2,
    );
    rig.engine.destroy();
  });

  it("rounds its caps, which is the refutation a bounds check cannot make", async () => {
    // The declared bounds are the same for a capsule and for a cylinder of the
    // same overall extent, and so is the silhouette's outline. What separates
    // them is the shape *inside* it: a cylinder is full width at every row up
    // to its very top, and a capsule's hemispherical cap narrows all the way.
    const radius = 1.5;
    const height = 2;
    const rig = capsuleRig(radius, height);
    await rig.engine.initialize();
    await rig.engine.advance(1);
    const widthAt = (worldY: number): number => {
      const y = Math.round(logicalY(worldY));
      let count = 0;
      for (let x = 0; x < DESIGN_W; x += 1)
        if ((rig.pixel(x, y)[0] ?? 0) > 128) count += 1;
      return count;
    };

    // The body is full width from the equator up to the cap's own centre, and
    // narrows from there: a cylinder answers the same figure at all five.
    const body = widthAt(0);
    const capCentre = widthAt(height / 2);
    const climb = [0.7, 0.9, 0.95].map((up) =>
      widthAt(height / 2 + radius * up),
    );
    expect(body).toBeGreaterThan(20);
    expect(Math.abs(capCentre - body)).toBeLessThanOrEqual(1);
    expect(climb[0]).toBeLessThan(capCentre);
    expect(climb[1]).toBeLessThan(climb[0] ?? 0);
    expect(climb[2]).toBeLessThan(climb[1] ?? 0);
    expect(climb[2]).toBeGreaterThan(0);
    expect(climb[2]).toBeLessThan(body * 0.6);
    rig.engine.destroy();
  });

  it("records the capsule as a producer, sharing one entry across identical calls", async () => {
    const rig = build({
      render: (api) => {
        api.scene.drawGeometry(
          api.scene.createCapsule(0.25, 1.5),
          "#ffffff",
          at(0, 0, 0),
        );
        api.scene.drawGeometry(
          api.scene.createCapsule(0.25, 1.5),
          "#ffffff",
          at(1, 0, 0),
        );
        api.scene.drawGeometry(
          api.scene.createCapsule(0.25, 2),
          "#ffffff",
          at(2, 0, 0),
        );
      },
    });
    await rig.engine.initialize();
    rig.engine.startRecording();
    await rig.engine.advance(1);
    const recording = rig.engine.stopRecording();
    const capsules = recording.resources.filter(
      (r) => r.make.method === "createCapsule",
    );
    expect(capsules.map((r) => r.make.args)).toEqual([
      [0.25, 1.5],
      [0.25, 2],
    ]);
    for (const capsule of capsules) expect(capsule.then).toEqual([]);
    rig.engine.destroy();
  });

  it("refuses a capsule dimension that is not finite and positive, naming the value", async () => {
    const failures: string[] = [];
    const rig = build({
      render: (api) => {
        for (const [radius, height] of [
          [0, 1],
          [1, -1],
          [Number.NaN, 1],
          [1, Number.POSITIVE_INFINITY],
        ] as const) {
          try {
            api.scene.createCapsule(radius, height);
            failures.push(`createCapsule(${radius}, ${height}) did not throw`);
          } catch (error) {
            if (!(error instanceof RangeError))
              failures.push("not a RangeError");
            if (!/finite and positive/.test((error as Error).message)) {
              failures.push((error as Error).message);
            }
          }
        }
      },
    });
    await rig.engine.initialize();
    await rig.engine.advance(1);
    expect(failures).toEqual([]);
    rig.engine.destroy();
  });

  it("refuses a producer, like every other scene call, from outside render", async () => {
    let stolen: SceneContext | null = null;
    const rig = build({ render: (api) => (stolen = api.scene) });
    await rig.engine.initialize();
    await rig.engine.advance(1);
    const scene = stolen as SceneContext | null;
    expect(() => scene?.createCapsule(1, 1)).toThrow(/outside render/);
    rig.engine.destroy();
  });
});

/* -------------------------------------------------------------------------- */
/* 8. What the recorder promises about values it cannot carry                 */
/* -------------------------------------------------------------------------- */

describe("what the recorder promises about values it cannot carry", () => {
  it("draws the same picture armed as disarmed, for a value that refuses to be classified", async () => {
    // `apis/recording.md`: a value the recorder cannot carry records as
    // `{ $opaque: … }`, "so a build draws the same pixels whether or not
    // anything is being captured". A proxy whose traps refuse `Array.isArray`
    // or `Object.getPrototypeOf` used to throw out of the encoder and therefore
    // out of the draw call itself — but only while armed, which is exactly the
    // asymmetry that sentence rules out.
    const revoked = Proxy.revocable({ x: 1, y: 2 }, {});
    revoked.revoke();
    const refusing = new Proxy(
      { x: 3, y: 4 },
      {
        getPrototypeOf(): never {
          throw new Error("this value declines to say what it is");
        },
      },
    );
    for (const hostile of [revoked.proxy, refusing]) {
      const rig = build({
        render: (api) => {
          api.scene.drawHudRect(
            hostile as unknown as Vec2,
            { x: 1, y: 1 },
            "#ffffff",
          );
          api.scene.drawLine(hostile as unknown as readonly Vec3[], "#ffffff");
          api.scene.drawHudText(
            "ok",
            { x: 1, y: 1 },
            hostile as unknown as HudTextOptions,
          );
        },
      });
      await rig.engine.initialize();
      // Disarmed: the draws skip and the frame survives.
      await expect(rig.engine.advance(1)).resolves.toBeUndefined();
      rig.engine.startRecording();
      // Armed: the same, and every call is in the evidence as a marker.
      await expect(rig.engine.advance(1)).resolves.toBeUndefined();
      const recording = rig.engine.stopRecording();
      const ops = frameOps(recording, 0);
      expect(ops).toHaveLength(3);
      for (const op of ops) {
        if (op.op !== "call") return expect.fail("expected a call");
        expect(
          op.args.some(
            (arg) =>
              arg !== null && typeof arg === "object" && "$opaque" in arg,
          ),
        ).toBe(true);
      }
      rig.engine.destroy();
    }
  });

  it("leaves no asset entry behind when a material's later map cannot be carried", async () => {
    // The tables promise that every entry is one some frame names. A material
    // degrades whole when one of its maps cannot be captured — so the maps
    // captured on the way have to be rolled back with it, rather than sitting
    // in `assets` unreferenced and spending the byte budget on pixels nothing
    // can resolve.
    //
    // Driven against the `Scene` the engine owns rather than through
    // `createEngine`, because filling the 16 MB budget needs a texture whose
    // *file* is enormous and whose pixels are never decoded — which is a
    // registration, not a load.
    const { material } = await loadTwoMapMaterial(png(4, 4), png(600, 600));
    const scene = new Scene({
      width: DESIGN_W,
      height: DESIGN_H,
      background: null,
    });
    const filler = registeredFile(
      "textures/filler.png",
      new Uint8Array(11_700_000),
    );

    scene.startRecording();
    scene.beginFrame({ width: DESIGN_W, height: DESIGN_H });
    scene.enterRender();
    scene.drawBillboard(filler, { x: 0, y: 0, z: 0 }, { x: 1, y: 1 });
    scene.drawGeometry(scene.createPlane(1, 1), material, at(0, 0, 0));
    scene.exitRender();
    scene.endFrame({ count: 1, timeMs: 16, deltaMs: 16 });
    const recording = scene.stopRecording();

    // The material degraded, so nothing of it is in the tables — including the
    // small base-colour map that was captured before the big one was refused.
    expect(recording.assets.map((asset) => asset.path)).toEqual([
      "textures/filler.png",
    ]);
    expect(namedAssets(recording)).toEqual(new Set([0]));
  });

  it("captures a material whole when every map fits, so the rollback fires only on failure", async () => {
    const { material } = await loadTwoMapMaterial(png(4, 4), png(8, 8));
    const scene = new Scene({
      width: DESIGN_W,
      height: DESIGN_H,
      background: null,
    });
    scene.startRecording();
    scene.beginFrame({ width: DESIGN_W, height: DESIGN_H });
    scene.enterRender();
    scene.drawGeometry(scene.createPlane(1, 1), material, at(0, 0, 0));
    scene.exitRender();
    scene.endFrame({ count: 1, timeMs: 16, deltaMs: 16 });
    const recording = scene.stopRecording();

    const captured = recording.assets.find(
      (asset): asset is Extract<CapturedAsset, { kind: "material" }> =>
        asset.kind === "material",
    );
    expect(captured?.path).toBe("materials/hull/material.json");
    expect(Object.keys(captured?.maps ?? {}).sort()).toEqual([
      "baseColor",
      "normal",
    ]);
    expect(namedAssets(recording).size).toBe(recording.assets.length);
  });
});

/** A registered file-backed texture whose "file" is the given bytes. */
function registeredFile(path: string, bytes: Uint8Array): TextureHandle {
  const handle: TextureHandle = Object.freeze({ path, width: 1, height: 1 });
  registerTexture(handle, {
    bytes,
    pixels: new Uint8Array(4),
    width: 1,
    height: 1,
  });
  return handle;
}

/** A loaded two-map material document, over a stubbed fetch. */
async function loadTwoMapMaterial(
  base: Uint8Array,
  normal: Uint8Array,
): Promise<{ material: MaterialHandle }> {
  const document = JSON.stringify({
    maps: [
      { name: "base-color", path: "base.png" },
      { name: "normal", path: "normal.png" },
    ],
  });
  const loader = new AssetLoader({
    fetch: (url: string) =>
      Promise.resolve(
        new Response(
          url.endsWith(".json")
            ? document
            : (url.endsWith("normal.png") ? normal : base).slice(),
        ),
      ),
  });
  return {
    material: await loader.loadMaterial("materials/hull/material.json"),
  };
}

/* -------------------------------------------------------------------------- */
/* The same Exports claim, made to the compiler                               */
/* -------------------------------------------------------------------------- */

/**
 * Every documented type, named through the root specifier alone.
 *
 * Nothing here runs. The file is typechecked separately from `tsc -b`, which
 * excludes the test files, and a type the docs promise that the barrel stopped
 * re-exporting fails to resolve. Exported so it is a declaration rather than an
 * unused local.
 */
export type AuditedTypes = [
  EngineOptions<unknown, unknown>,
  SurfaceMetrics,
  Engine<unknown, unknown>,
  RunOptions,
  Transition<unknown>,
  DeepReadonly<{ a: 1 }>,
  Game<unknown, unknown>,
  InitApi<unknown>,
  UpdateApi,
  RenderApi,
  SceneContext,
  DrawMeshOptions,
  MaterialLike,
  MaterialSpec,
  Material,
  Geometry,
  HudTextOptions,
  EngineEvents,
  EngineEventMap,
  FrameInfo,
  Clock,
  PacedClockOptions,
  Vec2,
  Vec3,
  Quat,
  Transform,
  Box3,
  Ray,
  CameraState,
  Viewport,
  ActionKind,
  ActionBinding,
  RegisteredAction,
  TouchLayout,
  PointerSampleType,
  PointerSample,
  PointerSnapshot,
  CueSpec,
  AudioState,
  MeshHandle,
  TextureHandle,
  MaterialHandle,
  MaterialMapSlot,
  FrameMetrics,
  Recording,
  RecordedFrame,
  RenderState,
  RenderMode,
  LightState,
  Color,
  DrawOp,
  DrawValue,
  CapturedAsset,
  Resource,
  ResourceOp,
];

/** Every documented function, bound so a changed signature is a compile error. */
export const AUDITED_FUNCTIONS = [
  createEngine,
  vec3Add,
  vec3Sub,
  vec3Scale,
  vec3Dot,
  vec3Cross,
  vec3Length,
  vec3Normalize,
  quatFromAxisAngle,
  quatMultiply,
  rotateVec3,
  transformPoint,
  projectPoint,
  pointerRay,
  fitViewport,
  syncCanvas,
] as const;
