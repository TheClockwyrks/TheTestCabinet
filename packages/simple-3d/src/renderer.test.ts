import { describe, expect, it } from "vitest";
import { createCanvas } from "@test-cabinet/headless-webgl2";
import type { LightState } from "./contract";
import { defaultCameraState, quatFromAxisAngle } from "./math";
import type { Transform } from "./math";
import { fitViewport, projectPoint } from "./viewport";
import type { TextureHandle } from "./assets";
import { AssetLoader, registerTexture } from "./assets";
import { FONT_CELL_HEIGHT, FONT_CELL_WIDTH, glyphRows } from "./font";
import type { SceneContext } from "./scene";
import { Scene } from "./scene";
import { SceneRenderer, parseColor } from "./renderer";

/**
 * The renderer over a real (headless) WebGL2 context: the letterboxed clear,
 * the draw-order rules the docs state (opaque by depth, translucent
 * farthest-first per run, HUD last), the render modes, the lights, and the
 * engine's own bitmap lettering. Pixel claims follow the validator docs'
 * own line: an unlit interior and the frame clear are byte-exact, a lit
 * pixel is asserted qualitatively, and everything positional goes through
 * `projectPoint` — the spec's own bridge from world to device.
 *
 * The recorder's view of the same calls is `recording.test.ts`'s business;
 * this suite reads back pixels alone.
 */

const DESIGN_W = 160;
const DESIGN_H = 120;

interface Harness {
  scene: Scene;
  renderer: SceneRenderer;
  draw(body: (ctx: SceneContext) => void): void;
  /** One pixel as RGBA bytes, addressed top-down in device coordinates. */
  pixel(x: number, y: number): number[];
  /** Every pixel of the frame, for scans; rows bottom-up as `readPixels` hands them. */
  pixels(): Uint8Array;
}

/** An engine-shaped rig over a headless canvas: scene in, pixels out. */
function harness(
  options: {
    cssWidth?: number;
    cssHeight?: number;
    background?: string | null;
  } = {},
): Harness {
  const cssWidth = options.cssWidth ?? DESIGN_W;
  const cssHeight = options.cssHeight ?? DESIGN_H;
  const background =
    options.background === undefined ? "#101820" : options.background;
  const canvas = createCanvas(cssWidth, cssHeight);
  const gl = canvas.getContext("webgl2") as unknown as WebGL2RenderingContext;
  const scene = new Scene({ width: DESIGN_W, height: DESIGN_H, background });
  const renderer = new SceneRenderer(gl);
  const viewport = fitViewport(DESIGN_W, DESIGN_H, cssWidth, cssHeight, 1);
  let count = 0;
  return {
    scene,
    renderer,
    draw(body) {
      scene.beginFrame({ width: canvas.width, height: canvas.height });
      scene.enterRender();
      try {
        body(scene);
      } finally {
        scene.exitRender();
      }
      const frame = scene.endFrame({ count, timeMs: count * 16, deltaMs: 16 });
      count += 1;
      renderer.renderFrame({
        viewport,
        surface: { width: canvas.width, height: canvas.height },
        background,
        frame,
      });
    },
    pixel(x, y) {
      const out = new Uint8Array(4);
      gl.readPixels(
        x,
        canvas.height - 1 - y,
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        out,
      );
      return [...out];
    },
    pixels() {
      const out = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(
        0,
        0,
        canvas.width,
        canvas.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        out,
      );
      return out;
    },
  };
}

/** A transform posing at `position` with no rotation and the given uniform scale. */
function at(x: number, y: number, z: number, scale = 1): Transform {
  return {
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: scale, y: scale, z: scale },
  };
}

const WHITE_AMBIENT: readonly LightState[] = [
  { type: "ambient", color: "#ffffff", intensity: 1 },
];

/** A registered engine-made texture whose every texel is the given bytes. */
function flatTexture(
  bytes: readonly number[],
  width = 2,
  height = 2,
): TextureHandle {
  const handle: TextureHandle = Object.freeze({
    path: `made-${Math.random()}`,
    width,
    height,
  });
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) pixels.set(bytes, i * 4);
  registerTexture(handle, { bytes: null, pixels, width, height });
  return handle;
}

