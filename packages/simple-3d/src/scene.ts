/**
 * The scene context: the engine-owned, write-only 3D drawing surface a game's
 * `render` draws through, with the draw-command recorder built into it.
 *
 * Everything here mirrors `docs/engines/simple-3d/apis/game.md` (the
 * `SceneContext` sections) and the recording pages — those pages are the
 * specification, and behavior that disagrees with them is wrong.
 *
 * Four decisions shape the module:
 *
 * 1. **The scene buffers a frame; the renderer draws it.** Draw order is not
 *    paint order — translucent draws render after their own run's opaque
 *    draws and HUD draws composite last — so a call cannot be rasterized the
 *    moment it happens. Each call validates, records, and appends one
 *    {@link FrameCommand}; `endFrame` hands the whole frame to whoever owns a
 *    renderer. The commands carry engine-owned copies, so a game mutating an
 *    object it passed cannot change a frame already handed over.
 * 2. **Validate, then record, then build.** A call the error table refuses
 *    throws before anything is recorded, because a call that never happened
 *    must not appear in the evidence. A call that merely draws nothing — a
 *    non-finite transform, a one-point line — is recorded and then skipped,
 *    exactly as the docs put it: "The call is still recorded."
 * 3. **Command building runs behind a guard.** The recorder already survives
 *    cyclic objects and throwing getters; the scene's own copies read the same
 *    hostile values, so a throw while copying skips the draw rather than
 *    crashing the frame, and a build draws the same pixels whether or not
 *    anything is being captured.
 * 4. **Produced values are frozen and described once.** A producer validates,
 *    freezes its result, files the tessellation parameters in a module-level
 *    side table for the renderer, and registers the producing call with the
 *    recorder — which collects recipes whether or not it is armed, so a
 *    material made long before `startRecording` still names its recipe.
 */

import type {
  Color,
  LightState,
  MaterialMapSlot,
  Recording,
  RenderMode,
} from "./contract";
import { LIGHT_LIMIT } from "./contract";
import type { Box3, CameraState, Transform, Vec2, Vec3 } from "./math";
import { defaultCameraState } from "./math";
import type { MaterialHandle, MeshHandle, TextureHandle } from "./assets";
import { materialSource, meshSource, textureSource } from "./assets";
import type {
  FrameFigures,
  HandleCapturePayload,
  HandleDescription,
  InheritedState,
} from "./recording";
import { SceneRecorder } from "./recording";

/* -------------------------------------------------------------------------- */
/* The game-facing types                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The whole drawing vocabulary: three state setters, a depth clear, six draw
 * calls, and six producers. Every draw call is self-contained, naming its
 * full world transform or position explicitly, and no method reads anything
 * back. Live only while `render` runs.
 */
export interface SceneContext {
  setCamera(camera: CameraState): void;
  setLights(lights: readonly LightState[]): void;
  setMode(mode: RenderMode): void;

  clearDepth(): void;

  drawMesh(
    mesh: MeshHandle,
    transform: Transform,
    options?: DrawMeshOptions,
  ): void;
  drawGeometry(
    geometry: Geometry,
    material: MaterialLike,
    transform: Transform,
  ): void;
  drawBillboard(texture: TextureHandle, position: Vec3, size: Vec2): void;
  drawLine(points: readonly Vec3[], color: Color): void;
  drawHudText(text: string, position: Vec2, options?: HudTextOptions): void;
  drawHudRect(position: Vec2, size: Vec2, color: Color): void;

  createBox(size: Vec3): Geometry;
  createSphere(radius: number): Geometry;
  createCylinder(radius: number, height: number): Geometry;
  createCapsule(radius: number, height: number): Geometry;
  createPlane(width: number, depth: number): Geometry;
  createMaterial(spec: MaterialSpec): Material;
}

