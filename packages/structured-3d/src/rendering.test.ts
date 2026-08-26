import { createCanvas } from "@test-cabinet/headless-webgl2";
import { describe, expect, it } from "vitest";
import { Actor } from "./actors";
import { AssetLoader } from "./assets";
import type { MeshHandle, TextureHandle } from "./assets";
import {
  AmbientLightComponent,
  CameraComponent,
  DirectionalLightComponent,
  Component,
  DrawComponent,
  MeshComponent,
  PointLightComponent,
  ShapeComponent,
  TextComponent,
  type DrawApi,
} from "./components";
import { ColliderComponent } from "./collision";
import type { CameraState, Quat, Transform, Vec3 } from "./math";
import { quatFromAxisAngle } from "./math";
import type { DrawOp, DrawValue, Recording, RenderMode } from "./contract";
import {
  EngineSceneContext,
  RenderPipeline,
  SceneRenderer,
  type RenderScene,
  type SceneEnvelope,
} from "./rendering";

/**
 * The pipeline, the scene context, and the WebGL2 back end, driven exactly as
 * the engine drives them: a frame is `openFrame`, `render`, `closeFrame` over a
 * world of hand-built actors, and every claim is stated in one of the two
 * places the docs state claims in — the recorded operation stream, which says
 * what the pipeline issued and under what camera, lights, and mode, or a pixel
 * read back off the canvas, which says what the picture is.
 *
 * The canvas is `@test-cabinet/headless-webgl2`'s, so the renderer's own
 * shaders are compiled and its triangles rasterized in process: constructing a
 * `SceneRenderer` at all is what proves the fixed shaders stay inside the
 * documented GLSL ES 3.00 subset, and the pixel checks are what prove they mean
 * what they say. The world behind the pipeline is a fake — the two members the
 * pipeline reads, `camera` and `actors()` — because the world's own transition
 * and spawn behavior belongs to `worlds.test.ts`, and the recorder's encoding
 * corners belong to `recording.test.ts`; here the recording is used only as the
 * lens the docs point a validator at.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** The identity camera state — the fresh engine's, which the docs fix. */
function defaultCamera(): CameraState {
  return {
    position: { x: 0, y: 0, z: 10 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    fovY: Math.PI / 3,
    near: 0.1,
    far: 1000,
  };
}

/**
 * The camera seam the pipeline reads: a follow target, the `adopt` step 1
 * performs, and the snapshot step 2 sets. Kept as plain state so a test can
 * both pose the view and read back what the pipeline adopted into it.
 */
class FakeCamera {
  target: Actor | null = null;
  state: CameraState = defaultCamera();
  adopted: { position: Vec3; rotation: Quat; fovY: number }[] = [];

  adopt(position: Vec3, rotation: Quat, fovY: number): void {
    this.adopted.push({ position, rotation, fovY });
    this.state = { ...this.state, position, rotation, fovY };
  }

  snapshot(): CameraState {
    return {
      position: { ...this.state.position },
      rotation: { ...this.state.rotation },
      fovY: this.state.fovY,
      near: this.state.near,
      far: this.state.far,
    };
  }
}

/** A `DrawComponent` whose `draw` is the closure the test hands it. */
class ScriptedDraw extends DrawComponent {
  constructor(private readonly body: (api: DrawApi) => void) {
    super();
  }

  draw(api: DrawApi): void {
    this.body(api);
  }
}

/**
 * A collider-shaped component, duck-typed exactly as the overlay reads one:
 * a shape, a channel, declared responses, and a world transform. It extends
 * `Component` rather than `RenderComponent` because a collider is not part of
 * the picture — the overlay is what draws it, and only while the switch is on.
 */
class FakeCollider extends Component {
  constructor(
    readonly shape:
      | { kind: "box"; size: Vec3 }
      | { kind: "sphere"; radius: number },
    readonly responses: Record<string, string>,
    readonly channel = "default",
  ) {
    super();
  }
}

interface HarnessOptions {
  /** The logical design size, which is also the backing store unless a fit says otherwise. */
  size?: { width: number; height: number };
  /** The canvas backing store, in device pixels. Defaults to the design size. */
  surface?: { width: number; height: number };
  /** The fit. Defaults to the identity fit — one device pixel per logical unit, no bars. */
  viewport?: {
    width: number;
    height: number;
    scale: number;
    offsetX: number;
    offsetY: number;
  };
  background?: string | null;
}

/**
 * One engine's rendering half: the canvas, the back end, the engine-owned scene
 * context, and the pipeline over them, wired the way the engine wires them.
 *
 * The actor list is the test's own array, in spawn order, because that is the
 * order the pipeline's sort names; `frame()` runs the whole documented bracket
 * so a recorded frame carries exactly what a real one would.
 */
function harnessWith(options: HarnessOptions = {}) {
  const size = options.size ?? { width: 64, height: 64 };
  const surface = options.surface ?? { ...size };
  const viewport = options.viewport ?? {
    width: size.width,
    height: size.height,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
  const background =
    options.background === undefined ? "#101020" : options.background;

  const canvas = createCanvas(surface.width, surface.height);
  const gl = canvas.getContext("webgl2") as unknown as WebGL2RenderingContext;
  const renderer = new SceneRenderer(gl);
  const envelope: SceneEnvelope = {
    width: size.width,
    height: size.height,
    background,
  };
  const scene = new EngineSceneContext(renderer, () => envelope);
  const pipeline = new RenderPipeline(scene, renderer);

  const camera = new FakeCamera();
  const actors: Actor[] = [];
  let count = 0;

  const frame = (): void => {
    count += 1;
    scene.openFrame(surface);
    const renderScene: RenderScene = {
      world: { camera, actors: () => actors },
      viewport,
      surface,
      frame: { count, timeMs: count * 16, lastDeltaMs: 16 },
      background,
    };
    pipeline.render(renderScene);
    scene.closeFrame({ count, timeMs: count * 16, deltaMs: 16 });
  };

  return {
    canvas,
    gl,
    renderer,
    scene,
    pipeline,
    camera,
    actors,
    frame,
    /** Arm the recorder, run `frames` frames, and hand back the document. */
    record(frames = 1): Recording {
      scene.startRecording();
      for (let i = 0; i < frames; i++) frame();
      return scene.stopRecording();
    },
    /** One pixel in logical coordinates, through the fit, with the row flip `readPixels` needs. */
    sample(
      x: number,
      y: number,
    ): { r: number; g: number; b: number; a: number } {
      const deviceX = Math.round(viewport.offsetX + x * viewport.scale);
      const deviceY = Math.round(viewport.offsetY + y * viewport.scale);
      const data = new Uint8Array(4);
      gl.readPixels(
        deviceX,
        surface.height - 1 - deviceY,
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        data,
      );
      return {
        r: data[0] ?? 0,
        g: data[1] ?? 0,
        b: data[2] ?? 0,
        a: data[3] ?? 0,
      };
    },
    /** One device pixel, addressed from the top-left of the backing store. */
    device(
      x: number,
      y: number,
    ): { r: number; g: number; b: number; a: number } {
      const data = new Uint8Array(4);
      gl.readPixels(
        x,
        surface.height - 1 - y,
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        data,
      );
      return {
        r: data[0] ?? 0,
        g: data[1] ?? 0,
        b: data[2] ?? 0,
        a: data[3] ?? 0,
      };
    },
  };
}

/** A frame's operations, resolved out of the shared table, in issue order. */
function opsOf(
  recording: Recording,
  frame = 0,
): Extract<DrawOp, { op: "call" }>[] {
  const entry = recording.frames[frame];
  if (entry === undefined)
    throw new Error(`the recording holds no frame ${frame}`);
  return entry.ops.map((index) => {
    const op = recording.ops[index];
    if (op === undefined || op.op !== "call")
      throw new Error("a frame named an operation the recording does not hold");
    return op;
  });
}

/** Just the method names a frame issued, which is what the order claims are about. */
function methodsOf(recording: Recording, frame = 0): string[] {
  return opsOf(recording, frame).map((op) => op.method);
}

/** The one operation of `method` a frame issued, refusing an ambiguous read. */
function onlyCall(
  recording: Recording,
  method: string,
  frame = 0,
): Extract<DrawOp, { op: "call" }> {
  const found = opsOf(recording, frame).filter((op) => op.method === method);
  if (found.length !== 1) {
    throw new Error(
      `the frame issued ${found.length} ${method} calls, not one`,
    );
  }
  return found[0]!;
}

/** A recorded argument as a plain record, for field reads. */
function fields(value: DrawValue | undefined): Record<string, DrawValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("the argument is not a plain object");
  }
  return value as Record<string, DrawValue>;
}