describe("shaders and the clear", () => {
  it("compiles its shaders against headless-webgl2's GLSL subset at construction", () => {
    const canvas = createCanvas(8, 8);
    const gl = canvas.getContext("webgl2") as unknown as WebGL2RenderingContext;
    expect(() => new SceneRenderer(gl)).not.toThrow();
  });

  it("clears every frame to the background color, byte-exact", () => {
    const h = harness();
    h.draw(() => {});
    expect(h.pixel(80, 60)).toEqual([16, 24, 32, 255]);
    expect(h.pixel(0, 0)).toEqual([16, 24, 32, 255]);
  });

  it("clears to transparent when the background is null", () => {
    const h = harness({ background: null });
    h.draw(() => {});
    expect(h.pixel(80, 60)).toEqual([0, 0, 0, 0]);
  });

  it("letterboxes a wider canvas: the picture lands inside the fit and the bars stay background", () => {
    const h = harness({ cssWidth: 200, cssHeight: 120 });
    h.draw((ctx) => {
      ctx.drawHudRect({ x: 0, y: 0 }, { x: DESIGN_W, y: DESIGN_H }, "#00ff00");
    });
    // scale 1, offsetX (200-160)/2 = 20: logical x maps to device x + 20.
    expect(h.pixel(100, 60)).toEqual([0, 255, 0, 255]);
    expect(h.pixel(10, 60)).toEqual([16, 24, 32, 255]);
    expect(h.pixel(195, 60)).toEqual([16, 24, 32, 255]);
  });
});