/** The options `drawMesh` takes beside the mesh and its transform. */
export interface DrawMeshOptions {
  /** Overrides every material the file carries. */
  material?: MaterialLike;
  /** The animation clip to pose from, one of `mesh.clips`; omitted draws the rest pose. */
  clip?: string;
  /** The clip time to sample, in seconds, looping over the clip's duration. */
  clipTime?: number;
}

/**
 * What a draw accepts as a material: a loaded document, a code-built
 * `Material`, or a `Color` shorthand for a standard lit material with that
 * base color and the `MaterialSpec` defaults.
 */
export type MaterialLike = MaterialHandle | Material | Color;

/** A material described in code; every field has a documented default. */
export interface MaterialSpec {
  baseColor?: Color;
  baseColorMap?: TextureHandle;
  normalMap?: TextureHandle;
  roughness?: number;
  metallic?: number;
  emissive?: Color;
  opacity?: number;
  unlit?: boolean;
}

/** A material built in code: its spec with defaults filled in, as a frozen copy. */
export interface Material {
  readonly spec: Readonly<MaterialSpec>;
}

/** The options `drawHudText` takes beside the string and its position. */
export interface HudTextOptions {
  /** The em size in logical units. Default `24`. */
  size?: number;
  /** The fill color. Default `"#ffffff"`. */
  color?: Color;
  /** Which horizontal anchor `position` names. Default `"left"`. */
  align?: "left" | "center" | "right";
}

/**
 * An engine-owned, immutable procedural geometry. `bounds` is its axis-aligned
 * bounds in local units, which games use for their own collision arithmetic.
 */
export interface Geometry {
  readonly bounds: Box3;
}

/* -------------------------------------------------------------------------- */
/* What the renderer receives                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The tessellation parameters behind a produced {@link Geometry} — what the
 * renderer builds vertices from, keyed canonically so two geometries with the
 * same arguments share one GPU upload.
 */
export type GeometrySpec =
  | { shape: "box"; size: Vec3 }
  | { shape: "sphere"; radius: number }
  | { shape: "cylinder"; radius: number; height: number }
  | { shape: "capsule"; radius: number; height: number }
  | { shape: "plane"; width: number; depth: number };

/**
 * A `MaterialLike` resolved to the figures the renderer shades with: every
 * documented default filled in, and the map handles pulled out of whichever
 * shape supplied them. Resolution happens at call time, so a frame's command
 * list never reaches back into a game-owned object.
 */
export interface ResolvedMaterial {
  readonly baseColor: Color;
  readonly roughness: number;
  readonly metallic: number;
  readonly emissive: Color;
  readonly opacity: number;
  readonly unlit: boolean;
  readonly baseColorMap: TextureHandle | null;
  readonly normalMap: TextureHandle | null;
}

/**
 * One operation of a frame, in issue order, with engine-owned copies of every
 * argument. The renderer walks the list, splitting it into runs at the state
 * setters and depth clears exactly as the docs' draw-order section describes.
 */
export type FrameCommand =
  | { kind: "setCamera"; camera: CameraState }
  | { kind: "setLights"; lights: readonly LightState[] }
  | { kind: "setMode"; mode: RenderMode }
  | { kind: "clearDepth" }
  | {
      kind: "mesh";
      mesh: MeshHandle;
      transform: Transform;
      /** The override material, or `null` to draw the file's own. */
      material: ResolvedMaterial | null;
      clip: string | null;
      clipTime: number;
    }
  | {
      kind: "geometry";
      spec: GeometrySpec;
      material: ResolvedMaterial;
      transform: Transform;
    }
  | { kind: "billboard"; texture: TextureHandle; position: Vec3; size: Vec2 }
  | { kind: "line"; points: readonly Vec3[]; color: Color }
  | {
      kind: "hudText";
      text: string;
      position: Vec2;
      size: number;
      color: Color;
      align: "left" | "center" | "right";
    }
  | { kind: "hudRect"; position: Vec2; size: Vec2; color: Color };

/** One closed frame, as `endFrame` hands it to whoever owns the renderer. */
export interface SceneFrame {
  /** The renderer state the frame inherited, lights already cut to the renderer's 64. */
  inherited: InheritedState;
  /** The frame's operations, in issue order. */
  commands: readonly FrameCommand[];
}