/**
 * A mesh and a texture handle carrying real decoded payloads, loaded through
 * the asset loader over a scripted fetcher — the only route that parks the
 * decoded bytes where the renderer and the recorder look for them.
 */
async function loadFixtures(): Promise<{
  mesh: MeshHandle;
  texture: TextureHandle;
}> {
  const loader = new AssetLoader({
    root: "assets/",
    fetch: (url: string) => {
      const bytes = url.endsWith(".glb") ? triangleGlb() : onePixelPng();
      return Promise.resolve({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob([Uint8Array.from(bytes)])),
        arrayBuffer: () => Promise.resolve(Uint8Array.from(bytes).buffer),
      } as unknown as Response);
    },
  });
  const [mesh, texture] = await Promise.all([
    loader.loadMesh("models/ship.glb"),
    loader.loadTexture("textures/dot.png"),
  ]);
  return { mesh, texture };
}

/** A 1×1 opaque-white 8-bit RGBA PNG, written with a stored deflate block. */
function onePixelPng(): Uint8Array {
  const raw = Uint8Array.from([0, 255, 255, 255, 255]);
  const zlib = new Uint8Array(2 + 5 + raw.length + 4);
  zlib.set([0x78, 0x01, 1, raw.length & 0xff, 0, ~raw.length & 0xff, 0xff], 0);
  zlib.set(raw, 7);
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  zlib.set(
    [(b >> 8) & 0xff, b & 0xff, (a >> 8) & 0xff, a & 0xff],
    7 + raw.length,
  );

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 1);
  view.setUint32(4, 1);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return pngOf([
    ["IHDR", ihdr],
    ["IDAT", zlib],
    ["IEND", new Uint8Array(0)],
  ]);
}

/** PNG chunks behind the signature, with the CRCs this package's decoder does not read. */
function pngOf(chunks: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const size = chunks.reduce((sum, [, body]) => sum + 12 + body.length, 8);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  let at = 8;
  for (const [type, body] of chunks) {
    view.setUint32(at, body.length);
    for (let i = 0; i < 4; i++) out[at + 4 + i] = type.charCodeAt(i);
    out.set(body, at + 8);
    at += 12 + body.length;
  }
  return out;
}

/**
 * A glTF binary holding one triangle on one node, and one animation named
 * `walk` that slides the node — enough for a mesh handle to carry a clip a
 * component can name and the renderer can pose from.
 */
function triangleGlb(): Uint8Array {
  const data = Float32Array.from([
    // POSITION ×3
    -1, -1, 0, 1, -1, 0, 0, 1, 0,
    // the clip's key times
    0, 1,
    // the clip's translations
    0, 0, 0, 0, 1, 0,
  ]);
  const bin = new Uint8Array(data.buffer.slice(0));
  const json = {
    asset: { version: "2.0" },
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: 2, type: "SCALAR" },
      { bufferView: 2, componentType: 5126, count: 2, type: "VEC3" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 8 },
      { buffer: 0, byteOffset: 44, byteLength: 24 },
    ],
    buffers: [{ byteLength: bin.length }],
    animations: [
      {
        name: "walk",
        channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
        samplers: [{ input: 1, output: 2 }],
      },
    ],
  };
  const raw = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = (raw.length + 3) & ~3;
  const binPadded = (bin.length + 3) & ~3;
  const out = new Uint8Array(12 + 8 + jsonPadded + 8 + binPadded);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(raw, 20);
  out.fill(0x20, 20 + raw.length, 20 + jsonPadded);
  const binStart = 20 + jsonPadded;
  view.setUint32(binStart, binPadded, true);
  view.setUint32(binStart + 4, 0x004e4942, true);
  out.set(bin, binStart + 8);
  return out;
}