describe("modes and lights", () => {
  it("draws an unlit interior byte-exact — the sampling contract's flat-interior half", () => {
    const h = harness();
    h.draw((ctx) => {
      ctx.setMode("unlit");
      ctx.drawGeometry(
        ctx.createBox({ x: 8, y: 8, z: 1 }),
        "#ff8040",
        at(0, 0, 0),
      );
    });
    expect(h.pixel(80, 60)).toEqual([255, 128, 64, 255]);
  });

  it("renders meshes black under the standard mode's empty light list", () => {
    const h = harness();
    h.draw((ctx) => {
      ctx.drawGeometry(
        ctx.createBox({ x: 8, y: 8, z: 1 }),
        "#ff0000",
        at(0, 0, 0),
      );
    });
    expect(h.pixel(80, 60)).toEqual([0, 0, 0, 255]);
  });

  it("lights a full-lambert face byte-exact under one white directional light and full roughness", () => {
    const h = harness();
    h.draw((ctx) => {
      ctx.setLights([
        {
          type: "directional",
          color: "#ffffff",
          intensity: 1,
          direction: { x: 0, y: 0, z: -1 },
        },
      ]);
      ctx.drawGeometry(
        ctx.createBox({ x: 8, y: 8, z: 1 }),
        ctx.createMaterial({ baseColor: "#ff0000", roughness: 1 }),
        at(0, 0, 0),
      );
    });
    // The front face's normal meets the light head on: lambert 1, gloss 0,
    // so the lit color is the base color exactly.
    expect(h.pixel(80, 60)).toEqual([255, 0, 0, 255]);
  });

  it("reproduces the base color exactly under a white ambient light", () => {
    const h = harness();
    h.draw((ctx) => {
      ctx.setLights(WHITE_AMBIENT);
      ctx.drawGeometry(
        ctx.createBox({ x: 8, y: 8, z: 1 }),
        "#ff8040",
        at(0, 0, 0),
      );
    });
    expect(h.pixel(80, 60)).toEqual([255, 128, 64, 255]);
  });

  it("lights a sphere to a nonzero red under a directional light", () => {
    const h = harness();
    h.draw((ctx) => {
      ctx.setLights([
        {
          type: "directional",
          color: "#ffffff",
          intensity: 1,
          direction: { x: 0, y: 0, z: -1 },
        },
      ]);
      ctx.drawGeometry(ctx.createSphere(2), "#ff0000", at(0, 0, 0));
    });
    const [r, g] = h.pixel(80, 60);
    expect(r).toBeGreaterThan(150);
    expect(g ?? 0).toBeLessThan(60);
  });

  it("attenuates a point light to nothing past its range", () => {
    const near = harness();
    near.draw((ctx) => {
      ctx.setLights([
        {
          type: "point",
          color: "#ffffff",
          intensity: 1,
          position: { x: 0, y: 0, z: 5 },
          range: 100,
        },
      ]);
      ctx.drawGeometry(
        ctx.createBox({ x: 8, y: 8, z: 1 }),
        "#ff0000",
        at(0, 0, 0),
      );
    });
    expect(near.pixel(80, 60)[0]).toBeGreaterThan(50);

    const far = harness();
    far.draw((ctx) => {
      ctx.setLights([
        {
          type: "point",
          color: "#ffffff",
          intensity: 1,
          position: { x: 0, y: 0, z: 5 },
          range: 1,
        },
      ]);
      ctx.drawGeometry(
        ctx.createBox({ x: 8, y: 8, z: 1 }),
        "#ff0000",
        at(0, 0, 0),
      );
    });
    expect(far.pixel(80, 60)).toEqual([0, 0, 0, 255]);
  });

  it("shows emissive with no lights at all", () => {
    const h = harness();
    h.draw((ctx) => {
      ctx.drawGeometry(
        ctx.createBox({ x: 8, y: 8, z: 1 }),
        ctx.createMaterial({ baseColor: "#000000", emissive: "#00ff00" }),
        at(0, 0, 0),
      );
    });
    expect(h.pixel(80, 60)).toEqual([0, 255, 0, 255]);
  });

  it("visualizes the facing normal as color under the normals mode", () => {
    const h = harness();
    h.draw((ctx) => {
      ctx.setMode("normals");
      ctx.drawGeometry(
        ctx.createBox({ x: 8, y: 8, z: 1 }),
        "#ff0000",
        at(0, 0, 0),
      );
    });
    const [r, g, b] = h.pixel(80, 60);
    // The +Z face normal letters as (0.5, 0.5, 1).
    expect(Math.abs((r ?? 0) - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs((g ?? 0) - 128)).toBeLessThanOrEqual(1);
    expect(b).toBe(255);
  });

  it("hollows a box under wireframe — the interior clears while the edges still letter", () => {
    const h = harness();
    h.draw((ctx) => {
      ctx.setMode("wireframe");
      ctx.drawGeometry(
        ctx.createBox({ x: 6, y: 6, z: 6 }),
        "#ff0000",
        at(0, 0, 0),
      );
    });
    // Off the face diagonals — a face's two triangles share a diagonal edge
    // that wireframe letters through the middle of the face.
    expect(h.pixel(80, 40)).toEqual([16, 24, 32, 255]);
    const all = h.pixels();
    let reddish = 0;
    for (let i = 0; i < all.length; i += 4) {
      if ((all[i] ?? 0) > 100 && (all[i + 1] ?? 0) < 60) reddish += 1;
    }
    expect(reddish).toBeGreaterThan(20);
  });
});

describe("draw order", () => {
  it("resolves opaque draws by depth, whatever the issue order", () => {
    for (const nearFirst of [true, false]) {
      const h = harness();
      h.draw((ctx) => {
        ctx.setMode("unlit");
        const near = (): void =>
          ctx.drawGeometry(
            ctx.createBox({ x: 4, y: 4, z: 1 }),
            "#0000ff",
            at(0, 0, 3),
          );
        const far = (): void =>
          ctx.drawGeometry(
            ctx.createBox({ x: 4, y: 4, z: 1 }),
            "#ff0000",
            at(0, 0, 0),
          );
        if (nearFirst) {
          near();
          far();
        } else {
          far();
          near();
        }
      });
      expect(h.pixel(80, 60)).toEqual([0, 0, 255, 255]);
    }
  });

  it("lets a draw after clearDepth sit over everything drawn before it, however near the earlier geometry", () => {
    const h = harness();
    h.draw((ctx) => {
      ctx.setMode("unlit");
      ctx.drawGeometry(
        ctx.createBox({ x: 4, y: 4, z: 1 }),
        "#0000ff",
        at(0, 0, 3),
      );
      ctx.clearDepth();
      ctx.drawGeometry(
        ctx.createBox({ x: 4, y: 4, z: 1 }),
        "#ff0000",
        at(0, 0, 0),
      );
    });
    expect(h.pixel(80, 60)).toEqual([255, 0, 0, 255]);
  });

  it("renders translucent draws after their run's opaque draws, sorted farthest-first from the run's camera", () => {
    const h = harness();
    // A plane is a single quad, so each translucent draw blends exactly once
    // and the compositing arithmetic below is exact; rotated +Y → +Z, it
    // faces the default camera.
    const facing: Transform = {
      position: { x: 0, y: 0, z: 0 },
      rotation: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2),
      scale: { x: 1, y: 1, z: 1 },
    };
    h.draw((ctx) => {
      ctx.setMode("unlit");
      const red = ctx.createMaterial({
        baseColor: "#ff0000",
        opacity: 0.5,
        unlit: true,
      });
      const blue = ctx.createMaterial({
        baseColor: "#0000ff",
        opacity: 0.5,
        unlit: true,
      });
      // Issue order is nearest-first on purpose: blue sits at z 3 (nearer the
      // z 10 camera) and red at z 0, and the backdrop comes last of all —
      // the picture below is only right if the renderer reorders.
      ctx.drawGeometry(ctx.createPlane(6, 6), blue, {
        ...facing,
        position: { x: 0, y: 0, z: 3 },
      });
      ctx.drawGeometry(ctx.createPlane(6, 6), red, {
        ...facing,
        position: { x: 0, y: 0, z: 0 },
      });
      ctx.drawGeometry(
        ctx.createBox({ x: 12, y: 10, z: 0.2 }),
        "#ffffff",
        at(0, 0, -3),
      );
    });
    // white → red over it → blue over that: (127.5, 63.75, 191.25). Sampled
    // off the quads' shared triangle diagonal, which runs through (80, 60).
    const [r, g, b] = h.pixel(80, 50);
    expect(Math.abs((r ?? 0) - 127.5)).toBeLessThanOrEqual(2);
    expect(Math.abs((g ?? 0) - 63.75)).toBeLessThanOrEqual(2);
    expect(Math.abs((b ?? 0) - 191.25)).toBeLessThanOrEqual(2);
  });

  it("composites HUD draws last, above 3D geometry issued after them", () => {
    const h = harness();
    h.draw((ctx) => {
      ctx.setMode("unlit");
      ctx.drawHudRect({ x: 70, y: 50 }, { x: 20, y: 20 }, "#00ff00");
      ctx.drawGeometry(
        ctx.createBox({ x: 8, y: 8, z: 1 }),
        "#ff0000",
        at(0, 0, 0),
      );
    });
    expect(h.pixel(80, 60)).toEqual([0, 255, 0, 255]);
  });

  it("skips a draw carrying a non-finite transform, drawing nothing for that call", () => {
    const h = harness();
    h.draw((ctx) => {
      ctx.setMode("unlit");
      ctx.drawGeometry(
        ctx.createBox({ x: 8, y: 8, z: 1 }),
        "#ff0000",
        at(Number.NaN, 0, 0),
      );
    });
    expect(h.pixel(80, 60)).toEqual([16, 24, 32, 255]);
  });
});