/** What a {@link Scene} is created over: the engine's own design figures. */
export interface SceneOptions {
  /** The logical design width. */
  width: number;
  /** The logical design height. */
  height: number;
  /** The CSS color each frame clears to, or `null` for transparency. */
  background: string | null;
}

/* -------------------------------------------------------------------------- */
/* Small copies and predicates                                                */
/* -------------------------------------------------------------------------- */

/** A fresh copy of a camera's documented fields — the retained-state copy rule. */
function copyCamera(camera: CameraState): CameraState {
  return {
    position: {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    },
    rotation: {
      x: camera.rotation.x,
      y: camera.rotation.y,
      z: camera.rotation.z,
      w: camera.rotation.w,
    },
    fovY: camera.fovY,
    near: camera.near,
    far: camera.far,
  };
}

/** A fresh copy of one light, per shape; an unknown `type` copies shallowly so nothing is invented. */
function copyLight(light: LightState): LightState {
  if (light.type === "directional") {
    return {
      type: "directional",
      color: light.color,
      intensity: light.intensity,
      direction: {
        x: light.direction.x,
        y: light.direction.y,
        z: light.direction.z,
      },
    };
  }
  if (light.type === "point") {
    return {
      type: "point",
      color: light.color,
      intensity: light.intensity,
      position: {
        x: light.position.x,
        y: light.position.y,
        z: light.position.z,
      },
      range: light.range,
    };
  }
  return { ...(light as object) } as LightState;
}