/** An actor at a position, so a placement reads as one line in a test. */
function actorAt(position: Partial<Vec3>): Actor {
  const actor = new Actor();
  Object.assign(actor.transform.position, position);
  return actor;
}

/* -------------------------------------------------------------------------- */
/* The scene context's vocabulary                                             */
/* -------------------------------------------------------------------------- */

describe("the scene context", () => {
  it("refuses a draw call from outside the pipeline's drawing, naming the rule", () => {
    const h = harnessWith();

    expect(() =>
      h.scene.drawHudRect({ x: 0, y: 0 }, { x: 1, y: 1 }, "#fff"),
    ).toThrow(Error);
    expect(() =>
      h.scene.drawHudRect({ x: 0, y: 0 }, { x: 1, y: 1 }, "#fff"),
    ).toThrow(/drawHudRect was called outside the render pipeline/);
  });

  it("refuses a producer called from outside the pipeline's drawing", () => {
    const h = harnessWith();

    expect(() => h.scene.createSphere(1)).toThrow(
      /createSphere was called outside the render pipeline/,
    );
  });

  it("refuses setCamera, setLights, setMode, and clearDepth from a DrawComponent's draw", () => {
    const h = harnessWith();
    const refusals: string[] = [];
    const actor = new Actor();
    actor.attach(
      new ScriptedDraw((api) => {
        for (const attempt of [
          (): void => api.scene.setCamera(defaultCamera()),
          (): void => api.scene.setLights([]),
          (): void => api.scene.setMode("unlit"),
          (): void => api.scene.clearDepth(),
        ]) {
          try {
            attempt();
            refusals.push("allowed");
          } catch (error) {
            refusals.push(
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      }),
    );
    h.actors.push(actor);

    h.frame();

    expect(refusals).toHaveLength(4);
    for (const message of refusals) {
      expect(message).toMatch(/belong to the pipeline/);
    }
    expect(refusals[0]).toMatch(
      /^setCamera was called from a DrawComponent's draw/,
    );
    expect(refusals[3]).toMatch(
      /^clearDepth was called from a DrawComponent's draw/,
    );
  });

  it("refuses a mode outside RenderMode, naming every valid mode", () => {
    const h = harnessWith();
    let thrown: unknown;
    const actor = new Actor();
    actor.attach(
      new ScriptedDraw((api) => {
        try {
          (api.scene as { setMode(mode: RenderMode): void }).setMode(
            "shaded" as RenderMode,
          );
        } catch (error) {
          thrown = error;
        }
      }),
    );
    h.actors.push(actor);

    h.frame();

    // The refusal a DrawComponent meets first is the ownership rule; the mode
    // vocabulary is what `engine.renderer` refuses.
    expect(String(thrown)).toMatch(/belong to the pipeline/);
    expect(() => h.pipeline.setMode("shaded" as RenderMode)).toThrow(
      /"standard", "wireframe", "unlit", and "normals"/,
    );
  });

  it("refuses a producer dimension that is not finite and positive, naming the value", () => {
    const h = harnessWith();
    const refusals: { error: unknown }[] = [];
    const actor = new Actor();
    actor.attach(
      new ScriptedDraw((api) => {
        for (const attempt of [
          (): unknown => api.scene.createBox({ x: 1, y: 0, z: 1 }),
          (): unknown => api.scene.createSphere(-2),
          (): unknown => api.scene.createCylinder(1, Number.NaN),
          (): unknown => api.scene.createCapsule(1, Number.POSITIVE_INFINITY),
          (): unknown => api.scene.createPlane(0, 1),
        ]) {
          try {
            attempt();
          } catch (error) {
            refusals.push({ error });
          }
        }
      }),
    );
    h.actors.push(actor);

    h.frame();

    expect(refusals).toHaveLength(5);
    for (const { error } of refusals) expect(error).toBeInstanceOf(RangeError);
    expect(String(refusals[0]?.error)).toMatch(
      /createBox size.y must be finite and positive, got 0/,
    );
    expect(String(refusals[1]?.error)).toMatch(
      /createSphere radius must be finite and positive, got -2/,
    );
    expect(String(refusals[4]?.error)).toMatch(
      /createPlane width must be finite and positive, got 0/,
    );
  });

  it("refuses createMaterial with roughness, metallic, or opacity outside 0 to 1", () => {
    const h = harnessWith();
    const refusals: unknown[] = [];
    const actor = new Actor();
    actor.attach(
      new ScriptedDraw((api) => {
        for (const spec of [
          { roughness: 1.5 },
          { metallic: -0.1 },
          { opacity: Number.NaN },
        ]) {
          try {
            api.scene.createMaterial(spec);
          } catch (error) {
            refusals.push(error);
          }
        }
      }),
    );
    h.actors.push(actor);

    h.frame();

    expect(refusals.map((error) => error instanceof RangeError)).toEqual([
      true,
      true,
      true,
    ]);
    expect(String(refusals[0])).toMatch(/createMaterial roughness .* got 1.5/);
    expect(String(refusals[1])).toMatch(/createMaterial metallic .* got -0.1/);
    expect(String(refusals[2])).toMatch(/createMaterial opacity .* got NaN/);
  });

  it("gives each produced geometry the local bounds its producer documents", () => {
    const h = harnessWith();
    const bounds: Record<string, { min: Vec3; max: Vec3 }> = {};
    const actor = new Actor();
    actor.attach(
      new ScriptedDraw((api) => {
        bounds["box"] = api.scene.createBox({ x: 2, y: 4, z: 6 }).bounds;
        bounds["sphere"] = api.scene.createSphere(3).bounds;
        bounds["cylinder"] = api.scene.createCylinder(2, 10).bounds;
        bounds["capsule"] = api.scene.createCapsule(1, 4).bounds;
        bounds["plane"] = api.scene.createPlane(8, 2).bounds;
      }),
    );
    h.actors.push(actor);

    h.frame();

    expect(bounds["box"]).toEqual({
      min: { x: -1, y: -2, z: -3 },
      max: { x: 1, y: 2, z: 3 },
    });
    expect(bounds["sphere"]).toEqual({
      min: { x: -3, y: -3, z: -3 },
      max: { x: 3, y: 3, z: 3 },
    });
    expect(bounds["cylinder"]).toEqual({
      min: { x: -2, y: -5, z: -2 },
      max: { x: 2, y: 5, z: 2 },
    });
    // A capsule's extent along its axis is `height + 2 * radius`.
    expect(bounds["capsule"]).toEqual({
      min: { x: -1, y: -3, z: -1 },
      max: { x: 1, y: 3, z: 1 },
    });
    expect(bounds["plane"]).toEqual({
      min: { x: -4, y: 0, z: -1 },
      max: { x: 4, y: 0, z: 1 },
    });
  });

  it("records a draw carrying a non-finite number and draws nothing for it", () => {
    const h = harnessWith();
    const actor = new Actor();
    actor.attach(
      new ScriptedDraw((api) => {
        api.scene.drawHudRect(
          { x: Number.NaN, y: 0 },
          { x: 64, y: 64 },
          "#00ff00",
        );
      }),
    );
    h.actors.push(actor);

    const recording = h.record();

    expect(methodsOf(recording)).toContain("drawHudRect");
    // The picture is the background alone: the call was recorded and skipped.
    expect(h.sample(32, 32)).toEqual({ r: 0x10, g: 0x10, b: 0x20, a: 255 });
  });

  it("refuses a drawMesh clip the mesh does not carry, naming the clip and the clips it has", async () => {
    const { mesh } = await loadFixtures();
    const h = harnessWith();
    let thrown: unknown;
    const actor = new Actor();
    actor.attach(
      new ScriptedDraw((api) => {
        try {
          api.scene.drawMesh(mesh, identityTransform(), { clip: "sprint" });
        } catch (error) {
          thrown = error;
        }
      }),
    );
    h.actors.push(actor);

    h.frame();

    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toMatch(/clip "sprint"/);
    expect(String(thrown)).toMatch(/models\/ship\.glb/);
  });
});

/** The identity transform, spelled out where a draw call needs one. */
function identityTransform(): Transform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

/* -------------------------------------------------------------------------- */
/* The pipeline's eight steps                                                 */
/* -------------------------------------------------------------------------- */

describe("the pipeline", () => {
  it("sets the mode, the camera, and the lights at the top of every frame, in that order", () => {
    const h = harnessWith();

    const recording = h.record();

    expect(methodsOf(recording).slice(0, 3)).toEqual([
      "setMode",
      "setCamera",
      "setLights",
    ]);
  });

  it("states the frame's camera, lights, and mode in the state the frame inherited", () => {
    const h = harnessWith();
    h.pipeline.setMode("unlit");

    const recording = h.record(2);
    const state = recording.states[recording.frames[1]?.state ?? 0];

    // The second frame inherits what the first frame's own state calls left
    // behind, which is the whole point of the inherited block.
    expect(state?.mode).toBe("unlit");
    expect(state?.camera.fovY).toBeCloseTo(Math.PI / 3, 6);
    expect(state?.lights.map((light) => light.type)).toEqual([
      "ambient",
      "directional",
    ]);
  });

  it("collects only the enabled, visible render components on live actors", () => {
    const h = harnessWith();
    const drawn: string[] = [];
    const marker = (name: string): ScriptedDraw =>
      new ScriptedDraw(() => {
        drawn.push(name);
      });

    const visible = new Actor();
    visible.attach(marker("visible"));
    const hidden = new Actor();
    hidden.attach(marker("hidden")).visible = false;
    const disabled = new Actor();
    disabled.attach(marker("disabled")).enabled = false;
    const destroyed = new Actor();
    destroyed.attach(marker("destroyed"));
    (destroyed as { alive: boolean }).alive = false;
    h.actors.push(visible, hidden, disabled, destroyed);

    h.frame();

    expect(drawn).toEqual(["visible"]);
  });

  it("sorts by layer ascending, then by spawn order, then by attachment order, stably", () => {
    const h = harnessWith();
    const drawn: string[] = [];
    const marker = (name: string, layer: number): ScriptedDraw => {
      const component = new ScriptedDraw(() => {
        drawn.push(name);
      });
      component.layer = layer;
      return component;
    };

    const first = new Actor();
    first.attach(marker("first.hud", 1));
    first.attach(marker("first.scene", 0));
    const second = new Actor();
    second.attach(marker("second.scene", 0));
    second.attach(marker("second.hud", 1));
    h.actors.push(first, second);

    h.frame();
    const once = [...drawn];
    drawn.length = 0;
    h.frame();

    expect(once).toEqual([
      "first.scene",
      "second.scene",
      "first.hud",
      "second.hud",
    ]);
    // "A redraw with no change reproduces the previous order exactly."
    expect(drawn).toEqual(once);
  });

  it("clears the depth buffer before each layer, through the vocabulary", () => {
    const h = harnessWith();
    const marker = (name: string, layer: number): ScriptedDraw => {
      const component = new ScriptedDraw((api) => {
        api.scene.drawLine(
          [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
          ],
          name,
        );
      });
      component.layer = layer;
      return component;
    };
    const actor = new Actor();
    actor.attach(marker("#ff0000", 0));
    actor.attach(marker("#00ff00", 2));
    h.actors.push(actor);

    const recording = h.record();

    expect(methodsOf(recording)).toEqual([
      "setMode",
      "setCamera",
      "setLights",
      "clearDepth",
      "drawLine",
      "clearDepth",
      "drawLine",
    ]);
  });

  it("draws a layer's translucent components after its opaque ones, farthest from the camera first", () => {
    const h = harnessWith();
    const drawn: string[] = [];
    const marker = (name: string, z: number, opacity: number): Actor => {
      const actor = actorAt({ z });
      const component = new ScriptedDraw(() => {
        drawn.push(name);
      });
      component.opacity = opacity;
      actor.attach(component);
      return actor;
    };

    h.actors.push(
      marker("near-fade", 4, 0.5),
      marker("solid", 0, 1),
      marker("far-fade", -20, 0.4),
    );

    h.frame();

    expect(drawn).toEqual(["solid", "far-fade", "near-fade"]);
  });

  it("adopts the view target's first enabled CameraComponent's world pose and fovY", () => {
    const h = harnessWith();
    const target = actorAt({ x: 3, y: 1, z: -2 });
    const off = target.attach(new CameraComponent({ fovY: 1 }));
    off.enabled = false;
    target.attach(new CameraComponent({ fovY: Math.PI / 4 }));
    h.actors.push(target);
    h.camera.target = target;

    h.frame();

    expect(h.camera.adopted).toHaveLength(1);
    expect(h.camera.adopted[0]?.position).toEqual({ x: 3, y: 1, z: -2 });
    expect(h.camera.adopted[0]?.fovY).toBeCloseTo(Math.PI / 4, 12);
  });

  it("leaves the camera where it is when the target holds no camera component", () => {
    const h = harnessWith();
    const target = actorAt({ x: 5 });
    h.actors.push(target);
    h.camera.target = target;

    h.frame();

    expect(h.camera.adopted).toEqual([]);
  });

  it("lights a world holding no enabled light with the default rig", () => {
    const h = harnessWith();

    const recording = h.record();
    const lights = onlyCall(recording, "setLights").args[0];

    expect(lights).toEqual([
      { type: "ambient", color: "#ffffff", intensity: 0.4 },
      {
        type: "directional",
        color: "#ffffff",
        intensity: 0.8,
        // vec3Normalize({ x: -1, y: -2, z: -1 }), at the format's nine digits.
        direction: { x: -0.40824829, y: -0.816496581, z: -0.40824829 },
      },
    ]);
  });

  it("withdraws the default rig on any frame the world holds an enabled light", () => {
    const h = harnessWith();
    const sun = new Actor();
    const ambient = sun.attach(
      new AmbientLightComponent({ intensity: 0.25, color: "#402020" }),
    );
    h.actors.push(sun);

    const lit = h.record();
    ambient.enabled = false;
    const unlit = h.record();

    expect(onlyCall(lit, "setLights").args[0]).toEqual([
      { type: "ambient", color: "#402020", intensity: 0.25 },
    ]);
    expect((onlyCall(unlit, "setLights").args[0] as DrawValue[]).length).toBe(
      2,
    );
  });

  it("snapshots the enabled lights in spawn order and then attachment order", () => {
    const h = harnessWith();
    const first = new Actor();
    first.attach(new AmbientLightComponent({ intensity: 0.1 }));
    first.attach(new DirectionalLightComponent({ intensity: 0.2 }));
    const second = actorAt({ x: 2, y: 3, z: 4 });
    second.attach(new PointLightComponent({ intensity: 0.3, range: 12 }));
    h.actors.push(first, second);

    const recording = h.record();
    const lights = onlyCall(recording, "setLights").args[0] as Record<
      string,
      DrawValue
    >[];

    expect(lights.map((light) => light["type"])).toEqual([
      "ambient",
      "directional",
      "point",
    ]);
    expect(lights[1]?.["direction"]).toEqual({ x: 0, y: 0, z: -1 });
    expect(lights[2]?.["position"]).toEqual({ x: 2, y: 3, z: 4 });
    expect(lights[2]?.["range"]).toBe(12);
  });

  it("hands a DrawComponent the frame's scene, mode, frame info, viewport, and camera", () => {
    const h = harnessWith({ size: { width: 40, height: 20 } });
    h.pipeline.setMode("normals");
    let seen: {
      mode: RenderMode;
      count: number;
      width: number;
      fovY: number;
    } | null = null;
    const actor = new Actor();
    actor.attach(
      new ScriptedDraw((api) => {
        seen = {
          mode: api.mode,
          count: api.frame().count,
          width: api.viewport().width,
          fovY: api.camera().fovY,
        };
        expect(api.scene).toBe(h.scene);
      }),
    );
    h.actors.push(actor);

    h.frame();

    expect(seen).toEqual({
      mode: "normals",
      count: 1,
      width: 40,
      fovY: Math.PI / 3,
    });
  });

  it("draws under the mode the frame opened in, whatever a later switch says", () => {
    const h = harnessWith();
    const seen: RenderMode[] = [];
    const actor = new Actor();
    actor.attach(
      new ScriptedDraw((api) => {
        seen.push(api.mode);
        h.pipeline.setMode("wireframe");
      }),
    );
    h.actors.push(actor);

    h.frame();
    h.frame();

    // "The next frame the pipeline runs draws under it."
    expect(seen).toEqual(["standard", "wireframe"]);
    expect(h.pipeline.mode()).toBe("wireframe");
  });
});

/* -------------------------------------------------------------------------- */
/* Component lowering                                                         */
/* -------------------------------------------------------------------------- */

describe("component lowering", () => {
  it("issues a MeshComponent as drawMesh with the handle and the component's world transform", async () => {
    const { mesh } = await loadFixtures();
    const h = harnessWith();
    const actor = actorAt({ x: 1, y: 2, z: 3 });
    actor.attach(new MeshComponent({ mesh }));
    h.actors.push(actor);

    const recording = h.record();
    const call = onlyCall(recording, "drawMesh");

    expect(call.args[0]).toEqual({ $asset: 0 });
    expect(recording.assets[0]?.path).toBe("models/ship.glb");
    expect(fields(call.args[1])["position"]).toEqual({ x: 1, y: 2, z: 3 });
    // No tint and full opacity: the file's own materials, so no options at all.
    expect(call.args).toHaveLength(2);
  });

  it("carries a MeshComponent's clip and clip time into the draw's options", async () => {
    const { mesh } = await loadFixtures();
    const h = harnessWith();
    const actor = new Actor();
    const component = actor.attach(new MeshComponent({ mesh }));
    expect(mesh.clips).toEqual(["walk"]);
    component.clip = "walk";
    component.clipTime = 0.75;
    h.actors.push(actor);

    const recording = h.record();
    const options = fields(onlyCall(recording, "drawMesh").args[2]);

    expect(options["clip"]).toBe("walk");
    expect(options["clipTime"]).toBe(0.75);
  });

  it("folds a MeshComponent's tint and opacity into a material the vocabulary produced", async () => {
    const { mesh } = await loadFixtures();
    const h = harnessWith();
    const actor = new Actor();
    const component = actor.attach(
      new MeshComponent({ mesh, color: "#ff8800" }),
    );
    component.opacity = 0.25;
    h.actors.push(actor);

    const recording = h.record();
    const options = fields(onlyCall(recording, "drawMesh").args[2]);
    const resource =
      recording.resources[(options["material"] as { $res: number }).$res];

    expect(resource?.make.method).toBe("createMaterial");
    expect(fields(resource?.make.args[0])).toEqual({
      baseColor: "#ff8800",
      opacity: 0.25,
    });
    expect(resource?.then).toEqual([]);
  });

  it("issues a ShapeComponent through the producers with the scale rules already applied", () => {
    const h = harnessWith();
    const boxActor = new Actor();
    boxActor.transform.scale = { x: 2, y: 3, z: -1 };
    boxActor.attach(
      new ShapeComponent({
        shape: { kind: "box", size: { x: 1, y: 1, z: 4 } },
      }),
    );
    const sphereActor = new Actor();
    sphereActor.transform.scale = { x: 2, y: 5, z: 1 };
    sphereActor.attach(
      new ShapeComponent({ shape: { kind: "sphere", radius: 0.5 } }),
    );
    const capsuleActor = new Actor();
    capsuleActor.transform.scale = { x: 1, y: 4, z: 3 };
    capsuleActor.attach(
      new ShapeComponent({ shape: { kind: "capsule", radius: 1, height: 2 } }),
    );
    h.actors.push(boxActor, sphereActor, capsuleActor);

    const recording = h.record();
    const makes = opsOf(recording)
      .filter((op) => op.method === "drawGeometry")
      .map(
        (op) =>
          recording.resources[(op.args[0] as { $res: number }).$res]?.make,
      );

    // Per axis for a box; the largest magnitude for a radius; the y factor for
    // a capsule's height.
    expect(makes[0]).toEqual({
      method: "createBox",
      args: [{ x: 2, y: 3, z: 4 }],
    });
    expect(makes[1]).toEqual({ method: "createSphere", args: [2.5] });
    expect(makes[2]).toEqual({ method: "createCapsule", args: [4, 8] });
  });

  it("draws a shape at its world position and rotation, with the scale already in the geometry", () => {
    const h = harnessWith();
    const actor = actorAt({ x: 4 });
    actor.transform.scale = { x: 2, y: 2, z: 2 };
    actor.transform.rotation = quatFromAxisAngle(
      { x: 0, y: 1, z: 0 },
      Math.PI / 2,
    );
    actor.attach(
      new ShapeComponent({
        shape: { kind: "sphere", radius: 1 },
        color: "#123456",
      }),
    );
    h.actors.push(actor);

    const recording = h.record();
    const call = onlyCall(recording, "drawGeometry");

    expect(call.args[1]).toBe("#123456");
    expect(fields(call.args[2])["position"]).toEqual({ x: 4, y: 0, z: 0 });
    expect(fields(call.args[2])["scale"]).toEqual({ x: 1, y: 1, z: 1 });
  });

  it("lowers a TextComponent onto a billboard of a text:-pathed texture", () => {
    const h = harnessWith();
    const actor = actorAt({ y: 2 });
    actor.attach(
      new TextComponent({
        text: "3 - 1",
        font: "0.5px monospace",
        fill: "#f5d76e",
      }),
    );
    h.actors.push(actor);

    const recording = h.record();
    const call = onlyCall(recording, "drawBillboard");
    const asset = recording.assets[(call.args[0] as { $asset: number }).$asset];

    expect(asset?.kind).toBe("texture");
    expect(asset?.path).toBe("text:3 - 1");
    // Each glyph advances half the text height, so five characters at 0.5 world
    // units of height make a quad 1.25 by 0.5.
    expect(call.args[2]).toEqual({ x: 1.25, y: 0.5 });
    expect(fields(call.args[1])["y"]).toBe(2);
  });

  it("issues a TextComponent's quad as a drawLine loop in its fill under wireframe", () => {
    const h = harnessWith();
    h.pipeline.setMode("wireframe");
    const actor = new Actor();
    actor.attach(new TextComponent({ text: "hi", fill: "#40ff40" }));
    h.actors.push(actor);

    const recording = h.record();
    const call = onlyCall(recording, "drawLine");

    expect(methodsOf(recording)).not.toContain("drawBillboard");
    expect(call.args[1]).toBe("#40ff40");
    // A closed loop: four corners with the first repeated.
    const points = call.args[0] as Record<string, number>[];
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual(points[4]);
  });

  it("keeps one rasterized texture for one string, however many frames draw it", () => {
    const h = harnessWith();
    const actor = new Actor();
    actor.attach(new TextComponent({ text: "score" }));
    h.actors.push(actor);

    const recording = h.record(3);

    expect(recording.assets).toHaveLength(1);
    expect(recording.frames).toHaveLength(3);
  });
});

/* -------------------------------------------------------------------------- */
/* The collision overlay                                                      */
/* -------------------------------------------------------------------------- */

describe("the collision overlay", () => {
  it("draws nothing while the switch is off", () => {
    const h = harnessWith();
    const actor = new Actor();
    actor.attach(
      new FakeCollider({ kind: "sphere", radius: 1 }, { default: "block" }),
    );
    h.actors.push(actor);

    const recording = h.record();

    expect(methodsOf(recording)).toEqual(["setMode", "setCamera", "setLights"]);
    expect(h.pipeline.collisionOverlay()).toBe(false);
  });

  it("clears the depth buffer and then outlines every enabled collider", () => {
    const h = harnessWith();
    h.pipeline.setCollisionOverlay(true);
    const actor = new Actor();
    actor.attach(
      new FakeCollider({ kind: "sphere", radius: 1 }, { default: "block" }),
    );
    const disabled = actor.attach(
      new FakeCollider({ kind: "sphere", radius: 2 }, { default: "block" }),
    );
    disabled.enabled = false;
    h.actors.push(actor);

    const recording = h.record();
    const methods = methodsOf(recording);

    expect(h.pipeline.collisionOverlay()).toBe(true);
    // Three great circles for one sphere, behind one depth clear of their own.
    expect(methods.slice(-4)).toEqual([
      "clearDepth",
      "drawLine",
      "drawLine",
      "drawLine",
    ]);
  });

  it("colors an outline by the strongest response the collider declares", () => {
    const h = harnessWith();
    h.pipeline.setCollisionOverlay(true);
    const blocking = new Actor();
    blocking.attach(
      new FakeCollider(
        { kind: "sphere", radius: 1 },
        { ball: "overlap", wall: "block" },
      ),
    );
    const overlapping = new Actor();
    overlapping.attach(
      new FakeCollider(
        { kind: "sphere", radius: 1 },
        { ball: "ignore", trigger: "overlap" },
      ),
    );
    const neither = new Actor();
    neither.attach(
      new FakeCollider({ kind: "sphere", radius: 1 }, { ball: "ignore" }),
    );
    h.actors.push(blocking, overlapping, neither);

    const recording = h.record();
    const colors = opsOf(recording)
      .filter((op) => op.method === "drawLine")
      .map((op) => op.args[1]);

    expect(new Set(colors)).toEqual(new Set(["#ff4040", "#40ff40", "#808080"]));
    expect(colors.slice(0, 3)).toEqual(["#ff4040", "#ff4040", "#ff4040"]);
    expect(colors[colors.length - 1]).toBe("#808080");
  });

  it("recognizes the package's own ColliderComponent, not merely a collider shape", () => {
    const h = harnessWith();
    h.pipeline.setCollisionOverlay(true);
    const actor = actorAt({ y: 2 });
    actor.attach(
      new ColliderComponent({
        shape: { kind: "capsule", radius: 0.5, height: 2 },
        channel: "pawn",
        responses: { wall: "block" },
      }),
    );
    h.actors.push(actor);

    const recording = h.record();
    const lines = opsOf(recording).filter((op) => op.method === "drawLine");

    expect(lines.length).toBeGreaterThan(0);
    expect(new Set(lines.map((op) => op.args[1]))).toEqual(
      new Set(["#ff4040"]),
    );
  });

  it("outlines a box collider as its twelve edges under the actor's rotation", () => {
    const h = harnessWith();
    h.pipeline.setCollisionOverlay(true);
    const actor = actorAt({ x: 1 });
    actor.attach(
      new FakeCollider(
        { kind: "box", size: { x: 2, y: 2, z: 2 } },
        { default: "overlap" },
      ),
    );
    h.actors.push(actor);

    const recording = h.record();
    const lines = opsOf(recording).filter((op) => op.method === "drawLine");

    // Two closed rings plus the four uprights — the box's twelve edges.
    expect(lines).toHaveLength(6);
    const ring = lines[0]?.args[0] as Record<string, number>[];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual({ x: 0, y: -1, z: -1 });
  });
});

/* -------------------------------------------------------------------------- */
/* The picture                                                                */
/* -------------------------------------------------------------------------- */

describe("the picture", () => {
  it("clears the canvas to the background color every frame", () => {
    const h = harnessWith({ background: "#204060" });

    h.frame();

    expect(h.sample(10, 10)).toEqual({ r: 0x20, g: 0x40, b: 0x60, a: 255 });
  });

  it("clears to transparency when the game gave no background", () => {
    const h = harnessWith({ background: null });

    h.frame();

    expect(h.sample(10, 10)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("leaves the letterbox bars cleared outside the picture", () => {
    const h = harnessWith({
      size: { width: 32, height: 32 },
      surface: { width: 64, height: 32 },
      viewport: { width: 32, height: 32, scale: 1, offsetX: 16, offsetY: 0 },
      background: "#000000",
    });
    const actor = new Actor();
    actor.attach(
      new ShapeComponent({
        shape: { kind: "box", size: { x: 100, y: 100, z: 1 } },
        color: "#ffffff",
      }),
    );
    h.actors.push(actor);
    h.pipeline.setMode("unlit");

    h.frame();

    // The wall covers the whole fit, and the bars either side of it stay as the
    // clear left them.
    expect(h.device(32, 16)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(h.device(4, 16)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(h.device(60, 16)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
  });

  it("draws an untextured surface's base color byte-exact under unlit", () => {
    const h = harnessWith();
    const actor = new Actor();
    actor.attach(
      new ShapeComponent({
        shape: { kind: "box", size: { x: 4, y: 4, z: 4 } },
        color: "#f2f5f7",
      }),
    );
    h.actors.push(actor);
    h.pipeline.setMode("unlit");

    h.frame();

    expect(h.sample(32, 32)).toEqual({ r: 0xf2, g: 0xf5, b: 0xf7, a: 255 });
  });

  it("colors a pixel by its world-space surface normal under normals", () => {
    const h = harnessWith();
    const actor = new Actor();
    actor.attach(
      new ShapeComponent({
        shape: { kind: "box", size: { x: 4, y: 4, z: 4 } },
        color: "#f2f5f7",
      }),
    );
    h.actors.push(actor);
    h.pipeline.setMode("normals");

    h.frame();
    const pixel = h.sample(32, 32);

    // The face toward the camera has normal (0, 0, 1), so rgb = (n + 1) / 2 is
    // (0.5, 0.5, 1) — the color of the surface rather than of the material.
    expect(pixel.b).toBe(255);
    expect(Math.abs(pixel.r - 128)).toBeLessThanOrEqual(1);
    expect(pixel.g).toBe(pixel.r);
  });

  it("loses a surface's interior under wireframe, which draws its edges alone", () => {
    const h = harnessWith();
    const actor = new Actor();
    actor.attach(
      new ShapeComponent({
        shape: { kind: "box", size: { x: 8, y: 8, z: 8 } },
        color: "#f2f5f7",
      }),
    );
    h.actors.push(actor);
    /** How much of the canvas the surface's own color covers. */
    const covered = (): number => {
      let count = 0;
      for (let x = 0; x < 64; x++) {
        for (let y = 0; y < 64; y++) {
          const pixel = h.sample(x, y);
          if (pixel.r === 0xf2 && pixel.g === 0xf5 && pixel.b === 0xf7)
            count += 1;
        }
      }
      return count;
    };

    h.pipeline.setMode("unlit");
    h.frame();
    const filled = covered();
    h.pipeline.setMode("wireframe");
    h.frame();
    const edged = covered();

    // The edges are drawn in the component's color, so they survive the count;
    // the face they enclose does not.
    expect(filled).toBeGreaterThan(400);
    expect(edged).toBeGreaterThan(0);
    expect(edged).toBeLessThan(filled / 4);
  });

  it("lights the standard picture, so the same surface reads differently under two rigs", () => {
    const bright = harnessWith();
    const dim = harnessWith();
    for (const h of [bright, dim]) {
      const actor = new Actor();
      actor.attach(
        new ShapeComponent({
          shape: { kind: "box", size: { x: 4, y: 4, z: 4 } },
          color: "#8080ff",
        }),
      );
      h.actors.push(actor);
    }
    const sun = new Actor();
    sun.attach(new AmbientLightComponent({ intensity: 0.1 }));
    dim.actors.push(sun);

    bright.frame();
    dim.frame();

    expect(dim.sample(32, 32).r).toBeLessThan(bright.sample(32, 32).r);
  });

  it("composites a HUD draw above the 3D picture", () => {
    const h = harnessWith();
    const actor = new Actor();
    actor.attach(
      new ShapeComponent({
        shape: { kind: "box", size: { x: 4, y: 4, z: 4 } },
        color: "#f2f5f7",
      }),
    );
    const hud = actor.attach(
      new ScriptedDraw((api) => {
        api.scene.drawHudRect({ x: 0, y: 0 }, { x: 64, y: 64 }, "#00ff00");
      }),
    );
    // Issued first, on the layer under the shape, and still composited over it.
    hud.layer = -1;
    h.actors.push(actor);

    h.frame();

    expect(h.sample(32, 32)).toEqual({ r: 0, g: 255, b: 0, a: 255 });
  });

  it("letters HUD text from the engine's own face", () => {
    const h = harnessWith({ background: "#000000" });
    const actor = new Actor();
    actor.attach(
      new ScriptedDraw((api) => {
        api.scene.drawHudText(
          "HH",
          { x: 0, y: 0 },
          { size: 32, color: "#ffffff" },
        );
      }),
    );
    h.actors.push(actor);

    h.frame();
    let lit = 0;
    for (let x = 0; x < 32; x++) {
      for (let y = 0; y < 32; y++) if (h.sample(x, y).r > 0) lit += 1;
    }

    // Two 8×16 glyph cells scaled to 32 logical units of height: lettering is
    // on the canvas, and it is not the whole box either.
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(32 * 32);
  });

  it("draws nothing at all when the fit is degenerate", () => {
    const h = harnessWith({
      size: { width: 32, height: 32 },
      surface: { width: 32, height: 32 },
      viewport: { width: 32, height: 32, scale: 0, offsetX: 0, offsetY: 0 },
      background: "#000000",
    });
    const actor = new Actor();
    actor.attach(
      new ShapeComponent({
        shape: { kind: "box", size: { x: 100, y: 100, z: 1 } },
        color: "#ffffff",
      }),
    );
    h.actors.push(actor);

    h.frame();

    // The clear still happened — a degenerate fit draws nothing and recovers.
    expect(h.device(16, 16)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
  });

  it("draws a loaded mesh through the same picture", async () => {
    const { mesh } = await loadFixtures();
    const h = harnessWith({ background: "#000000" });
    const actor = actorAt({ z: 0 });
    actor.transform.scale = { x: 3, y: 3, z: 3 };
    const component = actor.attach(
      new MeshComponent({ mesh, color: "#ffffff" }),
    );
    component.layer = 0;
    h.actors.push(actor);
    h.pipeline.setMode("unlit");

    h.frame();

    // The fixture is one triangle spanning the origin; its centroid is above it.
    expect(h.sample(32, 30).r).toBe(255);
  });
});

/* -------------------------------------------------------------------------- */
/* The shaders                                                                */
/* -------------------------------------------------------------------------- */

describe("the fixed shaders", () => {
  it("compile and link inside the documented GLSL ES 3.00 subset", () => {
    const canvas = createCanvas(8, 8);
    const gl = canvas.getContext("webgl2") as unknown as WebGL2RenderingContext;

    // Construction compiles both programs and throws with the info log on a
    // rejected construct, so reaching a renderer at all is the proof.
    expect(() => new SceneRenderer(gl)).not.toThrow();
  });

  it("are proved by a front end that refuses what the subset excludes", () => {
    const canvas = createCanvas(8, 8);
    const gl = canvas.getContext("webgl2") as unknown as WebGL2RenderingContext;
    const shader = gl.createShader(gl.FRAGMENT_SHADER);
    if (shader === null) throw new Error("the context created no shader");

    gl.shaderSource(
      shader,
      `#version 300 es
precision highp float;
uniform sampler2D u_map;
out vec4 o_color;
void main() {
  o_color = texelFetch(u_map, ivec2(0, 0), 0);
}
`,
    );
    gl.compileShader(shader);

    expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS)).toBe(false);
    expect(gl.getShaderInfoLog(shader) ?? "").toMatch(/texelFetch/);
  });
});