describe("billboards, lines, and the HUD", () => {
  it("draws a billboard's texture facing the camera, byte-exact over a flat texture", () => {
    const h = harness();
    const texture = flatTexture([64, 128, 192, 255]);
    h.draw((ctx) => {
      ctx.drawBillboard(texture, { x: 0, y: 0, z: 0 }, { x: 4, y: 4 });
    });
    expect(h.pixel(80, 60)).toEqual([64, 128, 192, 255]);
  });

  it("renders a billboard the same under wireframe, because modes govern only mesh and geometry draws", () => {
    const h = harness();
    const texture = flatTexture([64, 128, 192, 255]);
    h.draw((ctx) => {
      ctx.setMode("wireframe");
      ctx.drawBillboard(texture, { x: 0, y: 0, z: 0 }, { x: 4, y: 4 });
    });
    expect(h.pixel(80, 60)).toEqual([64, 128, 192, 255]);
  });

  it("rasters a world-space polyline one device pixel wide", () => {
    const h = harness({ background: "#000000" });
    h.draw((ctx) => {
      ctx.drawLine(
        [
          { x: -4, y: 0, z: 0 },
          { x: 4, y: 0, z: 0 },
        ],
        "#00ff00",
      );
    });
    // The line crosses the field's center band; one row of the middle column
    // carries it and its neighbours two rows away do not.
    const rows = [58, 59, 60, 61, 62].map((y) => h.pixel(80, y));
    expect(rows.some((px) => (px[1] ?? 0) > 200)).toBe(true);
    const lit = rows.filter((px) => (px[1] ?? 0) > 0).length;
    expect(lit).toBeLessThanOrEqual(2);
  });

  it("fills a HUD rectangle with alpha blending over the picture", () => {
    const h = harness();
    h.draw((ctx) => {
      ctx.setMode("unlit");
      ctx.drawGeometry(
        ctx.createBox({ x: 12, y: 10, z: 1 }),
        "#ffffff",
        at(0, 0, 0),
      );
      ctx.drawHudRect({ x: 70, y: 50 }, { x: 20, y: 20 }, "#00000080");
    });
    const [r, g, b] = h.pixel(80, 60);
    for (const channel of [r, g, b]) {
      expect(Math.abs((channel ?? 0) - 127)).toBeLessThanOrEqual(2);
    }
  });

  it("letters HUD text from the package's own Unscii glyphs, pixel for pixel at cell scale", () => {
    const h = harness({ background: "#000000" });
    h.draw((ctx) => {
      // size 16 at scale 1: one glyph cell texel per device pixel.
      ctx.drawHudText("A", { x: 8, y: 8 }, { size: 16, color: "#ffffff" });
    });
    const rows = glyphRows("A".codePointAt(0) ?? 0);
    let set: [number, number] | null = null;
    let unset: [number, number] | null = null;
    for (let row = 0; row < FONT_CELL_HEIGHT; row += 1) {
      for (let col = 0; col < FONT_CELL_WIDTH; col += 1) {
        const on = ((rows[row] ?? 0) & (0x80 >> col)) !== 0;
        if (on && set === null) set = [col, row];
        if (!on && unset === null) unset = [col, row];
      }
    }
    expect(set).not.toBeNull();
    expect(unset).not.toBeNull();
    expect(h.pixel(8 + (set?.[0] ?? 0), 8 + (set?.[1] ?? 0))).toEqual([
      255, 255, 255, 255,
    ]);
    expect(h.pixel(8 + (unset?.[0] ?? 0), 8 + (unset?.[1] ?? 0))).toEqual([
      0, 0, 0, 255,
    ]);
  });

  it("anchors center-aligned text on its position", () => {
    const h = harness({ background: "#000000" });
    h.draw((ctx) => {
      // Two glyphs of advance 8: centered on x=80, the em box spans 64..96.
      ctx.drawHudText(
        "HH",
        { x: 80, y: 8 },
        { size: 16, color: "#ffffff", align: "center" },
      );
    });
    const all = h.pixels();
    let leftmost = Number.POSITIVE_INFINITY;
    for (let i = 0; i < all.length; i += 4) {
      if ((all[i] ?? 0) > 200)
        leftmost = Math.min(leftmost, (i / 4) % DESIGN_W);
    }
    expect(leftmost).toBeGreaterThanOrEqual(64);
    expect(leftmost).toBeLessThan(80);
  });
});

