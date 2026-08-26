import { describe, expect, it } from "vitest";
import {
  ASSET_BYTE_LIMIT,
  PRODUCING_METHODS,
  RECORDING_FORMAT,
  SCENE_OP_METHODS,
} from "./contract";
import type { DrawOp, DrawValue, LightState, Recording } from "./contract";
import type { Transform } from "./math";
import type { TextureHandle } from "./assets";
import { AssetLoader, registerTexture } from "./assets";
import { decodePng } from "./png";
import type { SceneContext } from "./scene";
import { Scene, encodePng } from "./scene";
import type { FrameFigures } from "./recording";

/**
 * The recorder as observed through the scene context it is built into: the
 * arm/disarm contract, the frame bracket, the dedup tables and their
 * canonical keys, the value-encoding bounds, and asset capture with its byte
 * budget. Everything is asserted on the `Recording` document itself — the
 * exact format `contract.ts` specifies — because the document is the whole
 * point. Pixels are `renderer.test.ts`'s business.
 */

const SURFACE = { width: 640, height: 360 };

function scene(background: string | null = "#101820"): Scene {
  return new Scene({ width: 320, height: 180, background });
}

/** Runs one whole frame through the bracket. */
function frame(
  target: Scene,
  draw: (s: SceneContext) => void,
  figures: FrameFigures = { count: 0, timeMs: 0, deltaMs: 16 },
): void {
  target.beginFrame(SURFACE);
  target.enterRender();
  try {
    draw(target);
  } finally {
    target.exitRender();
  }
  target.endFrame(figures);
}

const AT: Transform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

/** The ops one frame issued, resolved through the shared table. */
function frameOps(recording: Recording, index: number): DrawOp[] {
  const captured = recording.frames[index];
  if (captured === undefined) throw new Error(`no frame ${index}`);
  return captured.ops.map((i) => {
    const op = recording.ops[i];
    if (op === undefined) throw new Error(`no op ${i}`);
    return op;
  });
}

/** A registered engine-made texture handle over the given pixels. */
function madeTexture(
  path: string,
  width: number,
  height: number,
  pixels?: Uint8Array,
): TextureHandle {
  const handle: TextureHandle = Object.freeze({ path, width, height });
  registerTexture(handle, {
    bytes: null,
    pixels: pixels ?? new Uint8Array(width * height * 4).fill(0x7f),
    width,
    height,
  });
  return handle;
}

/** A registered file-backed texture handle whose "file" is the given bytes. */
function fileTexture(path: string, bytes: Uint8Array): TextureHandle {
  const handle: TextureHandle = Object.freeze({ path, width: 1, height: 1 });
  registerTexture(handle, {
    bytes,
    pixels: new Uint8Array(4),
    width: 1,
    height: 1,
  });
  return handle;
}

/** Assembles a GLB container from a document and its binary chunk. */
function buildGlb(json: object, bin: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length + binPad;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length + jsonPad, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  for (let i = 0; i < jsonPad; i += 1) out[20 + jsonBytes.length + i] = 0x20;
  const binAt = 20 + jsonBytes.length + jsonPad;
  view.setUint32(binAt, bin.length + binPad, true);
  view.setUint32(binAt + 4, 0x004e4942, true);
  out.set(bin, binAt + 8);
  return out;
}