/** A fresh copy of a vector. */
function copyVec3(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

/** A fresh copy of a point. */
function copyVec2(p: Vec2): Vec2 {
  return { x: p.x, y: p.y };
}

/** A fresh copy of a transform's nine numbers and quaternion. */
function copyTransform(t: Transform): Transform {
  return {
    position: copyVec3(t.position),
    rotation: {
      x: t.rotation.x,
      y: t.rotation.y,
      z: t.rotation.z,
      w: t.rotation.w,
    },
    scale: copyVec3(t.scale),
  };
}

/** Whether every component is a finite number. */
function finiteVec3(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** Whether both components are finite numbers. */
function finiteVec2(p: Vec2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Whether a transform carries only finite numbers — the non-finite-skip rule's test. */
function finiteTransform(t: Transform): boolean {
  return (
    finiteVec3(t.position) &&
    finiteVec3(t.scale) &&
    Number.isFinite(t.rotation.x) &&
    Number.isFinite(t.rotation.y) &&
    Number.isFinite(t.rotation.z) &&
    Number.isFinite(t.rotation.w)
  );
}

/** The four render modes, spelled once for the `setMode` refusal. */
const RENDER_MODES: readonly RenderMode[] = [
  "standard",
  "wireframe",
  "unlit",
  "normals",
];

/** The `MaterialSpec` fields bounded to `0`–`1`, checked by `createMaterial`. */
const UNIT_FIELDS = ["roughness", "metallic", "opacity"] as const;

/** The documented defaults, filled into every resolved material. */
function fillSpec(spec: MaterialSpec): ResolvedMaterial {
  return {
    baseColor: spec.baseColor ?? "#ffffff",
    roughness: spec.roughness ?? 0.8,
    metallic: spec.metallic ?? 0,
    emissive: spec.emissive ?? "#000000",
    opacity: spec.opacity ?? 1,
    unlit: spec.unlit ?? false,
    baseColorMap: spec.baseColorMap ?? null,
    normalMap: spec.normalMap ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* PNG encoding — what an engine-made texture is captured as                  */
/* -------------------------------------------------------------------------- */

/** The CRC-32 table, built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 over one PNG chunk's type and data. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Adler-32 over the raw deflate payload, as the zlib wrapper requires. */
function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * Encodes RGBA8 pixels as a PNG file: 8-bit color type 6, non-interlaced,
 * zlib stream of stored (uncompressed) deflate blocks.
 *
 * This is the counterpart of `png.ts`'s decoder, kept beside the capture path
 * that needs it: a texture the engine rasterized itself — a `text:`-pathed
 * billboard — has pixels but never had a file, and the recording format
 * carries every texture as a PNG data URL. Stored blocks rather than real
 * compression, because the recording is gzipped whole at emission and
 * compressing twice buys nothing; the recorder's byte budget counts the
 * base64, which gzip then flattens. Exported as a test seam — the suites
 * round-trip it through the decoder — but not re-exported from the package
 * entry point.
 */
export function encodePng(
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  if (
    !Number.isInteger(width) ||
    width <= 0 ||
    !Number.isInteger(height) ||
    height <= 0
  ) {
    throw new RangeError(
      `encodePng size must be positive integers, got ${width}x${height}`,
    );
  }
  if (pixels.length !== width * height * 4) {
    throw new RangeError(
      `encodePng was given ${pixels.length} bytes for a ${width}x${height} image: RGBA8 needs ${width * height * 4}`,
    );
  }

  // Filter byte 0 ahead of every scanline: the simplest conforming stream.
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(
      pixels.subarray(y * stride, (y + 1) * stride),
      y * (stride + 1) + 1,
    );
  }

  // The zlib wrapper around stored deflate blocks of at most 65535 bytes.
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const idat = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  idat[0] = 0x78;
  idat[1] = 0x01;
  let at = 2;
  for (let start = 0, block = 0; block < blocks; block += 1, start += 65535) {
    const len = Math.min(65535, raw.length - start);
    idat[at] = block === blocks - 1 ? 1 : 0;
    idat[at + 1] = len & 0xff;
    idat[at + 2] = len >> 8;
    idat[at + 3] = ~len & 0xff;
    idat[at + 4] = (~len >> 8) & 0xff;
    idat.set(raw.subarray(start, start + len), at + 5);
    at += 5 + len;
  }
  const adler = adler32(raw);
  idat[at] = (adler >>> 24) & 0xff;
  idat[at + 1] = (adler >>> 16) & 0xff;
  idat[at + 2] = (adler >>> 8) & 0xff;
  idat[at + 3] = adler & 0xff;

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA

  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };

  const signature = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const parts = [
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const file = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    file.set(part, offset);
    offset += part.length;
  }
  return file;
}

/* -------------------------------------------------------------------------- */
/* Handle description — how the recorder recognizes engine handles            */
/* -------------------------------------------------------------------------- */

/**
 * The recorder's `describeHandle` seam, answered from the asset module's side
 * tables: a value this engine loaded (or rasterized and registered) is a
 * handle, and everything else is `null`. A texture with file bytes captures
 * them verbatim; one the engine made itself — `bytes: null`, a `text:` path —
 * is encoded to a PNG here, because the format carries every texture as one
 * and the recorder deliberately owns no image codec.
 */
function describeEngineHandle(value: object): HandleDescription | null {
  const mesh = meshSource(value as MeshHandle);
  if (mesh !== undefined) {
    return {
      name: "MeshHandle",
      capture: (): HandleCapturePayload => ({
        kind: "mesh",
        path: (value as MeshHandle).path,
        bytes: mesh.bytes,
      }),
    };
  }
  const texture = textureSource(value as TextureHandle);
  if (texture !== undefined) {
    return {
      name: "TextureHandle",
      capture: (): HandleCapturePayload => ({
        kind: "texture",
        path: (value as TextureHandle).path,
        width: texture.width,
        height: texture.height,
        png:
          texture.bytes ??
          encodePng(texture.pixels, texture.width, texture.height),
      }),
    };
  }
  const material = materialSource(value as MaterialHandle);
  if (material !== undefined) {
    const maps = Object.entries(
      (value as MaterialHandle).maps,
    ) as ReadonlyArray<readonly [MaterialMapSlot, TextureHandle]>;
    return {
      name: "MaterialHandle",
      capture: (): HandleCapturePayload => ({
        kind: "material",
        path: (value as MaterialHandle).path,
        maps,
      }),
    };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Produced-value side tables                                                 */
/* -------------------------------------------------------------------------- */

// Module-level WeakMaps rather than fields on the produced values, so a
// Geometry's own shape stays exactly `{ bounds }` as documented and the
// renderer resolves a value without holding the scene that made it. A
// collected value takes its entry with it — nothing grows with a run.
const geometrySpecs = new WeakMap<Geometry, GeometrySpec>();
const producedMaterials = new WeakMap<Material, ResolvedMaterial>();

/** The tessellation parameters behind a produced geometry, or `undefined` for a value no scene produced. */
export function geometrySpec(geometry: Geometry): GeometrySpec | undefined {
  return geometrySpecs.get(geometry);
}

/* -------------------------------------------------------------------------- */
/* The scene                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The one drawing surface the engine composes into the picture: stable
 * identity for the engine's whole life, live only while `render` runs, with
 * the {@link SceneRecorder} inside it.
 *
 * The engine drives the frame bracket: `beginFrame` before its own frame
 * preparation, `enterRender`/`exitRender` around the game's `render`, and
 * `endFrame` to close the bracket and take the frame for the renderer.
 * `startRecording`/`stopRecording`/`recording` are what the `Engine` members
 * of the same names delegate to.
 */
export class Scene implements SceneContext {
  private readonly options: SceneOptions;
  private readonly recorder: SceneRecorder;

  // The retained renderer state: replaced, never mutated, so a frame's
  // inherited snapshot is a reference taken at `beginFrame` rather than a
  // deep copy per frame.
  private camera: CameraState;
  private lights: readonly LightState[] = [];
  private mode: RenderMode = "standard";

  private commands: FrameCommand[] = [];
  private inherited: InheritedState;
  private live = false;
  private destroyed = false;

  constructor(options: SceneOptions) {
    this.options = {
      width: options.width,
      height: options.height,
      background: options.background,
    };
    this.recorder = new SceneRecorder({
      envelope: () => ({ ...this.options }),
      describeHandle: describeEngineHandle,
    });
    this.camera = defaultCameraState();
    this.inherited = {
      camera: this.camera,
      lights: this.lights,
      mode: this.mode,
    };
  }

  /* ------------------------------------------------------------------ */
  /* The engine seam                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Opens the frame bracket: snapshots the renderer state the frame inherits
   * — before the frame's first operation, the documented snapshot moment —
   * and starts a fresh command list.
   */
  beginFrame(surface: { width: number; height: number }): void {
    this.recorder.openFrame(
      { camera: this.camera, lights: this.lights, mode: this.mode },
      surface,
    );
    this.inherited = {
      camera: this.camera,
      lights:
        this.lights.length > LIGHT_LIMIT
          ? this.lights.slice(0, LIGHT_LIMIT)
          : this.lights,
      mode: this.mode,
    };
    this.commands = [];
  }

  /** Opens the gate: the scene context is live only while `render` runs. */
  enterRender(): void {
    this.live = true;
  }

  /** Closes the gate; a call after this throws the outside-`render` error. */
  exitRender(): void {
    this.live = false;
  }

  /**
   * Closes the frame bracket with the engine's own figures and hands back
   * everything the renderer needs to draw the frame.
   */
  endFrame(figures: FrameFigures): SceneFrame {
    this.recorder.closeFrame(figures);
    return { inherited: this.inherited, commands: this.commands };
  }

  /** Whether operations are being captured. */
  recording(): boolean {
    return this.recorder.active();
  }

  /** Arms the recorder; capture begins at the next frame. Throws when already armed. */
  startRecording(): void {
    this.recorder.start();
  }

  /** Disarms the recorder and returns everything captured. Throws when not armed. */
  stopRecording(): Recording {
    return this.recorder.stop();
  }

  /** Closes the gate for good: every call after `destroy` throws the outside-`render` error. */
  destroy(): void {
    this.destroyed = true;
    this.live = false;
    this.commands = [];
  }

  /* ------------------------------------------------------------------ */
  /* State setters                                                      */
  /* ------------------------------------------------------------------ */

  setCamera(camera: CameraState): void {
    this.assertLive("setCamera");
    this.recorder.recordCall("setCamera", [camera]);
    this.guarded(() => {
      const copy = copyCamera(camera);
      this.camera = copy;
      this.commands.push({ kind: "setCamera", camera: copy });
    });
  }

  setLights(lights: readonly LightState[]): void {
    this.assertLive("setLights");
    this.recorder.recordCall("setLights", [lights]);
    this.guarded(() => {
      const copy = Object.freeze(lights.map(copyLight));
      this.lights = copy;
      this.commands.push({
        kind: "setLights",
        // The renderer uses the first 64 entries; the retained list keeps
        // them all so the next frame's `truncated` flag can be honest.
        lights: copy.length > LIGHT_LIMIT ? copy.slice(0, LIGHT_LIMIT) : copy,
      });
    });
  }

  setMode(mode: RenderMode): void {
    this.assertLive("setMode");
    if (!RENDER_MODES.includes(mode)) {
      throw new Error(
        `setMode was given ${JSON.stringify(mode)}: the render modes are "standard", "wireframe", "unlit", and "normals"`,
      );
    }
    this.recorder.recordCall("setMode", [mode]);
    this.mode = mode;
    this.commands.push({ kind: "setMode", mode });
  }

  clearDepth(): void {
    this.assertLive("clearDepth");
    this.recorder.recordCall("clearDepth", []);
    this.commands.push({ kind: "clearDepth" });
  }

  /* ------------------------------------------------------------------ */
  /* Draw calls                                                         */
  /* ------------------------------------------------------------------ */

  drawMesh(
    mesh: MeshHandle,
    transform: Transform,
    options?: DrawMeshOptions,
  ): void {
    this.assertLive("drawMesh");
    const clip = options?.clip;
    if (clip !== undefined) {
      const clips: readonly string[] = Array.isArray(mesh?.clips)
        ? mesh.clips
        : [];
      if (!clips.includes(clip)) {
        throw new Error(
          `drawMesh was given clip ${JSON.stringify(clip)} that the mesh does not carry: its clips are [${clips
            .map((name) => JSON.stringify(name))
            .join(", ")}]`,
        );
      }
    }
    this.recorder.recordCall(
      "drawMesh",
      options === undefined ? [mesh, transform] : [mesh, transform, options],
    );
    this.guarded(() => {
      const clipTime = options?.clipTime ?? 0;
      if (!finiteTransform(transform) || !Number.isFinite(clipTime)) return;
      this.commands.push({
        kind: "mesh",
        mesh,
        transform: copyTransform(transform),
        material:
          options?.material === undefined
            ? null
            : resolveMaterial(options.material),
        clip: clip ?? null,
        clipTime,
      });
    });
  }

  drawGeometry(
    geometry: Geometry,
    material: MaterialLike,
    transform: Transform,
  ): void {
    this.assertLive("drawGeometry");
    this.recorder.recordCall("drawGeometry", [geometry, material, transform]);
    this.guarded(() => {
      if (!finiteTransform(transform)) return;
      const spec = geometrySpecs.get(geometry);
      // A value no scene produced has no tessellation to draw; the call is
      // recorded above, exactly like any other draw that draws nothing.
      if (spec === undefined) return;
      this.commands.push({
        kind: "geometry",
        spec,
        material: resolveMaterial(material),
        transform: copyTransform(transform),
      });
    });
  }

  drawBillboard(texture: TextureHandle, position: Vec3, size: Vec2): void {
    this.assertLive("drawBillboard");
    this.recorder.recordCall("drawBillboard", [texture, position, size]);
    this.guarded(() => {
      if (!finiteVec3(position) || !finiteVec2(size)) return;
      this.commands.push({
        kind: "billboard",
        texture,
        position: copyVec3(position),
        size: copyVec2(size),
      });
    });
  }

  drawLine(points: readonly Vec3[], color: Color): void {
    this.assertLive("drawLine");
    this.recorder.recordCall("drawLine", [points, color]);
    this.guarded(() => {
      // Fewer than two points draws nothing; the call was still recorded.
      if (!Array.isArray(points) || points.length < 2) return;
      const copy: Vec3[] = [];
      for (const point of points) {
        if (!finiteVec3(point)) return;
        copy.push(copyVec3(point));
      }
      this.commands.push({ kind: "line", points: copy, color });
    });
  }

  drawHudText(text: string, position: Vec2, options?: HudTextOptions): void {
    this.assertLive("drawHudText");
    this.recorder.recordCall(
      "drawHudText",
      options === undefined ? [text, position] : [text, position, options],
    );
    this.guarded(() => {
      const size = options?.size ?? 24;
      if (!finiteVec2(position) || !Number.isFinite(size)) return;
      const align = options?.align;
      this.commands.push({
        kind: "hudText",
        text: String(text),
        position: copyVec2(position),
        size,
        color: options?.color ?? "#ffffff",
        align: align === "center" || align === "right" ? align : "left",
      });
    });
  }

  drawHudRect(position: Vec2, size: Vec2, color: Color): void {
    this.assertLive("drawHudRect");
    this.recorder.recordCall("drawHudRect", [position, size, color]);
    this.guarded(() => {
      if (!finiteVec2(position) || !finiteVec2(size)) return;
      this.commands.push({
        kind: "hudRect",
        position: copyVec2(position),
        size: copyVec2(size),
        color,
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Producers                                                          */
  /* ------------------------------------------------------------------ */

  createBox(size: Vec3): Geometry {
    this.assertLive("createBox");
    assertDimension("createBox", "size.x", size?.x);
    assertDimension("createBox", "size.y", size?.y);
    assertDimension("createBox", "size.z", size?.z);
    const copy = copyVec3(size);
    return this.produce(
      { shape: "box", size: copy },
      "createBox",
      [copy],
      box(
        -copy.x / 2,
        -copy.y / 2,
        -copy.z / 2,
        copy.x / 2,
        copy.y / 2,
        copy.z / 2,
      ),
    );
  }

  createSphere(radius: number): Geometry {
    this.assertLive("createSphere");
    assertDimension("createSphere", "radius", radius);
    return this.produce(
      { shape: "sphere", radius },
      "createSphere",
      [radius],
      box(-radius, -radius, -radius, radius, radius, radius),
    );
  }

  createCylinder(radius: number, height: number): Geometry {
    this.assertLive("createCylinder");
    assertDimension("createCylinder", "radius", radius);
    assertDimension("createCylinder", "height", height);
    return this.produce(
      { shape: "cylinder", radius, height },
      "createCylinder",
      [radius, height],
      box(-radius, -height / 2, -radius, radius, height / 2, radius),
    );
  }

  createCapsule(radius: number, height: number): Geometry {
    this.assertLive("createCapsule");
    assertDimension("createCapsule", "radius", radius);
    assertDimension("createCapsule", "height", height);
    // `height` is cap-center to cap-center, so the axis extent adds a radius
    // at each end — the documented `height + 2 * radius` overall.
    const extent = height / 2 + radius;
    return this.produce(
      { shape: "capsule", radius, height },
      "createCapsule",
      [radius, height],
      box(-radius, -extent, -radius, radius, extent, radius),
    );
  }

  createPlane(width: number, depth: number): Geometry {
    this.assertLive("createPlane");
    assertDimension("createPlane", "width", width);
    assertDimension("createPlane", "depth", depth);
    return this.produce(
      { shape: "plane", width, depth },
      "createPlane",
      [width, depth],
      box(-width / 2, 0, -depth / 2, width / 2, 0, depth / 2),
    );
  }

  createMaterial(spec: MaterialSpec): Material {
    this.assertLive("createMaterial");
    for (const field of UNIT_FIELDS) {
      const value = spec?.[field];
      if (
        value !== undefined &&
        (!Number.isFinite(value) || value < 0 || value > 1)
      ) {
        throw new RangeError(
          `createMaterial ${field} must be a finite number from 0 to 1, got ${String(value)}`,
        );
      }
    }
    const resolved = fillSpec(spec ?? {});
    // The frozen, defaults-filled spec the docs promise; the map handles ride
    // along only when supplied, because absence is their documented default.
    const filled: MaterialSpec = {
      baseColor: resolved.baseColor,
      roughness: resolved.roughness,
      metallic: resolved.metallic,
      emissive: resolved.emissive,
      opacity: resolved.opacity,
      unlit: resolved.unlit,
      ...(resolved.baseColorMap === null
        ? {}
        : { baseColorMap: resolved.baseColorMap }),
      ...(resolved.normalMap === null ? {} : { normalMap: resolved.normalMap }),
    };
    const material: Material = Object.freeze({ spec: Object.freeze(filled) });
    producedMaterials.set(material, resolved);
    // The recipe records the value the build supplied — arguments as given,
    // not the defaults-filled form — so two identical specs share one entry.
    this.recorder.registerResource(material, "createMaterial", [spec]);
    return material;
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  /** Refuses every call outside `render`, naming the rule. */
  private assertLive(method: string): void {
    if (this.destroyed || !this.live) {
      throw new Error(
        `scene.${method} was called outside render: the scene context is live only while the game's render runs`,
      );
    }
  }

  /**
   * Runs the post-record half of a call behind a guard: a hostile argument —
   * a throwing getter, a shape the copy cannot read — skips the draw rather
   * than crashing the frame, so a build draws the same pixels whether or not
   * anything is being captured.
   */
  private guarded(build: () => void): void {
    try {
      build();
    } catch {
      // The call was recorded; the draw draws nothing.
    }
  }

  /** Freezes and files one produced geometry: bounds public, spec and recipe beside it. */
  private produce(
    spec: GeometrySpec,
    method:
      | "createBox"
      | "createSphere"
      | "createCylinder"
      | "createCapsule"
      | "createPlane",
    args: readonly unknown[],
    bounds: Box3,
  ): Geometry {
    const geometry: Geometry = Object.freeze({
      bounds: Object.freeze({
        min: Object.freeze(bounds.min),
        max: Object.freeze(bounds.max),
      }) as Box3,
    });
    geometrySpecs.set(geometry, spec);
    this.recorder.registerResource(geometry, method, args);
    return geometry;
  }
}

/** Refuses a producer dimension that is not finite and positive, naming the value. */
function assertDimension(
  method: string,
  name: string,
  value: number | undefined,
): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${method} ${name} must be finite and positive, got ${String(value)}`,
    );
  }
}

/** A box from its six extents. */
function box(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): Box3 {
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}

/**
 * Resolves a `MaterialLike` to the renderer's figures: a `Color` string is a
 * standard lit material with that base color and the defaults, a produced
 * `Material` resolves to the figures cached when it was made, a loaded
 * `MaterialHandle` contributes its maps over the defaults, and a
 * material-shaped foreign object is read leniently through its `spec`.
 */
function resolveMaterial(material: MaterialLike): ResolvedMaterial {
  if (typeof material === "string") return fillSpec({ baseColor: material });
  const produced = producedMaterials.get(material as Material);
  if (produced !== undefined) return produced;
  if (materialSource(material as MaterialHandle) !== undefined) {
    const maps = (material as MaterialHandle).maps;
    return fillSpec({ baseColorMap: maps.baseColor, normalMap: maps.normal });
  }
  const spec = (material as Material)?.spec;
  if (spec !== null && typeof spec === "object") return fillSpec(spec);
  return fillSpec({});
}