describe("the world-to-device bridge", () => {
  it("draws a world point at the device pixel projectPoint names — the spec's own validation route", () => {
    const h = harness();
    h.draw((ctx) => {
      ctx.setMode("unlit");
      ctx.drawGeometry(
        ctx.createBox({ x: 1, y: 1, z: 1 }),
        "#ffff00",
        at(2, 1, 0),
      );
    });
    const viewport = fitViewport(DESIGN_W, DESIGN_H, DESIGN_W, DESIGN_H, 1);
    const point = projectPoint(defaultCameraState(), viewport, {
      x: 2,
      y: 1,
      z: 0,
    });
    expect(point).not.toBeNull();
    const x = Math.round(viewport.offsetX + (point?.x ?? 0) * viewport.scale);
    const y = Math.round(viewport.offsetY + (point?.y ?? 0) * viewport.scale);
    expect(h.pixel(x, y)).toEqual([255, 255, 0, 255]);
  });
});

/* ---------------------------------------------------------------------- */
/* glTF meshes                                                            */
/* ---------------------------------------------------------------------- */

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

/**
 * A one-quad GLB: a 2×2 red quad in the XY plane, optionally carrying a
 * `"slide"` clip that translates its node from x 0 to x 8 over one second.
 */
function quadGlb(animated: boolean): Uint8Array {
  const positions = Float32Array.from([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
  const indices = Uint16Array.from([0, 1, 2, 0, 2, 3]);
  const times = Float32Array.from([0, 1]);
  const values = Float32Array.from([0, 0, 0, 8, 0, 0]);
  const bin = new Uint8Array(
    positions.byteLength +
      indices.byteLength +
      (animated ? times.byteLength + values.byteLength : 0),
  );
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(indices.buffer), positions.byteLength);
  if (animated) {
    bin.set(new Uint8Array(times.buffer), 60);
    bin.set(new Uint8Array(values.buffer), 68);
  }
  const json: Record<string, unknown> = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
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
      { buffer: 0, byteOffset: 0, byteLength: 48 },
      { buffer: 0, byteOffset: 48, byteLength: 12 },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  if (animated) {
    (json["accessors"] as unknown[]).push(
      { bufferView: 2, componentType: 5126, count: 2, type: "SCALAR" },
      { bufferView: 3, componentType: 5126, count: 2, type: "VEC3" },
    );
    (json["bufferViews"] as unknown[]).push(
      { buffer: 0, byteOffset: 60, byteLength: 8 },
      { buffer: 0, byteOffset: 68, byteLength: 24 },
    );
    json["animations"] = [
      {
        name: "slide",
        channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
        samplers: [{ input: 2, output: 3, interpolation: "LINEAR" }],
      },
    ];
  }
  return buildGlb(json, bin);
}

describe("glTF meshes", () => {
  it("draws a loaded mesh with its file material, exact under a white ambient light", async () => {
    const loader = new AssetLoader({
      fetch: () => Promise.resolve(new Response(quadGlb(false).slice())),
    });
    const mesh = await loader.loadMesh("meshes/quad.glb");
    const h = harness();
    h.draw((ctx) => {
      ctx.setLights(WHITE_AMBIENT);
      ctx.drawMesh(mesh, at(0, 0, 0, 3));
    });
    expect(h.pixel(80, 60)).toEqual([255, 0, 0, 255]);
  });

  it("overrides every file material when options.material is given", async () => {
    const loader = new AssetLoader({
      fetch: () => Promise.resolve(new Response(quadGlb(false).slice())),
    });
    const mesh = await loader.loadMesh("meshes/quad.glb");
    const h = harness();
    h.draw((ctx) => {
      ctx.setMode("unlit");
      ctx.drawMesh(mesh, at(0, 0, 0, 3), { material: "#00ff00" });
    });
    expect(h.pixel(80, 60)).toEqual([0, 255, 0, 255]);
  });

  it("poses a clip at clipTime seconds and loops it over the clip's duration", async () => {
    const loader = new AssetLoader({
      fetch: () => Promise.resolve(new Response(quadGlb(true).slice())),
    });
    const mesh = await loader.loadMesh("meshes/slider.glb");
    expect(mesh.clips).toEqual(["slide"]);

    const viewport = fitViewport(DESIGN_W, DESIGN_H, DESIGN_W, DESIGN_H, 1);
    const slid = projectPoint(defaultCameraState(), viewport, {
      x: 4,
      y: 0,
      z: 0,
    });
    const x = Math.round(slid?.x ?? 0);
    const y = Math.round(slid?.y ?? 0);

    for (const clipTime of [0.5, 1.5]) {
      const h = harness();
      h.draw((ctx) => {
        ctx.setLights(WHITE_AMBIENT);
        ctx.drawMesh(mesh, at(0, 0, 0), { clip: "slide", clipTime });
      });
      // Halfway through the second-long clip — looped for 1.5 — the node sits
      // at x 4: the quad letters there and no longer at the origin.
      expect(h.pixel(x, y)).toEqual([255, 0, 0, 255]);
      expect(h.pixel(80, 60)).toEqual([16, 24, 32, 255]);
    }
  });

  it("draws the rest pose when no clip is named", async () => {
    const loader = new AssetLoader({
      fetch: () => Promise.resolve(new Response(quadGlb(true).slice())),
    });
    const mesh = await loader.loadMesh("meshes/slider.glb");
    const h = harness();
    h.draw((ctx) => {
      ctx.setLights(WHITE_AMBIENT);
      ctx.drawMesh(mesh, at(0, 0, 0));
    });
    expect(h.pixel(80, 60)).toEqual([255, 0, 0, 255]);
  });
});

describe("colors", () => {
  it("parses the color forms the engine documents taking", () => {
    expect(parseColor("#ff8040")).toEqual([1, 128 / 255, 64 / 255, 1]);
    expect(parseColor("#00000080")).toEqual([0, 0, 0, 128 / 255]);
    expect(parseColor("#fff")).toEqual([1, 1, 1, 1]);
    expect(parseColor("rgb(255, 0, 0)")).toEqual([1, 0, 0, 1]);
    expect(parseColor("rgba(0, 0, 255, 0.5)")).toEqual([0, 0, 1, 0.5]);
    expect(parseColor("hsl(0, 100%, 50%)")).toEqual([1, 0, 0, 1]);
    expect(parseColor("transparent")).toEqual([0, 0, 0, 0]);
    expect(parseColor("not-a-color")).toEqual([1, 1, 1, 1]);
  });
});