/** A one-quad GLB the asset loader accepts: POSITION with bounds, indices, one red material. */
function quadGlb(): Uint8Array {
  const positions = Float32Array.from([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
  const indices = Uint16Array.from([0, 1, 2, 0, 2, 3]);
  const bin = new Uint8Array(positions.byteLength + indices.byteLength);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(indices.buffer), positions.byteLength);
  return buildGlb(
    {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [
        {
          primitives: [
            { attributes: { POSITION: 0 }, indices: 1, material: 0 },
          ],
        },
      ],
      materials: [
        {
          pbrMetallicRoughness: {
            baseColorFactor: [1, 0, 0, 1],
            metallicFactor: 0,
          },
        },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 4,
          type: "VEC3",
          min: [-1, -1, 0],
          max: [1, 1, 0],
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
    },
    bin,
  );
}

describe("arming and disarming", () => {
  it("reports the armed flag through recording()", () => {
    const s = scene();
    expect(s.recording()).toBe(false);
    s.startRecording();
    expect(s.recording()).toBe(true);
    s.stopRecording();
    expect(s.recording()).toBe(false);
  });

  it("refuses a second start and a stop with nothing armed, naming the unbalanced call", () => {
    const s = scene();
    s.startRecording();
    expect(() => s.startRecording()).toThrow(/already armed/);
    s.stopRecording();
    expect(() => s.stopRecording()).toThrow(/not armed/);
  });

  it("fixes the design size and background at arm time, from the engine's own options", () => {
    const s = scene("#123456");
    s.startRecording();
    const recording = s.stopRecording();
    expect(recording.width).toBe(320);
    expect(recording.height).toBe(180);
    expect(recording.background).toBe("#123456");
    const transparent = scene(null);
    transparent.startRecording();
    expect(transparent.stopRecording().background).toBeNull();
  });

  it('writes format 1 and space "3d" — the envelope a player routes on', () => {
    const s = scene();
    s.startRecording();
    const recording = s.stopRecording();
    expect(RECORDING_FORMAT).toBe(1);
    expect(recording.format).toBe(RECORDING_FORMAT);
    expect(recording.space).toBe("3d");
  });

  it("begins capture at the frame after a mid-frame start, so only whole frames are captured", () => {
    const s = scene();
    s.beginFrame(SURFACE);
    s.enterRender();
    s.startRecording(); // from "inside render": this frame is already open
    s.drawHudRect({ x: 0, y: 0 }, { x: 1, y: 1 }, "#fff");
    s.exitRender();
    s.endFrame({ count: 0, timeMs: 0, deltaMs: 16 });
    frame(
      s,
      (ctx) => {
        ctx.drawHudRect({ x: 0, y: 0 }, { x: 1, y: 1 }, "#fff");
      },
      { count: 1, timeMs: 16, deltaMs: 16 },
    );
    const recording = s.stopRecording();
    expect(recording.frames).toHaveLength(1);
    expect(recording.frames[0]?.count).toBe(1);
  });

  it("drops a frame still open at stop, leaving no table entry no frame names", () => {
    const s = scene();
    s.startRecording();
    frame(s, (ctx) => {
      ctx.drawHudText("KEPT", { x: 0, y: 0 });
    });
    s.beginFrame(SURFACE);
    s.enterRender();
    s.drawHudText("DROPPED", { x: 0, y: 0 });
    s.drawBillboard(
      madeTexture(`text:dropped-${Math.random()}`, 1, 1),
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1 },
    );
    const recording = s.stopRecording();
    s.exitRender();

    expect(recording.frames).toHaveLength(1);
    // Every table entry is one the surviving frame names.
    const named = new Set(recording.frames[0]?.ops);
    expect(recording.ops.every((_, index) => named.has(index))).toBe(true);
    expect(recording.assets).toHaveLength(0);
    expect(recording.states).toHaveLength(1);
    expect(JSON.stringify(recording.ops)).toContain("KEPT");
    expect(JSON.stringify(recording.ops)).not.toContain("DROPPED");
  });
});

describe("frames and inherited state", () => {
  it("snapshots the state a frame inherited before its first operation, not the state it left behind", () => {
    const s = scene();
    s.startRecording();
    frame(s, (ctx) => {
      ctx.setCamera({
        position: { x: 7, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        fovY: 1,
        near: 0.1,
        far: 100,
      });
    });
    frame(s, () => {}, { count: 1, timeMs: 16, deltaMs: 16 });
    const recording = s.stopRecording();

    const first = recording.states[recording.frames[0]?.state ?? -1];
    const second = recording.states[recording.frames[1]?.state ?? -1];
    expect(first?.camera.position.x).toBe(0); // the default, in force when frame 0 opened
    expect(second?.camera.position.x).toBe(7); // what frame 0 left behind
  });

  it("carries the frame figures and the surface exactly, because they are the scrub axis", () => {
    const s = scene();
    s.startRecording();
    const timeMs = 16.666666666666668;
    frame(s, () => {}, { count: 3, timeMs, deltaMs: timeMs / 3 });
    const recording = s.stopRecording();
    const captured = recording.frames[0];
    expect(captured?.count).toBe(3);
    expect(captured?.timeMs).toBe(timeMs); // exact, not nine-digit rounded
    expect(captured?.surface).toEqual({ width: 640, height: 360 });
  });

  it("cuts an inherited light list to 64 and flags the frame truncated", () => {
    const s = scene();
    const light: LightState = { type: "ambient", color: "#fff", intensity: 1 };
    s.startRecording();
    frame(s, (ctx) => {
      ctx.setLights(
        Array.from({ length: 70 }, (_, i) => ({ ...light, intensity: i })),
      );
    });
    frame(s, () => {}, { count: 1, timeMs: 16, deltaMs: 16 });
    const recording = s.stopRecording();
    expect(recording.frames[0]?.truncated).toBeUndefined(); // inherited an empty list
    expect(recording.frames[1]?.truncated).toBe(true);
    expect(
      recording.states[recording.frames[1]?.state ?? -1]?.lights,
    ).toHaveLength(64);
  });

  it("rounds the numbers inside a state to nine significant digits", () => {
    const s = scene();
    s.startRecording();
    frame(s, (ctx) => {
      ctx.setCamera({
        position: { x: 1 / 3, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        fovY: Math.PI / 3,
        near: 0.1,
        far: 100,
      });
    });
    frame(s, () => {}, { count: 1, timeMs: 16, deltaMs: 16 });
    const recording = s.stopRecording();
    const state = recording.states[recording.frames[1]?.state ?? -1];
    expect(state?.camera.position.x).toBe(0.333333333);
    expect(state?.camera.fovY).toBe(1.04719755);
  });
});

describe("the dedup tables", () => {
  it("holds one copy of an operation two frames issue and lets each frame name it by index", () => {
    const s = scene();
    s.startRecording();
    const draw = (ctx: SceneContext): void => {
      ctx.drawHudRect({ x: 10, y: 10 }, { x: 5, y: 5 }, "#fff");
    };
    frame(s, draw);
    frame(s, draw, { count: 1, timeMs: 16, deltaMs: 16 });
    const recording = s.stopRecording();
    expect(recording.ops).toHaveLength(1);
    expect(recording.frames[0]?.ops).toEqual([0]);
    expect(recording.frames[1]?.ops).toEqual([0]);
  });

  it("holds one inherited state for frames that inherit the same three values", () => {
    const s = scene();
    s.startRecording();
    frame(s, () => {});
    frame(s, () => {}, { count: 1, timeMs: 16, deltaMs: 16 });
    const recording = s.stopRecording();
    expect(recording.states).toHaveLength(1);
    expect(recording.frames[0]?.state).toBe(0);
    expect(recording.frames[1]?.state).toBe(0);
  });

  it("keeps a frame's op indices in issue order", () => {
    const s = scene();
    s.startRecording();
    frame(s, (ctx) => {
      ctx.drawHudText("A", { x: 0, y: 0 });
      ctx.drawHudText("B", { x: 0, y: 0 });
      ctx.drawHudText("A", { x: 0, y: 0 });
    });
    const recording = s.stopRecording();
    expect(recording.frames[0]?.ops).toEqual([0, 1, 0]);
  });

  it("shares one resource entry between per-frame producing calls with the same arguments", () => {
    const s = scene();
    s.startRecording();
    const draw = (ctx: SceneContext): void => {
      // Created fresh every frame, exactly as the docs bless.
      ctx.drawGeometry(ctx.createSphere(1), "#7fd1ff", AT);
    };
    frame(s, draw);
    frame(s, draw, { count: 1, timeMs: 16, deltaMs: 16 });
    const recording = s.stopRecording();
    expect(recording.resources).toHaveLength(1);
    expect(recording.resources[0]?.make).toEqual({
      method: "createSphere",
      args: [1],
    });
    expect(recording.resources[0]?.then).toEqual([]);
    expect(recording.ops).toHaveLength(1);
    expect(recording.ops[0]).toEqual({
      op: "call",
      method: "drawGeometry",
      args: [
        { $res: 0 },
        "#7fd1ff",
        {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
      ],
    });
  });

  it("collects a recipe while disarmed, so a value made before arming still resolves", () => {
    const s = scene();
    let kept: ReturnType<SceneContext["createMaterial"]> | null = null;
    frame(s, (ctx) => {
      kept = ctx.createMaterial({ baseColor: "#224466", roughness: 0.5 });
    });
    s.startRecording();
    frame(
      s,
      (ctx) => {
        ctx.drawGeometry(ctx.createPlane(2, 2), kept!, AT);
      },
      { count: 1, timeMs: 16, deltaMs: 16 },
    );
    const recording = s.stopRecording();
    expect(recording.resources).toHaveLength(2);
    const material = recording.resources.find(
      (r) => r.make.method === "createMaterial",
    );
    expect(material?.make.args).toEqual([
      { baseColor: "#224466", roughness: 0.5 },
    ]);
  });

  it("leaves a produced value that is never drawn out of the document", () => {
    const s = scene();
    s.startRecording();
    frame(s, (ctx) => {
      ctx.createSphere(99); // made, never used
      ctx.drawHudText("X", { x: 0, y: 0 });
    });
    const recording = s.stopRecording();
    expect(recording.resources).toHaveLength(0);
  });

  it("emits only vocabulary calls: every op a scene method, every resource a producer, no producing call in ops", () => {
    const s = scene();
    s.startRecording();
    frame(s, (ctx) => {
      ctx.setCamera({
        position: { x: 0, y: 0, z: 10 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        fovY: 1,
        near: 0.1,
        far: 100,
      });
      ctx.setLights([{ type: "ambient", color: "#fff", intensity: 1 }]);
      ctx.setMode("unlit");
      ctx.clearDepth();
      ctx.drawGeometry(ctx.createCapsule(1, 2), ctx.createMaterial({}), AT);
      ctx.drawLine(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 1, z: 1 },
        ],
        "#fff",
      );
      ctx.drawHudRect({ x: 0, y: 0 }, { x: 1, y: 1 }, "#fff");
      ctx.drawHudText("Y", { x: 0, y: 0 });
    });
    const recording = s.stopRecording();
    for (const op of recording.ops) {
      expect(op.op).toBe("call");
      if (op.op === "call") expect(SCENE_OP_METHODS).toContain(op.method);
    }
    for (const resource of recording.resources) {
      expect(PRODUCING_METHODS).toContain(resource.make.method);
    }
  });
});

describe("value encoding", () => {
  it("records the arguments as supplied: two for an option-less call, three with options", () => {
    const s = scene();
    const mesh = {
      path: "meshes/bare.glb",
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
      nodes: [],
      clips: ["walk"],
    };
    s.startRecording();
    frame(s, (ctx) => {
      ctx.drawMesh(mesh, AT);
      ctx.drawMesh(mesh, AT, { clip: "walk", clipTime: 0.5 });
    });
    const recording = s.stopRecording();
    const ops = frameOps(recording, 0).filter(
      (op): op is Extract<DrawOp, { op: "call" }> => op.op === "call",
    );
    expect(ops[0]?.args).toHaveLength(2);
    expect(ops[1]?.args).toHaveLength(3);
    expect(ops[1]?.args[2]).toEqual({ clip: "walk", clipTime: 0.5 });
  });

  it("rounds numbers inside a draw value to nine significant digits", () => {
    const s = scene();
    s.startRecording();
    frame(s, (ctx) => {
      ctx.drawHudRect({ x: 1 / 3, y: 0 }, { x: 1, y: 1 }, "#fff");
    });
    const recording = s.stopRecording();
    const op = frameOps(recording, 0)[0];
    if (op?.op === "call") expect(op.args[0]).toEqual({ x: 0.333333333, y: 0 });
    else expect.fail("expected a call");
  });

  it("records a cyclic object and a throwing getter as opaque markers while the call proceeds", () => {
    const s = scene();
    const cycle: Record<string, unknown> = {};
    cycle["self"] = cycle;
    const trap = {};
    Object.defineProperty(trap, "boom", {
      enumerable: true,
      get() {
        throw new Error("no");
      },
    });
    s.startRecording();
    expect(() =>
      frame(s, (ctx) => {
        ctx.drawLine(
          [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
          ],
          cycle as never,
        );
        ctx.drawLine(
          [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
          ],
          trap as never,
        );
      }),
    ).not.toThrow();
    const recording = s.stopRecording();
    const ops = frameOps(recording, 0).filter(
      (op): op is Extract<DrawOp, { op: "call" }> => op.op === "call",
    );
    expect((ops[0]?.args[1] as { self: DrawValue }).self).toEqual({
      $opaque: "Object",
    });
    expect(ops[1]?.args[1]).toEqual({ $opaque: "Object" });
  });

  it("stops expanding at depth 32, recording the container there as an opaque marker", () => {
    const s = scene();
    let nested: unknown = "leaf";
    for (let i = 0; i < 40; i += 1) nested = { deeper: nested };
    s.startRecording();
    frame(s, (ctx) => {
      ctx.drawLine(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        nested as never,
      );
    });
    const recording = s.stopRecording();
    expect(JSON.stringify(recording.ops)).toContain('"$opaque"');
    expect(JSON.stringify(recording.ops)).not.toContain("leaf");
  });

  it("cuts one value's expansion at 65,536 values, carrying an array's remainder as its last element", () => {
    const s = scene();
    const wide = Array.from({ length: 70_000 }, (_, i) => i);
    s.startRecording();
    frame(s, (ctx) => {
      ctx.drawLine(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        wide as never,
      );
    });
    const recording = s.stopRecording();
    const op = frameOps(recording, 0)[0];
    if (op?.op !== "call") return expect.fail("expected a call");
    const encoded = op.args[1] as readonly DrawValue[];
    expect(encoded.length).toBeLessThan(70_000);
    expect(encoded[encoded.length - 1]).toEqual({ $opaque: "truncated" });
  });

  it("carries an object's expansion remainder as its $rest field", () => {
    const s = scene();
    const wide: Record<string, number> = {};
    for (let i = 0; i < 66_000; i += 1) wide[`k${i}`] = i;
    s.startRecording();
    frame(s, (ctx) => {
      ctx.drawLine(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        wide as never,
      );
    });
    const recording = s.stopRecording();
    const op = frameOps(recording, 0)[0];
    if (op?.op !== "call") return expect.fail("expected a call");
    expect((op.args[1] as { $rest: DrawValue }).$rest).toEqual({
      $opaque: "truncated",
    });
  });
});

describe("asset capture", () => {
  it("captures a texture handle once on identity, however many frames draw it", () => {
    const s = scene();
    const texture = madeTexture(
      `text:HI-${Math.random()}`,
      2,
      2,
      Uint8Array.from({ length: 16 }, (_, i) => i * 3),
    );
    s.startRecording();
    const draw = (ctx: SceneContext): void => {
      ctx.drawBillboard(texture, { x: 0, y: 0, z: 0 }, { x: 1, y: 1 });
    };
    frame(s, draw);
    frame(s, draw, { count: 1, timeMs: 16, deltaMs: 16 });
    const recording = s.stopRecording();

    expect(recording.assets).toHaveLength(1);
    const asset = recording.assets[0];
    if (asset?.kind !== "texture")
      return expect.fail("expected a texture asset");
    expect(asset.path).toMatch(/^text:HI-/);
    expect(asset.width).toBe(2);
    expect(asset.height).toBe(2);
    // The engine-made texture had no file; the capture encoded its pixels as
    // a PNG the stage-0 decoder reads back byte for byte.
    expect(asset.src.startsWith("data:image/png;base64,")).toBe(true);
    const decoded = decodePng(
      Uint8Array.from(
        Buffer.from(asset.src.slice("data:image/png;base64,".length), "base64"),
      ),
    );
    expect([...decoded.pixels]).toEqual([
      ...Uint8Array.from({ length: 16 }, (_, i) => i * 3),
    ]);
    // Both frames name the same {$asset: 0}.
    const ops = frameOps(recording, 1);
    if (ops[0]?.op === "call") expect(ops[0].args[0]).toEqual({ $asset: 0 });
  });

  it("captures a file-backed texture's own bytes rather than re-encoding its pixels", () => {
    const s = scene();
    const png = encodePng(Uint8Array.from([1, 2, 3, 4]), 1, 1);
    const texture = fileTexture(`textures/dot-${Math.random()}.png`, png);
    s.startRecording();
    frame(s, (ctx) => {
      ctx.drawBillboard(texture, { x: 0, y: 0, z: 0 }, { x: 1, y: 1 });
    });
    const recording = s.stopRecording();
    const asset = recording.assets[0];
    if (asset?.kind !== "texture")
      return expect.fail("expected a texture asset");
    expect(asset.src).toBe(
      `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
    );
  });

  it("captures a loaded mesh as its glb bytes, base64 encoded", async () => {
    const glb = quadGlb();
    const loader = new AssetLoader({
      fetch: () => Promise.resolve(new Response(glb.slice())),
    });
    const mesh = await loader.loadMesh("meshes/quad.glb");
    const s = scene();
    s.startRecording();
    frame(s, (ctx) => {
      ctx.drawMesh(mesh, AT);
    });
    const recording = s.stopRecording();
    const asset = recording.assets[0];
    if (asset?.kind !== "mesh") return expect.fail("expected a mesh asset");
    expect(asset.path).toBe("meshes/quad.glb");
    expect(asset.data).toBe(Buffer.from(glb).toString("base64"));
    const op = frameOps(recording, 0)[0];
    if (op?.op === "call") expect(op.args[0]).toEqual({ $asset: 0 });
  });

  it("captures a material document as slot references into its captured textures", async () => {
    const png = encodePng(Uint8Array.from([9, 8, 7, 255]), 1, 1);
    const document = JSON.stringify({
      maps: [{ name: "base-color", path: "base.png" }],
    });
    const loader = new AssetLoader({
      fetch: (url: string) =>
        Promise.resolve(
          url.endsWith(".json")
            ? new Response(document)
            : new Response(png.slice()),
        ),
    });
    const material = await loader.loadMaterial("materials/hull/material.json");
    const s = scene();
    s.startRecording();
    const mesh = {
      path: "m",
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
      nodes: [],
      clips: [],
    };
    frame(s, (ctx) => {
      ctx.drawMesh(mesh, AT, { material });
    });
    const recording = s.stopRecording();

    const materialAsset = recording.assets.find((a) => a.kind === "material");
    if (materialAsset?.kind !== "material")
      return expect.fail("expected a material asset");
    expect(materialAsset.path).toBe("materials/hull/material.json");
    const textureIndex = materialAsset.maps.baseColor;
    expect(textureIndex).toBeTypeOf("number");
    expect(recording.assets[textureIndex ?? -1]?.kind).toBe("texture");
    // The op's options carry the handle as an asset reference.
    const op = frameOps(recording, 0)[0];
    if (op?.op === "call") {
      const options = op.args[2] as { material: DrawValue };
      expect(options.material).toEqual({
        $asset: recording.assets.indexOf(materialAsset),
      });
    }
  });

  it("stops capturing new assets past the 16 MB budget while captured ones keep resolving", () => {
    const s = scene();
    // Two "files" whose base64 costs ~12 MB apiece: the first fits the
    // budget, the second would pass it and degrades to an opaque marker.
    const big = () =>
      fileTexture(
        `textures/big-${Math.random()}.png`,
        new Uint8Array(9 * 1024 * 1024),
      );
    const first = big();
    const second = big();
    s.startRecording();
    frame(s, (ctx) => {
      ctx.drawBillboard(first, { x: 0, y: 0, z: 0 }, { x: 1, y: 1 });
      ctx.drawBillboard(second, { x: 0, y: 0, z: 0 }, { x: 1, y: 1 });
    });
    frame(
      s,
      (ctx) => {
        ctx.drawBillboard(first, { x: 0, y: 0, z: 0 }, { x: 1, y: 1 });
      },
      { count: 1, timeMs: 16, deltaMs: 16 },
    );
    const recording = s.stopRecording();

    expect(recording.assets).toHaveLength(1);
    const bytes = recording.assets.reduce(
      (sum, asset) => sum + (asset.kind === "texture" ? asset.src.length : 0),
      0,
    );
    expect(bytes).toBeLessThanOrEqual(ASSET_BYTE_LIMIT);
    const ops = frameOps(recording, 0).filter(
      (op): op is Extract<DrawOp, { op: "call" }> => op.op === "call",
    );
    expect(ops[0]?.args[0]).toEqual({ $asset: 0 });
    expect(ops[1]?.args[0]).toEqual({ $opaque: "TextureHandle" });
    // The captured one still resolves on a later frame.
    const later = frameOps(recording, 1);
    if (later[0]?.op === "call")
      expect(later[0].args[0]).toEqual({ $asset: 0 });
    // The check allocates and base64-encodes two ~12 MB payloads, which runs
    // for seconds on a loaded machine: an explicit timeout, bounding how long
    // it may take and changing nothing it asserts.
  }, 30_000);
});
